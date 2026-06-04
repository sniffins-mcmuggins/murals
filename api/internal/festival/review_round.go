package festival

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type reviewRoundState int

const (
	reviewNotStarted reviewRoundState = iota
	reviewOpen
	reviewClosed
)

// reviewRoundStatus derives the round state from the festival's timestamps.
func reviewRoundStatus(f sqlcdb.Festival) reviewRoundState {
	if f.ReviewClosedAt.Valid {
		return reviewClosed
	}
	if f.ReviewOpenedAt.Valid {
		return reviewOpen
	}
	return reviewNotStarted
}

// OpenReviewRoundHandler handles POST /festivals/{festivalID}/review/open. Owner only.
func OpenReviewRoundHandler(pool *pgxpool.Pool, mailer auth.EmailSender, webBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		fest, err := q.OpenReviewRound(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.Conflict(w, "review round already closed")
				return
			}
			httperr.InternalServerError(w)
			return
		}
		go notifyReviewersRoundOpen(pool, mailer, webBase, festUUID, fest.Name)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toFestivalResponse(fest))
	}
}

// CloseReviewRoundHandler handles POST /festivals/{festivalID}/review/close. Owner only.
// Force-close is allowed regardless of how many reviewers have scored.
func CloseReviewRoundHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		fest, err := q.CloseReviewRound(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.Conflict(w, "review round is not open")
				return
			}
			httperr.InternalServerError(w)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toFestivalResponse(fest))
	}
}

func notifyReviewersRoundOpen(pool *pgxpool.Pool, mailer auth.EmailSender, webBase string, festID pgtype.UUID, festName string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	q := sqlcdb.New(pool)
	reviewers, err := q.ListAcceptedFestivalReviewers(ctx, festID)
	if err != nil {
		slog.Error("review-round open: list reviewers failed", "err", err)
		return
	}
	for _, rv := range reviewers {
		auth.ReviewRoundOpenEmail(ctx, mailer, webBase, rv.Email, festName)
	}
}
