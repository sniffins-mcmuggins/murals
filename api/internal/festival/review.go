package festival

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// ListApplicationsHandler handles GET /festivals/{festivalID}/applications.
// Returns applications enriched with artist profile data, notes, and score fields.
// Accessible by the festival owner and invited reviewers.
func ListApplicationsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		festUUID, err := pgUUIDFromString(chi.URLParam(r, "festivalID"))
		if err != nil {
			httperr.BadRequest(w, "invalid festivalID")
			return
		}

		q := sqlcdb.New(pool)
		role, err := resolveFestivalAccess(r.Context(), q, festUUID, principal.UserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if role == roleNone {
			httperr.Forbidden(w)
			return
		}

		form, err := q.GetApplicationFormByFestivalID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode([]applicationResponse{})
				return
			}
			httperr.InternalServerError(w)
			return
		}

		callerUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Fetch enriched rows. Reviewer path excludes the caller's own application.
		type item struct {
			resp applicationResponse
			id   pgtype.UUID
		}
		var items []item

		if role == roleReviewer {
			rows, err := q.ListApplicationsByFormWithArtistExcludingReviewer(r.Context(), sqlcdb.ListApplicationsByFormWithArtistExcludingReviewerParams{
				FormID: form.ID,
				UserID: callerUUID,
			})
			if err != nil {
				httperr.InternalServerError(w)
				return
			}
			for _, row := range rows {
				items = append(items, item{resp: toEnrichedReviewerRow(row), id: row.ID})
			}
		} else {
			rows, err := q.ListApplicationsByFormWithArtist(r.Context(), form.ID)
			if err != nil {
				httperr.InternalServerError(w)
				return
			}
			for _, row := range rows {
				items = append(items, item{resp: toEnrichedResponse(row), id: row.ID})
			}
		}

		if len(items) == 0 {
			w.Header().Set("Content-Type", "application/json")
			if role == roleReviewer {
				_ = json.NewEncoder(w).Encode([]reviewerApplicationResponse{})
			} else {
				_ = json.NewEncoder(w).Encode([]applicationResponse{})
			}
			return
		}

		appIDs := make([]pgtype.UUID, len(items))
		for i := range items {
			appIDs[i] = items[i].id
		}

		// Batch-fetch notes.
		notesByApp := map[string][]noteResponse{}
		for _, it := range items {
			notesByApp[it.id.String()] = []noteResponse{}
		}
		allNotes, err := q.ListNotesByApplications(r.Context(), appIDs)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		for _, n := range allNotes {
			k := n.ApplicationID.String()
			notesByApp[k] = append(notesByApp[k], toNoteResponse(n))
		}

		// Batch-fetch score summaries.
		type scoreSummary struct {
			avg   float64
			count int32
		}
		summaryByApp := map[string]scoreSummary{}
		summaries, err := q.ScoreSummaryByApplications(r.Context(), appIDs)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		for _, s := range summaries {
			summaryByApp[s.ApplicationID.String()] = scoreSummary{avg: s.AvgScore, count: s.ScoreCount}
		}

		// Batch-fetch the caller's own scores (now per criterion).
		type myScoreRow struct {
			criterionID string
			score       int32
		}
		myScoresByApp := map[string][]myScoreRow{}
		myScores, err := q.GetMyScoresByApplications(r.Context(), sqlcdb.GetMyScoresByApplicationsParams{
			Column1:    appIDs,
			ReviewerID: callerUUID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		for _, ms := range myScores {
			k := ms.ApplicationID.String()
			myScoresByApp[k] = append(myScoresByApp[k], myScoreRow{ms.CriterionID, ms.Score})
		}

		// Parse criteria config once for the whole batch.
		criteria, _ := parseCriteria(form.ReviewCriteria)

		// Batch-fetch per-criterion summaries (only when criteria are configured).
		type criterionKey struct{ appID, criterionID string }
		criterionSummaries := map[criterionKey]struct {
			avg   float64
			count int
		}{}
		if len(criteria) > 0 {
			rows, err := q.CriterionSummaryByApplications(r.Context(), appIDs)
			if err != nil {
				httperr.InternalServerError(w)
				return
			}
			for _, row := range rows {
				k := criterionKey{row.ApplicationID.String(), row.CriterionID}
				criterionSummaries[k] = struct {
					avg   float64
					count int
				}{row.AvgScore, int(row.ScoreCount)}
			}
		}

		// Assemble final response.
		resp := make([]applicationResponse, len(items))
		for i, it := range items {
			a := it.resp
			appIDStr := it.id.String()
			a.Notes = notesByApp[appIDStr]

			if sum, ok := summaryByApp[appIDStr]; ok {
				avg := sum.avg
				a.AvgScore = &avg
				a.ScoreCount = sum.count
			}

			myRows := myScoresByApp[appIDStr]
			if len(criteria) == 0 {
				// No rubric — surface the caller's 'overall' score.
				for _, row := range myRows {
					if row.criterionID == "overall" {
						m := row.score
						a.MyScore = &m
						break
					}
				}
			} else {
				// Rubric — my_score = mean of scored criteria; criterion_scores populated.
				myScoreLookup := map[string]int32{}
				for _, row := range myRows {
					myScoreLookup[row.criterionID] = row.score
				}

				cs := make([]criterionScore, 0, len(criteria))
				var totalMy int32
				myCount := 0
				for _, c := range criteria {
					entry := criterionScore{
						CriterionID: c.ID,
						Label:       c.Label,
						Min:         c.Min,
						Max:         c.Max,
					}
					if sum, ok := criterionSummaries[criterionKey{appIDStr, c.ID}]; ok {
						avg := sum.avg
						entry.AvgScore = &avg
						entry.ScoreCount = sum.count
					}
					if ms, ok := myScoreLookup[c.ID]; ok {
						m := ms
						entry.MyScore = &m
						totalMy += ms
						myCount++
					}
					cs = append(cs, entry)
				}
				a.CriterionScores = cs

				// Top-level avg_score = mean of per-criterion averages (spec 4c).
				var totalAvg float64
				avgCount := 0
				for _, entry := range cs {
					if entry.AvgScore != nil {
						totalAvg += *entry.AvgScore
						avgCount++
					}
				}
				if avgCount > 0 {
					avgMean := totalAvg / float64(avgCount)
					a.AvgScore = &avgMean
				} else {
					a.AvgScore = nil
				}

				if myCount > 0 {
					mean := int32(math.Round(float64(totalMy) / float64(myCount)))
					a.MyScore = &mean
				}
			}

			resp[i] = a
		}

		w.Header().Set("Content-Type", "application/json")
		if role == roleReviewer {
			trimmed := make([]reviewerApplicationResponse, len(resp))
			for i := range resp {
				trimmed[i] = toReviewerApplicationResponse(resp[i])
			}
			_ = json.NewEncoder(w).Encode(trimmed)
			return
		}
		_ = json.NewEncoder(w).Encode(resp)
	}
}
