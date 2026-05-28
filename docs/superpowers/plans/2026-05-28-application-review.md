# Application Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full organiser application review workflow — tabbed list with artist profile data, waitlist/shortlist/flag actions, drag-to-rank, internal notes, and email notifications on status change.

**Architecture:** New DB migration adds `waitlisted` to the status enum plus `rank`/`shortlisted`/`review_flag` columns and an `application_notes` table. Seven Go handlers serve the review API; the list handler joins artist profiles and batch-fetches notes. The frontend rewrites the applications page as a tabbed, drag-sortable list with a slide-over detail panel.

**Tech Stack:** Go (chi, pgx/v5, sqlc), PostgreSQL, Next.js 15, TypeScript, @tanstack/react-query, @dnd-kit/core + @dnd-kit/sortable

**Spec:** `docs/superpowers/specs/2026-05-27-application-review-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `db/migrations/000007_application_review.up.sql` | Schema changes |
| Create | `db/migrations/000007_application_review.down.sql` | Rollback |
| Modify | `db/queries/applications.sql` | New list/flags/rank queries |
| Create | `db/queries/application_notes.sql` | Notes CRUD |
| Regen  | `api/internal/sqlcdb/` (all) | `task db:generate` |
| Modify | `api/internal/festival/application.go` | Enriched response types |
| Create | `api/internal/festival/notification.go` | Email notification helper |
| Create | `api/internal/festival/waitlist.go` | WaitlistApplicationHandler |
| Create | `api/internal/festival/waitlist_test.go` | Waitlist tests |
| Create | `api/internal/festival/patch.go` | PatchApplicationHandler + ReorderApplicationsHandler |
| Create | `api/internal/festival/patch_test.go` | Patch + reorder tests |
| Create | `api/internal/festival/notes.go` | AddApplicationNoteHandler |
| Create | `api/internal/festival/notes_test.go` | Notes tests |
| Modify | `api/internal/festival/review.go` | Rewrite list; add mailer to accept/decline |
| Modify | `api/internal/festival/review_test.go` | Update for new signatures + enriched response |
| Modify | `api/cmd/api/main.go` | Wire all new routes + pass mailer |
| Modify | `openapi/openapi.yaml` | New endpoints + enriched Application schema |
| Create | `web/src/components/ApplicationCard.tsx` | Sortable card with actions |
| Create | `web/src/components/ApplicationNotes.tsx` | Notes list + add form |
| Create | `web/src/components/ApplicationSlideOver.tsx` | Detail panel |
| Create | `web/src/hooks/useApplicationReorder.ts` | Optimistic drag-reorder mutation |
| Modify | `web/src/app/organiser/festivals/[id]/applications/page.tsx` | Full rewrite |

---

## Task 1: DB Migration

**Files:**
- Create: `db/migrations/000007_application_review.up.sql`
- Create: `db/migrations/000007_application_review.down.sql`

- [ ] **Write the up migration**

```sql
-- db/migrations/000007_application_review.up.sql
ALTER TYPE application_status ADD VALUE 'waitlisted';

ALTER TABLE applications
  ADD COLUMN rank        int  NOT NULL DEFAULT 0,
  ADD COLUMN shortlisted bool NOT NULL DEFAULT false,
  ADD COLUMN review_flag bool NOT NULL DEFAULT false;

CREATE TABLE application_notes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  content        text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Write the down migration**

```sql
-- db/migrations/000007_application_review.down.sql
-- Note: Postgres cannot remove an enum value once added.
-- 'waitlisted' remains in the application_status enum after rollback.
DROP TABLE IF EXISTS application_notes;

ALTER TABLE applications
  DROP COLUMN IF EXISTS review_flag,
  DROP COLUMN IF EXISTS shortlisted,
  DROP COLUMN IF EXISTS rank;
```

- [ ] **Apply the migration**

Run from repo root:
```bash
task db:migrate
```
Expected: `migrate: no error` (or similar success output). If the stack is not up, run `task up` first.

- [ ] **Commit**

```bash
git add db/migrations/000007_application_review.up.sql db/migrations/000007_application_review.down.sql
git commit -m "feat: add waitlisted status, review flags, rank, and notes table"
```

---

## Task 2: SQL Queries + Regenerate

**Files:**
- Modify: `db/queries/applications.sql`
- Create: `db/queries/application_notes.sql`
- Regen: `api/internal/sqlcdb/` (all files via `task db:generate`)

- [ ] **Add new queries to `db/queries/applications.sql`**

Append to the end of the file:

```sql
-- name: ListApplicationsByFormWithArtist :many
SELECT
  a.id,
  a.form_id,
  a.artist_id,
  a.status,
  a.rank,
  a.shortlisted,
  a.review_flag,
  a.answers,
  a.created_at,
  a.updated_at,
  ap.display_name,
  ap.avatar_s3_key,
  ap.medium_tags,
  ap.location_label
FROM applications a
JOIN artist_profiles ap ON ap.id = a.artist_id
WHERE a.form_id = $1
ORDER BY a.rank ASC, a.created_at ASC;

-- name: UpdateApplicationFlags :one
UPDATE applications
SET shortlisted = $2, review_flag = $3, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateApplicationRank :exec
UPDATE applications SET rank = $1, updated_at = now() WHERE id = $2;
```

- [ ] **Create `db/queries/application_notes.sql`**

```sql
-- name: ListNotesByApplications :many
SELECT * FROM application_notes
WHERE application_id = ANY($1::uuid[])
ORDER BY application_id, created_at ASC;

-- name: CreateApplicationNote :one
INSERT INTO application_notes (application_id, content)
VALUES ($1, $2)
RETURNING *;
```

- [ ] **Regenerate sqlcdb**

Run from repo root:
```bash
task db:generate
```
Expected: no errors. This regenerates all files under `api/internal/sqlcdb/`.

- [ ] **Verify generated types**

Check that `api/internal/sqlcdb/models.go` now contains:
- `ApplicationStatusWaitlisted ApplicationStatus = "waitlisted"`
- `Application` struct has `Rank int32`, `Shortlisted bool`, `ReviewFlag bool` fields
- `ApplicationNote` struct exists

Check that `api/internal/sqlcdb/applications.sql.go` contains:
- `ListApplicationsByFormWithArtist` function and `ListApplicationsByFormWithArtistRow` struct
- `UpdateApplicationFlags` function
- `UpdateApplicationRank` function

Check that `api/internal/sqlcdb/application_notes.sql.go` exists with `ListNotesByApplications` and `CreateApplicationNote`.

- [ ] **Verify API still compiles**

```bash
cd api && go build ./... && cd ..
```
Expected: no errors.

- [ ] **Commit**

```bash
git add db/queries/applications.sql db/queries/application_notes.sql api/internal/sqlcdb/
git commit -m "feat: add application review SQL queries and regenerate sqlcdb"
```

---

## Task 3: Update Response Types

**Files:**
- Modify: `api/internal/festival/application.go`

- [ ] **Replace the existing types and `toApplicationResponse` in `application.go`**

Replace the entire file content:

```go
package festival

import (
	"encoding/json"
	"time"

	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type formField struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Type     string `json:"type"`
	Required bool   `json:"required"`
}

type artistSummary struct {
	DisplayName   string   `json:"display_name"`
	AvatarS3Key   *string  `json:"avatar_s3_key"`
	MediumTags    []string `json:"medium_tags"`
	LocationLabel *string  `json:"location_label"`
}

type noteResponse struct {
	ID        string `json:"id"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

type applicationResponse struct {
	ID          string          `json:"id"`
	FormID      string          `json:"form_id"`
	ArtistID    string          `json:"artist_id"`
	Status      string          `json:"status"`
	Rank        int32           `json:"rank"`
	Shortlisted bool            `json:"shortlisted"`
	ReviewFlag  bool            `json:"review_flag"`
	Answers     json.RawMessage `json:"answers"`
	CreatedAt   string          `json:"created_at"`
	UpdatedAt   string          `json:"updated_at"`
	Artist      *artistSummary  `json:"artist,omitempty"`
	Notes       []noteResponse  `json:"notes"`
}

func toApplicationResponse(a sqlcdb.Application) applicationResponse {
	return applicationResponse{
		ID:          a.ID.String(),
		FormID:      a.FormID.String(),
		ArtistID:    a.ArtistID.String(),
		Status:      string(a.Status),
		Rank:        a.Rank,
		Shortlisted: a.Shortlisted,
		ReviewFlag:  a.ReviewFlag,
		Answers:     a.Answers,
		CreatedAt:   a.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:   a.UpdatedAt.Time.Format(time.RFC3339),
		Notes:       []noteResponse{},
	}
}

func toEnrichedResponse(
	row sqlcdb.ListApplicationsByFormWithArtistRow,
	notes []noteResponse,
) applicationResponse {
	return applicationResponse{
		ID:          row.ID.String(),
		FormID:      row.FormID.String(),
		ArtistID:    row.ArtistID.String(),
		Status:      string(row.Status),
		Rank:        row.Rank,
		Shortlisted: row.Shortlisted,
		ReviewFlag:  row.ReviewFlag,
		Answers:     row.Answers,
		CreatedAt:   row.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:   row.UpdatedAt.Time.Format(time.RFC3339),
		Artist: &artistSummary{
			DisplayName:   row.DisplayName,
			AvatarS3Key:   row.AvatarS3Key,
			MediumTags:    row.MediumTags,
			LocationLabel: row.LocationLabel,
		},
		Notes: notes,
	}
}

func toNoteResponse(n sqlcdb.ApplicationNote) noteResponse {
	return noteResponse{
		ID:        n.ID.String(),
		Content:   n.Content,
		CreatedAt: n.CreatedAt.Time.Format(time.RFC3339),
	}
}
```

- [ ] **Verify the package still compiles**

```bash
cd api && go build ./... && cd ..
```

- [ ] **Commit**

```bash
git add api/internal/festival/application.go
git commit -m "feat: extend applicationResponse with rank, flags, artist, and notes"
```

---

## Task 4: Notification Helper

**Files:**
- Create: `api/internal/festival/notification.go`

- [ ] **Write `notification.go`**

```go
package festival

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// sendApplicationNotification emails the artist about a status change.
// Runs in a detached goroutine — errors are logged, never propagated.
func sendApplicationNotification(pool *pgxpool.Pool, mailer auth.EmailSender, artistID sqlcdb.ApplicationArtistID, festivalName, status string) {
	// capture values before goroutine
	artistUUID := artistID
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByID(ctx, pgtype.UUID(artistUUID))
		if err != nil {
			slog.Error("application notification: get artist profile", "err", err)
			return
		}
		user, err := q.GetUserByID(ctx, profile.UserID)
		if err != nil {
			slog.Error("application notification: get user", "err", err)
			return
		}

		subject := "Your application to " + festivalName
		var body string
		switch status {
		case "accepted":
			body = "Congratulations — your application to " + festivalName + " has been accepted."
		case "declined":
			body = "Thank you for applying to " + festivalName + ". Unfortunately your application was not successful this time."
		case "waitlisted":
			body = "Thank you for applying to " + festivalName + ". You're on the waitlist — we'll be in touch if a spot opens up."
		default:
			return
		}

		if err := mailer.Send(ctx, user.Email, subject, "<p>"+body+"</p>"); err != nil {
			slog.Error("application notification: send failed", "err", err, "to", user.Email)
		}
	}()
}
```

Wait — `sqlcdb.ApplicationArtistID` doesn't exist. `ArtistID` on Application is `pgtype.UUID`. Rewrite `notification.go` correctly:

```go
package festival

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// sendApplicationNotification emails the artist about a status change.
// Runs in a detached goroutine — errors are logged, never propagated.
func sendApplicationNotification(pool *pgxpool.Pool, mailer auth.EmailSender, artistID pgtype.UUID, festivalName, status string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByID(ctx, artistID)
		if err != nil {
			slog.Error("application notification: get artist profile", "err", err)
			return
		}
		user, err := q.GetUserByID(ctx, profile.UserID)
		if err != nil {
			slog.Error("application notification: get user", "err", err)
			return
		}

		subject := "Your application to " + festivalName
		var body string
		switch status {
		case "accepted":
			body = "Congratulations — your application to " + festivalName + " has been accepted."
		case "declined":
			body = "Thank you for applying to " + festivalName + ". Unfortunately your application was not successful this time."
		case "waitlisted":
			body = "Thank you for applying to " + festivalName + ". You're on the waitlist — we'll be in touch if a spot opens up."
		default:
			return
		}

		if err := mailer.Send(ctx, user.Email, subject, "<p>"+body+"</p>"); err != nil {
			slog.Error("application notification: send failed", "err", err, "to", user.Email)
		}
	}()
}
```

- [ ] **Verify compilation**

```bash
cd api && go build ./... && cd ..
```

- [ ] **Commit**

```bash
git add api/internal/festival/notification.go
git commit -m "feat: add application notification helper"
```

---

## Task 5: Waitlist Handler

**Files:**
- Create: `api/internal/festival/waitlist.go`
- Create: `api/internal/festival/waitlist_test.go`

- [ ] **Write the failing test first** (`waitlist_test.go`)

```go
package festival_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
)

func TestWaitlistApplication(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/waitlist",
		festival.WaitlistApplicationHandler(db, auth.NoopMailer{}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/waitlist",
		"", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var app map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&app))
	_ = resp.Body.Close()
	assert.Equal(t, "waitlisted", app["status"])
}

func TestWaitlistApplication_ForbiddenForNonOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	_, otherToken := createTestUser(t, db, "waitother@example.com")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/waitlist",
		festival.WaitlistApplicationHandler(db, auth.NoopMailer{}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/waitlist",
		"", otherToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}
```

- [ ] **Run the test — expect compile failure**

```bash
cd api && go test ./internal/festival/... -run TestWaitlist -v && cd ..
```
Expected: compile error — `WaitlistApplicationHandler` undefined.

- [ ] **Implement `waitlist.go`**

```go
package festival

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// WaitlistApplicationHandler handles POST /festivals/{festivalID}/applications/{applicationID}/waitlist.
func WaitlistApplicationHandler(pool *pgxpool.Pool, mailer auth.EmailSender) http.HandlerFunc {
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
		appUUID, err := pgUUIDFromString(chi.URLParam(r, "applicationID"))
		if err != nil {
			httperr.BadRequest(w, "invalid applicationID")
			return
		}

		q := sqlcdb.New(pool)
		fest, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if fest.OrganiserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		updated, err := q.UpdateApplicationStatus(r.Context(), sqlcdb.UpdateApplicationStatusParams{
			ID:     appUUID,
			Status: sqlcdb.ApplicationStatusWaitlisted,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		sendApplicationNotification(pool, mailer, updated.ArtistID, fest.Name, "waitlisted")

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toApplicationResponse(updated))
	}
}
```

- [ ] **Run the test — expect pass**

```bash
cd api && go test ./internal/festival/... -run TestWaitlist -v && cd ..
```
Expected: both tests PASS.

- [ ] **Commit**

```bash
git add api/internal/festival/waitlist.go api/internal/festival/waitlist_test.go
git commit -m "feat: add waitlist application handler"
```

---

## Task 6: Patch Flags Handler

**Files:**
- Create: `api/internal/festival/patch.go`
- Create: `api/internal/festival/patch_test.go`

- [ ] **Write the failing test** (`patch_test.go`)

```go
package festival_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestPatchApplicationFlags(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/applications/{applicationID}",
		festival.PatchApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"shortlisted":true,"review_flag":false}`
	resp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		body, sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var app map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&app))
	_ = resp.Body.Close()
	assert.Equal(t, true, app["shortlisted"])
	assert.Equal(t, false, app["review_flag"])
}

func TestPatchApplicationFlags_ForbiddenForNonOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	_, otherToken := createTestUser(t, db, "patchother@example.com")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/applications/{applicationID}",
		festival.PatchApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		`{"shortlisted":true,"review_flag":false}`, otherToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}
```

- [ ] **Run — expect compile failure**

```bash
cd api && go test ./internal/festival/... -run TestPatchApplication -v && cd ..
```
Expected: `PatchApplicationHandler` undefined.

- [ ] **Implement `patch.go`** (flags handler only — reorder added in Task 7)

```go
package festival

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// PatchApplicationHandler handles PATCH /festivals/{festivalID}/applications/{applicationID}.
// Accepts { "shortlisted": bool, "review_flag": bool } — both fields always required.
func PatchApplicationHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		appUUID, err := pgUUIDFromString(chi.URLParam(r, "applicationID"))
		if err != nil {
			httperr.BadRequest(w, "invalid applicationID")
			return
		}

		q := sqlcdb.New(pool)
		fest, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if fest.OrganiserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		var req struct {
			Shortlisted bool `json:"shortlisted"`
			ReviewFlag  bool `json:"review_flag"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		updated, err := q.UpdateApplicationFlags(r.Context(), sqlcdb.UpdateApplicationFlagsParams{
			ID:          appUUID,
			Shortlisted: req.Shortlisted,
			ReviewFlag:  req.ReviewFlag,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toApplicationResponse(updated))
	}
}
```

- [ ] **Run — expect pass**

```bash
cd api && go test ./internal/festival/... -run TestPatchApplication -v && cd ..
```
Expected: both tests PASS.

- [ ] **Commit**

```bash
git add api/internal/festival/patch.go api/internal/festival/patch_test.go
git commit -m "feat: add patch application flags handler"
```

---

## Task 7: Reorder Handler

**Files:**
- Modify: `api/internal/festival/patch.go` (append)
- Modify: `api/internal/festival/patch_test.go` (append)

- [ ] **Write the failing test** — add to `patch_test.go`:

```go
func TestReorderApplications(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	// Create a second application
	sc2 := setupReviewScenario(t, db) // different festival — we need a second app in the same festival
	// Instead, add another artist+application to sc's festival directly:
	artistID2, _ := createTestUser(t, db, "reorder-artist2@example.com")
	createTestArtistProfile(t, db, artistID2, "Reorder Artist 2")
	appID2 := createTestApplicationInFestival(t, db, sc.festID, artistID2)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/reorder",
		festival.ReorderApplicationsHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Put appID2 first, sc.applicationID second
	body := `{"status":"submitted","ids":["` + appID2 + `","` + sc.applicationID + `"]}`
	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/reorder",
		body, sc.orgToken)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	_ = resp.Body.Close()
}
```

Also add the helper `createTestApplicationInFestival` to `testhelpers_test.go`:

```go
func createTestApplicationInFestival(t *testing.T, pool *pgxpool.Pool, festivalID, userID string) string {
	t.Helper()
	q := sqlcdb.New(pool)
	form, err := q.GetApplicationFormByFestivalID(context.Background(), pgUUID(t, festivalID))
	require.NoError(t, err)
	profile, err := q.GetArtistProfileByUserID(context.Background(), pgUUID(t, userID))
	require.NoError(t, err)
	app, err := q.CreateApplication(context.Background(), sqlcdb.CreateApplicationParams{
		FormID:   form.ID,
		ArtistID: profile.ID,
		Answers:  []byte(`{}`),
	})
	require.NoError(t, err)
	return app.ID.String()
}
```

- [ ] **Run — expect compile failure**

```bash
cd api && go test ./internal/festival/... -run TestReorderApplications -v && cd ..
```
Expected: `ReorderApplicationsHandler` undefined.

- [ ] **Implement `ReorderApplicationsHandler`** — append to `patch.go`:

```go
// ReorderApplicationsHandler handles POST /festivals/{festivalID}/applications/reorder.
// Body: { "status": "submitted", "ids": ["uuid1", "uuid2", ...] }
// Sets rank = 0, 1, 2… for the given IDs within the given status bucket.
func ReorderApplicationsHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		fest, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if fest.OrganiserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		var req struct {
			Status string   `json:"status"`
			IDs    []string `json:"ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if len(req.IDs) == 0 {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		tx, err := pool.Begin(r.Context())
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		defer tx.Rollback(r.Context()) //nolint:errcheck

		qtx := sqlcdb.New(tx)
		for i, idStr := range req.IDs {
			appUUID, err := pgUUIDFromString(idStr)
			if err != nil {
				httperr.BadRequest(w, "invalid application id: "+idStr)
				return
			}
			if err := qtx.UpdateApplicationRank(r.Context(), sqlcdb.UpdateApplicationRankParams{
				Rank: int32(i),
				ID:   appUUID,
			}); err != nil {
				httperr.InternalServerError(w)
				return
			}
		}

		if err := tx.Commit(r.Context()); err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
```

- [ ] **Run — expect pass**

```bash
cd api && go test ./internal/festival/... -run TestReorderApplications -v && cd ..
```
Expected: PASS.

- [ ] **Commit**

```bash
git add api/internal/festival/patch.go api/internal/festival/patch_test.go api/internal/festival/testhelpers_test.go
git commit -m "feat: add reorder applications handler"
```

---

## Task 8: Notes Handler

**Files:**
- Create: `api/internal/festival/notes.go`
- Create: `api/internal/festival/notes_test.go`

- [ ] **Write the failing test** (`notes_test.go`)

```go
package festival_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestAddApplicationNote(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/notes",
		festival.AddApplicationNoteHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"content":"Strong portfolio, worth a call."}`
	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/notes",
		body, sc.orgToken)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var note map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&note))
	_ = resp.Body.Close()
	assert.Equal(t, "Strong portfolio, worth a call.", note["content"])
	assert.NotEmpty(t, note["id"])
}

func TestAddApplicationNote_EmptyContentRejected(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/notes",
		festival.AddApplicationNoteHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/notes",
		`{"content":""}`, sc.orgToken)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestAddApplicationNote_ForbiddenForNonOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	_, otherToken := createTestUser(t, db, "notesother@example.com")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/notes",
		festival.AddApplicationNoteHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/notes",
		`{"content":"sneaky"}`, otherToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}
```

- [ ] **Run — expect compile failure**

```bash
cd api && go test ./internal/festival/... -run TestAddApplicationNote -v && cd ..
```

- [ ] **Implement `notes.go`**

```go
package festival

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// AddApplicationNoteHandler handles POST /festivals/{festivalID}/applications/{applicationID}/notes.
func AddApplicationNoteHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		appUUID, err := pgUUIDFromString(chi.URLParam(r, "applicationID"))
		if err != nil {
			httperr.BadRequest(w, "invalid applicationID")
			return
		}

		q := sqlcdb.New(pool)
		fest, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if fest.OrganiserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		var req struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if strings.TrimSpace(req.Content) == "" {
			httperr.UnprocessableEntity(w, "content is required")
			return
		}

		note, err := q.CreateApplicationNote(r.Context(), sqlcdb.CreateApplicationNoteParams{
			ApplicationID: appUUID,
			Content:       req.Content,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toNoteResponse(note))
	}
}
```

- [ ] **Run — expect pass**

```bash
cd api && go test ./internal/festival/... -run TestAddApplicationNote -v && cd ..
```
Expected: all three tests PASS.

- [ ] **Commit**

```bash
git add api/internal/festival/notes.go api/internal/festival/notes_test.go
git commit -m "feat: add application notes handler"
```

---

## Task 9: Rewrite List Handler

**Files:**
- Modify: `api/internal/festival/review.go` (rewrite `ListApplicationsHandler`)
- Modify: `api/internal/festival/review_test.go` (update `TestListApplications`)

- [ ] **Update `TestListApplications` in `review_test.go`** to assert enriched fields:

Replace the existing `TestListApplications` function:

```go
func TestListApplications(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/applications", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()
	require.Len(t, list, 1)

	app := list[0]
	assert.Equal(t, sc.applicationID, app["id"])
	// Artist summary is present
	artist, ok := app["artist"].(map[string]any)
	require.True(t, ok, "artist field missing or wrong type")
	assert.Equal(t, "Review Artist", artist["display_name"])
	// Notes array is present and empty initially
	notes, ok := app["notes"].([]any)
	require.True(t, ok, "notes field missing or wrong type")
	assert.Empty(t, notes)
	// New fields present
	assert.Equal(t, false, app["shortlisted"])
	assert.Equal(t, false, app["review_flag"])
}
```

- [ ] **Run — expect failure** (list handler doesn't return enriched data yet)

```bash
cd api && go test ./internal/festival/... -run TestListApplications -v && cd ..
```
Expected: FAIL — `artist field missing or wrong type`.

- [ ] **Rewrite `ListApplicationsHandler` in `review.go`**

Replace the existing `ListApplicationsHandler` function (leave `AcceptApplicationHandler` and `DeclineApplicationHandler` in place for now):

```go
// ListApplicationsHandler handles GET /festivals/{festivalID}/applications.
// Returns applications enriched with artist profile data and notes.
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
		fest, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if fest.OrganiserID.String() != principal.UserID {
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

		rows, err := q.ListApplicationsByFormWithArtist(r.Context(), form.ID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Batch-fetch notes for all applications
		notesByApp := map[string][]noteResponse{}
		if len(rows) > 0 {
			appIDs := make([]pgtype.UUID, len(rows))
			for i, row := range rows {
				appIDs[i] = row.ID
				notesByApp[row.ID.String()] = []noteResponse{}
			}
			allNotes, err := q.ListNotesByApplications(r.Context(), appIDs)
			if err != nil {
				httperr.InternalServerError(w)
				return
			}
			for _, n := range allNotes {
				key := n.ApplicationID.String()
				notesByApp[key] = append(notesByApp[key], toNoteResponse(n))
			}
		}

		resp := make([]applicationResponse, len(rows))
		for i, row := range rows {
			resp[i] = toEnrichedResponse(row, notesByApp[row.ID.String()])
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
```

Also add `"github.com/jackc/pgx/v5/pgtype"` to the import block in `review.go` if not already present.

- [ ] **Run — expect pass**

```bash
cd api && go test ./internal/festival/... -run TestListApplications -v && cd ..
```
Expected: PASS.

- [ ] **Run full festival package tests**

```bash
cd api && go test ./internal/festival/... -v && cd ..
```
Expected: all pass.

- [ ] **Commit**

```bash
git add api/internal/festival/review.go api/internal/festival/review_test.go
git commit -m "feat: rewrite list handler with enriched artist + notes response"
```

---

## Task 10: Add Notifications to Accept and Decline

**Files:**
- Modify: `api/internal/festival/review.go` (update `AcceptApplicationHandler`, `DeclineApplicationHandler` signatures)
- Modify: `api/internal/festival/review_test.go` (update call sites)

- [ ] **Update `AcceptApplicationHandler` signature and add notification**

In `review.go`, change:
```go
func AcceptApplicationHandler(pool *pgxpool.Pool) http.HandlerFunc {
```
to:
```go
func AcceptApplicationHandler(pool *pgxpool.Pool, mailer auth.EmailSender) http.HandlerFunc {
```

Add the import `"github.com/sniffins-mcmuggins/render/api/internal/auth"` if not present.

After the `AddFestivalArtist` call succeeds, add:
```go
sendApplicationNotification(pool, mailer, app.ArtistID, fest.Name, "accepted")
```

- [ ] **Update `DeclineApplicationHandler` signature and add notification**

Change:
```go
func DeclineApplicationHandler(pool *pgxpool.Pool) http.HandlerFunc {
```
to:
```go
func DeclineApplicationHandler(pool *pgxpool.Pool, mailer auth.EmailSender) http.HandlerFunc {
```

After the `UpdateApplicationStatus` call succeeds, add:
```go
sendApplicationNotification(pool, mailer, updated.ArtistID, fest.Name, "declined")
```

To get `fest.Name` in `DeclineApplicationHandler`, add a `GetFestivalByID` call before `UpdateApplicationStatus` (it currently doesn't fetch the festival — it only does the ownership check then immediately updates):

```go
fest, err := q.GetFestivalByID(r.Context(), festUUID)
if err != nil {
    if errors.Is(err, pgx.ErrNoRows) {
        httperr.NotFound(w)
        return
    }
    httperr.InternalServerError(w)
    return
}
if fest.OrganiserID.String() != principal.UserID {
    httperr.Forbidden(w)
    return
}
```

- [ ] **Update `review_test.go` call sites** — add `auth.NoopMailer{}` to both accept and decline:

```go
// TestAcceptApplication
r.Post("…/accept", festival.AcceptApplicationHandler(db, auth.NoopMailer{}))

// TestDeclineApplication
r.Post("…/decline", festival.DeclineApplicationHandler(db, auth.NoopMailer{}))

// TestReview_ForbiddenForNonOwner
r.Get("…/applications", festival.ListApplicationsHandler(db))
// (list handler signature unchanged)
```

- [ ] **Run all festival tests**

```bash
cd api && go test ./internal/festival/... -race -count=1 && cd ..
```
Expected: all pass.

- [ ] **Commit**

```bash
git add api/internal/festival/review.go api/internal/festival/review_test.go
git commit -m "feat: add email notifications to accept and decline handlers"
```

---

## Task 11: Wire Routes + Update OpenAPI Spec

**Files:**
- Modify: `api/cmd/api/main.go`
- Modify: `openapi/openapi.yaml`

- [ ] **Update `main.go` — add new routes and pass mailer**

In `main.go`, find the applications route block (around line 168–170) and replace it:

```go
r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(pool))
r.Post("/festivals/{festivalID}/applications/{applicationID}/accept", festival.AcceptApplicationHandler(pool, mailer))
r.Post("/festivals/{festivalID}/applications/{applicationID}/decline", festival.DeclineApplicationHandler(pool, mailer))
r.Post("/festivals/{festivalID}/applications/{applicationID}/waitlist", festival.WaitlistApplicationHandler(pool, mailer))
r.Patch("/festivals/{festivalID}/applications/{applicationID}", festival.PatchApplicationHandler(pool))
r.Post("/festivals/{festivalID}/applications/reorder", festival.ReorderApplicationsHandler(pool))
r.Post("/festivals/{festivalID}/applications/{applicationID}/notes", festival.AddApplicationNoteHandler(pool))
```

Note: `reorder` must be registered before `{applicationID}` routes so chi doesn't swallow it as an applicationID. Verify the route order matches the above.

- [ ] **Build the API to confirm wiring**

```bash
cd api && go build ./... && cd ..
```
Expected: no errors.

- [ ] **Update `openapi/openapi.yaml`** — add new schemas and endpoints

**Add to `components/schemas`** (after `Application`):

```yaml
    ApplicationArtist:
      type: object
      properties:
        display_name:
          type: string
        avatar_s3_key:
          type: string
          nullable: true
        medium_tags:
          type: array
          items:
            type: string
        location_label:
          type: string
          nullable: true

    ApplicationNote:
      type: object
      properties:
        id:
          type: string
          format: uuid
        content:
          type: string
        created_at:
          type: string
          format: date-time
```

**Update `ApplicationStatus` enum:**

```yaml
    ApplicationStatus:
      type: string
      enum: [submitted, accepted, declined, waitlisted]
```

**Update `Application` schema** to include new fields:

```yaml
    Application:
      type: object
      properties:
        id:
          type: string
          format: uuid
        form_id:
          type: string
          format: uuid
        artist_id:
          type: string
          format: uuid
        status:
          $ref: "#/components/schemas/ApplicationStatus"
        rank:
          type: integer
        shortlisted:
          type: boolean
        review_flag:
          type: boolean
        answers:
          type: object
        created_at:
          type: string
          format: date-time
        updated_at:
          type: string
          format: date-time
        artist:
          $ref: "#/components/schemas/ApplicationArtist"
        notes:
          type: array
          items:
            $ref: "#/components/schemas/ApplicationNote"
```

**Add new paths** (in the `paths` section, grouped with existing application endpoints):

```yaml
  /festivals/{festivalID}/applications/{applicationID}/waitlist:
    post:
      tags: [festivals]
      summary: Waitlist an application
      security:
        - bearerAuth: []
      parameters:
        - name: festivalID
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: applicationID
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Application waitlisted
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Application"

  /festivals/{festivalID}/applications/{applicationID}:
    patch:
      tags: [festivals]
      summary: Update application flags (shortlisted, review_flag)
      security:
        - bearerAuth: []
      parameters:
        - name: festivalID
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: applicationID
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [shortlisted, review_flag]
              properties:
                shortlisted:
                  type: boolean
                review_flag:
                  type: boolean
      responses:
        "200":
          description: Flags updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Application"

  /festivals/{festivalID}/applications/reorder:
    post:
      tags: [festivals]
      summary: Reorder applications within a status bucket
      security:
        - bearerAuth: []
      parameters:
        - name: festivalID
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [status, ids]
              properties:
                status:
                  type: string
                ids:
                  type: array
                  items:
                    type: string
                    format: uuid
      responses:
        "204":
          description: Reordered

  /festivals/{festivalID}/applications/{applicationID}/notes:
    post:
      tags: [festivals]
      summary: Add a note to an application
      security:
        - bearerAuth: []
      parameters:
        - name: festivalID
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: applicationID
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [content]
              properties:
                content:
                  type: string
      responses:
        "201":
          description: Note created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ApplicationNote"
```

- [ ] **Regenerate API clients**

```bash
task generate
```
Expected: no errors. This regenerates `api/internal/openapi/api.gen.go` and the TypeScript client under `openapi/client/`.

- [ ] **Run all API tests**

```bash
task api:test
```
Expected: all pass.

- [ ] **Commit**

```bash
git add api/cmd/api/main.go openapi/openapi.yaml api/internal/openapi/ openapi/client/
git commit -m "feat: wire new application review routes and update OpenAPI spec"
```

---

## Task 12: Install @dnd-kit + ApplicationCard

**Files:**
- Create: `web/src/components/ApplicationCard.tsx`

- [ ] **Install dnd-kit packages**

Run from `web/` directory:
```bash
cd web && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities && cd ..
```
Expected: packages added to `package.json`.

- [ ] **Write `ApplicationCard.tsx`**

```tsx
'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']
type ApplicationArtist = components['schemas']['ApplicationArtist']

interface Props {
  application: Application
  onSelect: (app: Application) => void
  onAccept: (id: string) => void
  onDecline: (id: string) => void
  onWaitlist: (id: string) => void
  onToggleShortlist: (id: string, current: boolean, reviewFlag: boolean) => void
  onToggleReviewFlag: (id: string, shortlisted: boolean, current: boolean) => void
  isPending: boolean
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const ACTION_TRANSITIONS: Record<string, string[]> = {
  submitted: ['accept', 'waitlist', 'decline'],
  accepted: ['decline'],
  waitlisted: ['accept', 'decline'],
  declined: [],
}

export function ApplicationCard({
  application,
  onSelect,
  onAccept,
  onDecline,
  onWaitlist,
  onToggleShortlist,
  onToggleReviewFlag,
  isPending,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: application.id ?? '' })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const artist = application.artist as ApplicationArtist | undefined
  const name = artist?.display_name ?? 'Unknown Artist'
  const tags = artist?.medium_tags ?? []
  const actions = ACTION_TRANSITIONS[application.status ?? ''] ?? []
  const id = application.id ?? ''

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-3 p-4 bg-warm border border-light rounded-lg"
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="mt-1 cursor-grab text-light hover:text-mid touch-none flex-shrink-0"
        aria-label="Drag to reorder"
        tabIndex={-1}
      >
        ⠿
      </button>

      {/* Avatar */}
      <div
        className="w-10 h-10 rounded-full bg-clay flex items-center justify-center text-offwhite font-sans font-bold text-sm flex-shrink-0 cursor-pointer"
        onClick={() => onSelect(application)}
      >
        {initials(name)}
      </div>

      {/* Main content */}
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => onSelect(application)}
      >
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-sans font-semibold text-ink text-sm">{name}</span>
          {artist?.location_label && (
            <span className="font-sans text-xs text-mid">{artist.location_label}</span>
          )}
          <span className="font-sans text-xs text-mid">
            · Applied {formatDate(application.created_at ?? '')}
          </span>
        </div>
        {tags.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-1">
            {tags.slice(0, 3).map(tag => (
              <span
                key={tag}
                className="font-mono text-xs text-mid bg-white border border-light rounded px-1.5 py-0.5 uppercase tracking-wider"
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="font-mono text-xs text-mid px-1">+{tags.length - 3}</span>
            )}
          </div>
        )}
      </div>

      {/* Flags + actions */}
      <div className="flex flex-col gap-2 items-end flex-shrink-0">
        <div className="flex gap-1">
          <button
            onClick={() => onToggleShortlist(id, application.shortlisted ?? false, application.review_flag ?? false)}
            disabled={isPending}
            className={`text-base leading-none ${application.shortlisted ? 'text-amber' : 'text-light hover:text-mid'} disabled:opacity-50`}
            title={application.shortlisted ? 'Remove shortlist' : 'Shortlist'}
          >
            ⭐
          </button>
          <button
            onClick={() => onToggleReviewFlag(id, application.shortlisted ?? false, application.review_flag ?? false)}
            disabled={isPending}
            className={`text-base leading-none ${application.review_flag ? 'text-clay' : 'text-light hover:text-mid'} disabled:opacity-50`}
            title={application.review_flag ? 'Remove review flag' : 'Flag for review'}
          >
            🚩
          </button>
        </div>
        <div className="flex gap-1.5">
          {actions.includes('accept') && (
            <button
              onClick={() => onAccept(id)}
              disabled={isPending}
              className="font-sans text-xs font-semibold bg-amber text-ink px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              Accept
            </button>
          )}
          {actions.includes('waitlist') && (
            <button
              onClick={() => onWaitlist(id)}
              disabled={isPending}
              className="font-sans text-xs text-mid border border-light px-3 py-1.5 rounded-lg hover:opacity-80 disabled:opacity-50"
            >
              Waitlist
            </button>
          )}
          {actions.includes('decline') && (
            <button
              onClick={() => onDecline(id)}
              disabled={isPending}
              className="font-sans text-xs text-clay border border-clay/30 px-3 py-1.5 rounded-lg hover:opacity-80 disabled:opacity-50"
            >
              Decline
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Verify TypeScript compilation**

```bash
task web:typecheck 2>/dev/null || cd web && npx tsc --noEmit && cd ..
```
Expected: no errors.

- [ ] **Commit**

```bash
git add web/package.json web/package-lock.json web/src/components/ApplicationCard.tsx
git commit -m "feat: add ApplicationCard component with dnd-kit sortable"
```

---

## Task 13: ApplicationNotes Component

**Files:**
- Create: `web/src/components/ApplicationNotes.tsx`

- [ ] **Write `ApplicationNotes.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type ApplicationNote = components['schemas']['ApplicationNote']

interface Props {
  festivalId: string
  applicationId: string
  notes: ApplicationNote[]
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ApplicationNotes({ festivalId, applicationId, notes }: Props) {
  const [content, setContent] = useState('')
  const queryClient = useQueryClient()

  const addNote = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiClient.POST(
        '/festivals/{festivalID}/applications/{applicationID}/notes',
        {
          params: { path: { festivalID: festivalId, applicationID: applicationId } },
          body: { content: text },
        }
      )
      if (res.error) throw new Error('Failed to add note')
      return res.data
    },
    onSuccess: () => {
      setContent('')
      queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (content.trim()) addNote.mutate(content.trim())
  }

  return (
    <div>
      <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-3">Internal Notes</h3>

      {notes.length === 0 && (
        <p className="font-sans text-xs text-mid mb-4">No notes yet.</p>
      )}

      {notes.length > 0 && (
        <ul className="space-y-3 mb-4">
          {notes.map(note => (
            <li key={note.id} className="bg-white border border-light rounded-lg p-3">
              <p className="font-sans text-sm text-ink">{note.content}</p>
              <p className="font-sans text-xs text-mid mt-1">{formatDate(note.created_at ?? '')}</p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Add a note…"
          rows={3}
          className="font-sans text-sm text-ink bg-white border border-light rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-amber"
        />
        <button
          type="submit"
          disabled={!content.trim() || addNote.isPending}
          className="self-end font-sans text-xs font-semibold bg-amber text-ink px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {addNote.isPending ? 'Adding…' : 'Add note'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Verify TypeScript**

```bash
cd web && npx tsc --noEmit && cd ..
```

- [ ] **Commit**

```bash
git add web/src/components/ApplicationNotes.tsx
git commit -m "feat: add ApplicationNotes component"
```

---

## Task 14: ApplicationSlideOver Component

**Files:**
- Create: `web/src/components/ApplicationSlideOver.tsx`

- [ ] **Write `ApplicationSlideOver.tsx`**

```tsx
'use client'

import { useEffect } from 'react'
import { ApplicationNotes } from './ApplicationNotes'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']
type ApplicationArtist = components['schemas']['ApplicationArtist']

interface FormField {
  id: string
  label: string
  type: string
  required: boolean
}

interface Props {
  application: Application | null
  formFields: FormField[]
  festivalId: string
  onClose: () => void
  onAccept: (id: string) => void
  onDecline: (id: string) => void
  onWaitlist: (id: string) => void
  isPending: boolean
}

const ACTION_TRANSITIONS: Record<string, string[]> = {
  submitted: ['accept', 'waitlist', 'decline'],
  accepted: ['decline'],
  waitlisted: ['accept', 'decline'],
  declined: [],
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

export function ApplicationSlideOver({
  application,
  formFields,
  festivalId,
  onClose,
  onAccept,
  onDecline,
  onWaitlist,
  isPending,
}: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (!application) return null

  const artist = application.artist as ApplicationArtist | undefined
  const name = artist?.display_name ?? 'Unknown Artist'
  const answers = application.answers as Record<string, string> | undefined ?? {}
  const notes = (application.notes ?? []) as components['schemas']['ApplicationNote'][]
  const actions = ACTION_TRANSITIONS[application.status ?? ''] ?? []
  const id = application.id ?? ''

  const labelFor = (fieldId: string): string =>
    formFields.find(f => f.id === fieldId)?.label ?? fieldId

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/20 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-offwhite shadow-xl z-50 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-clay flex items-center justify-center text-offwhite font-bold">
                {initials(name)}
              </div>
              <div>
                <h2 className="font-serif text-xl text-ink">{name}</h2>
                {artist?.location_label && (
                  <p className="font-sans text-sm text-mid">{artist.location_label}</p>
                )}
              </div>
            </div>
            <button onClick={onClose} className="font-sans text-mid hover:text-ink text-xl leading-none">✕</button>
          </div>

          {/* Medium tags */}
          {(artist?.medium_tags ?? []).length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {(artist?.medium_tags ?? []).map(tag => (
                <span key={tag} className="font-mono text-xs text-mid bg-warm border border-light rounded px-2 py-0.5 uppercase tracking-wider">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          {actions.length > 0 && (
            <div className="flex gap-2">
              {actions.includes('accept') && (
                <button onClick={() => onAccept(id)} disabled={isPending}
                  className="font-sans text-sm font-semibold bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
                  Accept
                </button>
              )}
              {actions.includes('waitlist') && (
                <button onClick={() => onWaitlist(id)} disabled={isPending}
                  className="font-sans text-sm text-mid border border-light px-4 py-2 rounded-lg hover:opacity-80 disabled:opacity-50">
                  Waitlist
                </button>
              )}
              {actions.includes('decline') && (
                <button onClick={() => onDecline(id)} disabled={isPending}
                  className="font-sans text-sm text-clay border border-clay/30 px-4 py-2 rounded-lg hover:opacity-80 disabled:opacity-50">
                  Decline
                </button>
              )}
            </div>
          )}

          {/* Application answers */}
          {Object.keys(answers).length > 0 && (
            <div>
              <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-3">Application</h3>
              <div className="space-y-4">
                {Object.entries(answers).map(([fieldId, value]) => (
                  <div key={fieldId}>
                    <p className="font-sans text-xs text-mid mb-1">{labelFor(fieldId)}</p>
                    <p className="font-sans text-sm text-ink">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <ApplicationNotes
            festivalId={festivalId}
            applicationId={id}
            notes={notes}
          />
        </div>
      </div>
    </>
  )
}
```

- [ ] **Verify TypeScript**

```bash
cd web && npx tsc --noEmit && cd ..
```

- [ ] **Commit**

```bash
git add web/src/components/ApplicationSlideOver.tsx
git commit -m "feat: add ApplicationSlideOver detail panel"
```

---

## Task 15: useApplicationReorder Hook + Rewrite Applications Page

**Files:**
- Create: `web/src/hooks/useApplicationReorder.ts`
- Modify: `web/src/app/organiser/festivals/[id]/applications/page.tsx`

- [ ] **Write `useApplicationReorder.ts`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { arrayMove } from '@dnd-kit/sortable'
import type { DragEndEvent } from '@dnd-kit/core'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']

export function useApplicationReorder(
  festivalId: string,
  applications: Application[],
  status: string,
  setApplications: (apps: Application[]) => void
) {
  const queryClient = useQueryClient()

  const reorderMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/reorder', {
        params: { path: { festivalID: festivalId } },
        body: { status, ids },
      })
      if (res.error) throw new Error('Reorder failed')
    },
    onError: () => {
      // Roll back by re-fetching
      queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })
    },
  })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = applications.findIndex(a => a.id === active.id)
    const newIndex = applications.findIndex(a => a.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(applications, oldIndex, newIndex)
    setApplications(reordered) // optimistic update
    reorderMutation.mutate(reordered.map(a => a.id ?? ''))
  }

  return { handleDragEnd }
}
```

- [ ] **Rewrite `applications/page.tsx`**

```tsx
'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import { ApplicationCard } from '@/components/ApplicationCard'
import { ApplicationSlideOver } from '@/components/ApplicationSlideOver'
import { useApplicationReorder } from '@/hooks/useApplicationReorder'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']

interface FormField {
  id: string
  label: string
  type: string
  required: boolean
}

type TabKey = 'pending' | 'shortlisted' | 'accepted' | 'waitlisted' | 'declined'

const TAB_LABELS: Record<TabKey, string> = {
  pending: 'Pending',
  shortlisted: 'Shortlisted',
  accepted: 'Accepted',
  waitlisted: 'Waitlisted',
  declined: 'Declined',
}

function filterTab(apps: Application[], tab: TabKey): Application[] {
  switch (tab) {
    case 'pending':     return apps.filter(a => a.status === 'submitted' && !a.shortlisted)
    case 'shortlisted': return apps.filter(a => a.status === 'submitted' && a.shortlisted)
    case 'accepted':    return apps.filter(a => a.status === 'accepted')
    case 'waitlisted':  return apps.filter(a => a.status === 'waitlisted')
    case 'declined':    return apps.filter(a => a.status === 'declined')
  }
}

type Props = { params: Promise<{ id: string }> }

export default function ApplicationsReviewPage({ params }: Props) {
  const [festivalId, setFestivalId] = useState<string | null>(null)
  if (!festivalId) {
    params.then(p => setFestivalId(p.id))
    return <div className="font-sans text-mid text-sm p-8">Loading…</div>
  }
  return <ApplicationsView festivalId={festivalId} />
}

function ApplicationsView({ festivalId }: { festivalId: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>('pending')
  const [selectedApp, setSelectedApp] = useState<Application | null>(null)
  const [localApps, setLocalApps] = useState<Application[] | null>(null)
  const queryClient = useQueryClient()

  const applicationsQuery = useQuery({
    queryKey: ['festival-applications', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/applications', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Failed to load applications')
      return (res.data ?? []) as Application[]
    },
    onSuccess: (data: Application[]) => setLocalApps(data),
  })

  const formQuery = useQuery({
    queryKey: ['festival-form', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/form', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) return { fields: [] }
      return res.data
    },
  })

  const allApps = localApps ?? applicationsQuery.data ?? []
  const tabApps = useMemo(() => filterTab(allApps, activeTab), [allApps, activeTab])

  const setTabApps = (updated: Application[]) => {
    setLocalApps(prev => {
      if (!prev) return updated
      const tabIds = new Set(tabApps.map(a => a.id))
      const rest = prev.filter(a => !tabIds.has(a.id))
      return [...rest, ...updated]
    })
  }

  const { handleDragEnd } = useApplicationReorder(
    festivalId,
    tabApps,
    activeTab === 'shortlisted' ? 'submitted' : activeTab,
    setTabApps
  )

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })

  const acceptMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/{applicationID}/accept', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
      })
      if (res.error) throw new Error('Accept failed')
    },
    onSuccess: () => { setSelectedApp(null); invalidate() },
  })

  const declineMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/{applicationID}/decline', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
      })
      if (res.error) throw new Error('Decline failed')
    },
    onSuccess: () => { setSelectedApp(null); invalidate() },
  })

  const waitlistMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/{applicationID}/waitlist', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
      })
      if (res.error) throw new Error('Waitlist failed')
    },
    onSuccess: () => { setSelectedApp(null); invalidate() },
  })

  const patchMutation = useMutation({
    mutationFn: async ({ id, shortlisted, reviewFlag }: { id: string; shortlisted: boolean; reviewFlag: boolean }) => {
      const res = await apiClient.PATCH('/festivals/{festivalID}/applications/{applicationID}', {
        params: { path: { festivalID: festivalId, applicationID: id } },
        body: { shortlisted, review_flag: reviewFlag },
      })
      if (res.error) throw new Error('Patch failed')
    },
    onSuccess: invalidate,
  })

  const isPending =
    acceptMutation.isPending ||
    declineMutation.isPending ||
    waitlistMutation.isPending ||
    patchMutation.isPending

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const formFields: FormField[] = (formQuery.data as { fields?: FormField[] })?.fields ?? []

  const counts: Record<TabKey, number> = {
    pending: filterTab(allApps, 'pending').length,
    shortlisted: filterTab(allApps, 'shortlisted').length,
    accepted: filterTab(allApps, 'accepted').length,
    waitlisted: filterTab(allApps, 'waitlisted').length,
    declined: filterTab(allApps, 'declined').length,
  }

  return (
    <div>
      <div className="mb-6">
        <Link
          href={`/organiser/festivals/${festivalId}`}
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors"
        >
          ← Festival
        </Link>
      </div>

      <h1 className="font-serif text-4xl text-ink mb-6">Applications</h1>

      {applicationsQuery.isError && (
        <p role="alert" className="font-sans text-sm text-clay mb-4">Failed to load applications.</p>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-light mb-6 overflow-x-auto">
        {(Object.keys(TAB_LABELS) as TabKey[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`font-sans text-sm px-4 py-2 whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-amber text-ink font-semibold'
                : 'border-transparent text-mid hover:text-ink'
            }`}
          >
            {TAB_LABELS[tab]}
            <span className="ml-1.5 font-mono text-xs">({counts[tab]})</span>
          </button>
        ))}
      </div>

      {applicationsQuery.isLoading && (
        <p className="font-sans text-mid text-sm">Loading…</p>
      )}

      {!applicationsQuery.isLoading && tabApps.length === 0 && (
        <p className="font-sans text-mid text-sm">No applications here.</p>
      )}

      {tabApps.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tabApps.map(a => a.id ?? '')} strategy={verticalListSortingStrategy}>
            <ul className="space-y-3">
              {tabApps.map(app => (
                <li key={app.id}>
                  <ApplicationCard
                    application={app}
                    onSelect={setSelectedApp}
                    onAccept={id => acceptMutation.mutate(id)}
                    onDecline={id => declineMutation.mutate(id)}
                    onWaitlist={id => waitlistMutation.mutate(id)}
                    onToggleShortlist={(id, shortlisted, reviewFlag) =>
                      patchMutation.mutate({ id, shortlisted: !shortlisted, reviewFlag })
                    }
                    onToggleReviewFlag={(id, shortlisted, reviewFlag) =>
                      patchMutation.mutate({ id, shortlisted, reviewFlag: !reviewFlag })
                    }
                    isPending={isPending}
                  />
                </li>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <ApplicationSlideOver
        application={selectedApp}
        formFields={formFields}
        festivalId={festivalId}
        onClose={() => setSelectedApp(null)}
        onAccept={id => acceptMutation.mutate(id)}
        onDecline={id => declineMutation.mutate(id)}
        onWaitlist={id => waitlistMutation.mutate(id)}
        isPending={isPending}
      />
    </div>
  )
}
```

- [ ] **Verify TypeScript**

```bash
cd web && npx tsc --noEmit && cd ..
```
Expected: no errors.

- [ ] **Run all API tests one final time**

```bash
task api:test
```
Expected: all pass.

- [ ] **Commit**

```bash
git add web/src/hooks/useApplicationReorder.ts web/src/app/organiser/festivals/[id]/applications/page.tsx
git commit -m "feat: rewrite applications page with tabs, drag-to-rank, and slide-over"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `waitlisted` status enum value | Task 1 (migration), Task 5 (handler) |
| `rank`, `shortlisted`, `review_flag` columns | Task 1 (migration), Task 2 (queries), Task 6/7 (handlers) |
| `application_notes` table | Task 1 (migration), Task 2 (queries), Task 8 (handler) |
| Enriched list response (artist profile + notes) | Task 2/3 (types + queries), Task 9 (handler) |
| Email notifications on accept/decline/waitlist | Task 4 (helper), Task 5/10 (handlers) |
| Waitlist handler | Task 5 |
| Patch flags handler | Task 6 |
| Reorder handler | Task 7 |
| Notes handler | Task 8 |
| `task db:generate` regenerates all sqlcdb | Task 2 |
| New routes wired in main.go | Task 11 |
| OpenAPI spec updated | Task 11 |
| Tab definitions (pending=submitted+!shortlisted, etc.) | Task 15 (page) |
| ApplicationCard (medium density, flags, actions) | Task 12 |
| ApplicationNotes component | Task 13 |
| ApplicationSlideOver with answers + notes + actions | Task 14 |
| Drag-to-rank with @dnd-kit | Task 12 + Task 15 |
| Optimistic reorder with rollback | Task 15 (useApplicationReorder) |

All spec requirements covered. ✓
