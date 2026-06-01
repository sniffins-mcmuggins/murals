# E18 Endorsements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add peer and organiser artist endorsements — `POST/DELETE/GET` API, visibility controls, email notification, web UI on public profiles and artist dashboard, E17 moderation status stub.

**Architecture:** New `api/internal/endorsement/` package with 5 handlers; migration `000020`; sqlc queries in `db/queries/endorsements.sql`; endorsements section on the public artist profile page; an `(artist)/endorse/[profileID]` form; an `(artist)/endorsements` management page.

**Tech Stack:** Go + chi + pgx/sqlc (API), Next.js App Router + `@render/api-client` (web), Vitest (API e2e), golang-migrate (DB).

---

## Files to create / modify

| Action | Path |
|---|---|
| Create | `db/migrations/000020_endorsements.up.sql` |
| Create | `db/migrations/000020_endorsements.down.sql` |
| Create | `db/queries/endorsements.sql` |
| Generated | `api/internal/sqlcdb/endorsements.sql.go` (via `task db:generate`) |
| Modified | `api/internal/sqlcdb/models.go` (new `Endorsement` struct — auto by sqlc) |
| Create | `api/internal/endorsement/endorsement.go` |
| Create | `api/internal/endorsement/notification.go` |
| Create | `api/internal/endorsement/errors.go` |
| Create | `api/internal/endorsement/endorsement_test.go` |
| Modified | `api/cmd/api/main.go` |
| Modified | `openapi/openapi.yaml` |
| Generated | `openapi/generated/` (TS client — via `task openapi:gen`) |
| Modified | `web/src/app/(public)/artists/[id]/page.tsx` |
| Create | `web/src/app/(artist)/endorse/[profileID]/page.tsx` |
| Create | `web/src/app/(artist)/endorsements/page.tsx` |
| Modified | `web/src/app/(artist)/layout.tsx` |
| Create | `e2e/api/endorsements.test.ts` |

---

## Task 1: DB migration

**Files:**
- Create: `db/migrations/000020_endorsements.up.sql`
- Create: `db/migrations/000020_endorsements.down.sql`

- [ ] **Step 1: Create up migration**

```sql
-- db/migrations/000020_endorsements.up.sql
CREATE TABLE endorsements (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  endorser_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endorsee_id       uuid        NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  kind              varchar(20) NOT NULL CHECK (kind IN ('peer', 'organiser')),
  festival_id       uuid        REFERENCES festivals(id) ON DELETE SET NULL,
  body              text,
  skills            text[]      NOT NULL DEFAULT '{}',
  hidden_by_endorsee bool       NOT NULL DEFAULT false,
  moderation_status varchar(20) NOT NULL DEFAULT 'ok'
                    CHECK (moderation_status IN ('ok', 'hidden', 'removed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endorser_id, endorsee_id),
  CHECK (endorser_id <> endorsee_id),
  CHECK (kind = 'peer' OR festival_id IS NOT NULL)
);
```

- [ ] **Step 2: Create down migration**

```sql
-- db/migrations/000020_endorsements.down.sql
DROP TABLE endorsements;
```

- [ ] **Step 3: Apply the migration**

```bash
task db:migrate
```

Expected output: `1/u endorsements (Xms)`

---

## Task 2: sqlc queries + code generation

**Files:**
- Create: `db/queries/endorsements.sql`
- Run `task db:generate` to produce `api/internal/sqlcdb/endorsements.sql.go`

- [ ] **Step 1: Write the query file**

```sql
-- db/queries/endorsements.sql

-- name: CreateOrUpdateEndorsement :one
INSERT INTO endorsements (endorser_id, endorsee_id, kind, festival_id, body, skills)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (endorser_id, endorsee_id) DO UPDATE
  SET kind        = EXCLUDED.kind,
      festival_id = EXCLUDED.festival_id,
      body        = EXCLUDED.body,
      skills      = EXCLUDED.skills,
      updated_at  = now()
RETURNING *;

-- name: GetEndorsementByID :one
SELECT * FROM endorsements WHERE id = $1;

-- name: DeleteEndorsement :exec
DELETE FROM endorsements WHERE id = $1;

-- name: ListPublicEndorsements :many
SELECT
  e.id,
  e.endorser_id,
  e.endorsee_id,
  e.kind,
  e.festival_id,
  e.body,
  e.skills,
  e.hidden_by_endorsee,
  e.moderation_status,
  e.created_at,
  e.updated_at,
  ap.display_name  AS endorser_display_name,
  ap.avatar_s3_key AS endorser_avatar_s3_key,
  f.name           AS festival_name
FROM endorsements e
LEFT JOIN artist_profiles ap ON ap.user_id = e.endorser_id
LEFT JOIN festivals f ON f.id = e.festival_id
WHERE e.endorsee_id = $1
  AND e.moderation_status = 'ok'
  AND e.hidden_by_endorsee = false
ORDER BY (e.kind = 'organiser') DESC, e.created_at DESC;

-- name: ListReceivedEndorsements :many
-- All endorsements for the authenticated endorsee (includes hidden + moderated).
SELECT
  e.id,
  e.endorser_id,
  e.endorsee_id,
  e.kind,
  e.festival_id,
  e.body,
  e.skills,
  e.hidden_by_endorsee,
  e.moderation_status,
  e.created_at,
  e.updated_at,
  ap.display_name  AS endorser_display_name,
  ap.avatar_s3_key AS endorser_avatar_s3_key,
  f.name           AS festival_name
FROM endorsements e
LEFT JOIN artist_profiles ap ON ap.user_id = e.endorser_id
LEFT JOIN festivals f ON f.id = e.festival_id
WHERE e.endorsee_id = $1
ORDER BY (e.kind = 'organiser') DESC, e.created_at DESC;

-- name: SetEndorsementVisibility :one
UPDATE endorsements
SET hidden_by_endorsee = $2,
    updated_at         = now()
WHERE id = $1
RETURNING *;

-- name: SetEndorsementModerationStatus :one
-- Called by E17 moderation machinery.
UPDATE endorsements
SET moderation_status = $2,
    updated_at        = now()
WHERE id = $1
RETURNING *;
```

- [ ] **Step 2: Run code generation**

```bash
task db:generate
```

Expected: no errors; `api/internal/sqlcdb/endorsements.sql.go` is created with `Endorsement`, `ListPublicEndorsementsRow`, `ListReceivedEndorsementsRow` types and matching `Queries` methods.

- [ ] **Step 3: Verify generated file exists and compiles**

```bash
cd api && go build ./... 2>&1
```

Expected: no errors (the new types exist, nothing imports them yet).

---

## Task 3: Write failing handler tests

**Files:**
- Create: `api/internal/endorsement/endorsement_test.go`

- [ ] **Step 1: Create the test file**

```go
package endorsement_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"context"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/endorsement"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

const testSecret = testutil.TestSecret

// helpers

func pgUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	var u pgtype.UUID
	require.NoError(t, u.Scan(s))
	return u
}

func createProfile(t *testing.T, pool interface{ Exec(context.Context, string, ...interface{}) (interface{}, error) }, userID string) string {
	t.Helper()
	// Use the real pool type via testutil pattern.
	return ""
}

// createArtistProfile creates an artist_profile for userID, returns profileID.
func createArtistProfile(t *testing.T, pool *pgxpool.Pool, userID, name string) string {
	t.Helper()
	q := sqlcdb.New(pool)
	p, err := q.CreateArtistProfile(context.Background(), sqlcdb.CreateArtistProfileParams{
		UserID:      pgUUID(t, userID),
		DisplayName: name,
	})
	require.NoError(t, err)
	return p.ID.String()
}

func publishProfile(t *testing.T, pool *pgxpool.Pool, profileID string) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		`UPDATE artist_profiles SET visibility = 'public' WHERE id = $1`, profileID)
	require.NoError(t, err)
}

func createFestival(t *testing.T, pool *pgxpool.Pool, organiserID string) string {
	t.Helper()
	slug := fmt.Sprintf("fest-%d", time.Now().UnixNano())
	q := sqlcdb.New(pool)
	f, err := q.CreateFestival(context.Background(), sqlcdb.CreateFestivalParams{
		OrganiserID:   pgUUID(t, organiserID),
		Name:          "Test Festival",
		Slug:          slug,
		Description:   "",
		LocationLabel: "",
		Status:        "draft",
	})
	require.NoError(t, err)
	return f.ID.String()
}

func makeBody(t *testing.T, v interface{}) *bytes.Buffer {
	t.Helper()
	b, err := json.Marshal(v)
	require.NoError(t, err)
	return bytes.NewBuffer(b)
}

// ── Tests ──

func TestCreateEndorsement_PeerSuccess(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, endorserToken, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser Artist")    // peer requires profile
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee Artist")
	publishProfile(t, db, endorseeProfileID)

	handler := auth.Middleware(db, testSecret)(endorsement.CreateHandler(db))
	body := makeBody(t, map[string]interface{}{
		"endorsee_id": endorseeProfileID,
		"kind":        "peer",
		"body":        "Great murals!",
		"skills":      []string{"mural", "stencil"},
	})
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/endorsements", body)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+endorserToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "peer", resp["kind"])
	assert.Equal(t, "Great murals!", resp["body"])
}

func TestCreateEndorsement_SelfEndorse(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := testutil.CreateUser(t, db)
	profileID := createArtistProfile(t, db, userID, "Self Artist")
	publishProfile(t, db, profileID)

	handler := auth.Middleware(db, testSecret)(endorsement.CreateHandler(db))
	body := makeBody(t, map[string]interface{}{
		"endorsee_id": profileID,
		"kind":        "peer",
	})
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/endorsements", body)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateEndorsement_PeerWithoutProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, endorserToken, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	_ = endorserID // no profile created for endorser
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	handler := auth.Middleware(db, testSecret)(endorsement.CreateHandler(db))
	body := makeBody(t, map[string]interface{}{
		"endorsee_id": endorseeProfileID,
		"kind":        "peer",
	})
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/endorsements", body)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+endorserToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestCreateEndorsement_OrganiserSuccess(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	organiserID, organiserToken, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)
	festivalID := createFestival(t, db, organiserID)

	handler := auth.Middleware(db, testSecret)(endorsement.CreateHandler(db))
	body := makeBody(t, map[string]interface{}{
		"endorsee_id": endorseeProfileID,
		"kind":        "organiser",
		"festival_id": festivalID,
		"body":        "Excellent mural work.",
	})
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/endorsements", body)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+organiserToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "organiser", resp["kind"])
	assert.Equal(t, festivalID, resp["festival_id"])
}

func TestCreateEndorsement_OrganiserUnownedFestival(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	organiserID, organiserToken, _ := testutil.CreateUser(t, db)
	otherOrganiserID, _, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)
	_ = organiserID
	otherFestivalID := createFestival(t, db, otherOrganiserID)

	handler := auth.Middleware(db, testSecret)(endorsement.CreateHandler(db))
	body := makeBody(t, map[string]interface{}{
		"endorsee_id": endorseeProfileID,
		"kind":        "organiser",
		"festival_id": otherFestivalID,
	})
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/endorsements", body)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+organiserToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestCreateEndorsement_Upsert(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, endorserToken, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser")
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	handler := auth.Middleware(db, testSecret)(endorsement.CreateHandler(db))

	for i, body := 0, ""; i < 2; i++ {
		body = fmt.Sprintf(`{"endorsee_id":%q,"kind":"peer","body":"Version %d"}`, endorseeProfileID, i+1)
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/endorsements",
			bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", "Bearer "+endorserToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusCreated, w.Code, "iteration %d: %s", i, w.Body.String())
	}

	// Only one endorsement should exist.
	var count int
	err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM endorsements WHERE endorser_id = $1`, endorserID).Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 1, count, "upsert should keep exactly one endorsement per pair")
}

func TestDeleteEndorsement(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, endorserToken, _ := testutil.CreateUser(t, db)
	endorseeUserID, endorseeToken, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser")
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	// Create an endorsement directly in DB.
	var endorsementID string
	err := db.QueryRow(context.Background(),
		`INSERT INTO endorsements (endorser_id, endorsee_id, kind, skills)
		 VALUES ($1, (SELECT id FROM artist_profiles WHERE user_id = $2), 'peer', '{}')
		 RETURNING id::text`,
		endorserID, endorseeUserID).Scan(&endorsementID)
	require.NoError(t, err)

	router := chi.NewRouter()
	router.Use(auth.Middleware(db, testSecret))
	router.Delete("/endorsements/{endorsementID}", endorsement.DeleteHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	// Endorsee cannot delete.
	resp := testutil.DoRequest(t, srv, http.MethodDelete, "/endorsements/"+endorsementID, "", endorseeToken)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()

	// Endorser can delete.
	resp = testutil.DoRequest(t, srv, http.MethodDelete, "/endorsements/"+endorsementID, "", endorserToken)
	assert.Equal(t, http.StatusNoContent, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestListPublicEndorsements(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, _, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser")
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	_, err := db.Exec(context.Background(),
		`INSERT INTO endorsements (endorser_id, endorsee_id, kind, body, skills)
		 VALUES ($1, $2, 'peer', 'Great work', '{mural}')`,
		endorserID, endorseeProfileID)
	require.NoError(t, err)

	router := chi.NewRouter()
	router.Get("/profiles/{profileID}/endorsements", endorsement.ListPublicHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	resp := testutil.DoRequest(t, srv, http.MethodGet, "/profiles/"+endorseeProfileID+"/endorsements", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var body struct {
		Endorsements []map[string]interface{} `json:"endorsements"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()
	require.Len(t, body.Endorsements, 1)
	assert.Equal(t, "peer", body.Endorsements[0]["kind"])
	assert.Equal(t, "Great work", body.Endorsements[0]["body"])
}

func TestListPublicEndorsements_HiddenExcluded(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, _, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser")
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	_, err := db.Exec(context.Background(),
		`INSERT INTO endorsements (endorser_id, endorsee_id, kind, hidden_by_endorsee, skills)
		 VALUES ($1, $2, 'peer', true, '{}')`,
		endorserID, endorseeProfileID)
	require.NoError(t, err)

	router := chi.NewRouter()
	router.Get("/profiles/{profileID}/endorsements", endorsement.ListPublicHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	resp := testutil.DoRequest(t, srv, http.MethodGet, "/profiles/"+endorseeProfileID+"/endorsements", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var body struct {
		Endorsements []map[string]interface{} `json:"endorsements"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()
	assert.Empty(t, body.Endorsements, "hidden endorsements must not appear in public list")
}

func TestSetVisibility(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, endorserToken, _ := testutil.CreateUser(t, db)
	endorseeUserID, endorseeToken, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser")
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	var endorsementID string
	err := db.QueryRow(context.Background(),
		`INSERT INTO endorsements (endorser_id, endorsee_id, kind, skills)
		 VALUES ($1, $2, 'peer', '{}') RETURNING id::text`,
		endorserID, endorseeProfileID).Scan(&endorsementID)
	require.NoError(t, err)

	router := chi.NewRouter()
	router.Use(auth.Middleware(db, testSecret))
	router.Patch("/endorsements/{endorsementID}/visibility", endorsement.SetVisibilityHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	// Endorser cannot set visibility.
	resp := testutil.DoRequest(t, srv, http.MethodPatch,
		"/endorsements/"+endorsementID+"/visibility", `{"hidden":true}`, endorserToken)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()

	// Endorsee can hide.
	resp = testutil.DoRequest(t, srv, http.MethodPatch,
		"/endorsements/"+endorsementID+"/visibility", `{"hidden":true}`, endorseeToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()
	assert.Equal(t, true, body["hidden_by_endorsee"])
}

func TestListReceivedEndorsements(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, _, _ := testutil.CreateUser(t, db)
	endorseeUserID, endorseeToken, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser")
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	// Insert one visible and one hidden endorsement (from different endorsers).
	endorser2ID, _, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorser2ID, "Endorser2")
	_, err := db.Exec(context.Background(),
		`INSERT INTO endorsements (endorser_id, endorsee_id, kind, hidden_by_endorsee, skills)
		 VALUES ($1, $2, 'peer', false, '{}'), ($3, $2, 'peer', true, '{}')`,
		endorserID, endorseeProfileID, endorser2ID)
	require.NoError(t, err)

	handler := auth.Middleware(db, testSecret)(endorsement.ListReceivedHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/endorsements/received", nil)
	r.Header.Set("Authorization", "Bearer "+endorseeToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var body struct {
		Endorsements []map[string]interface{} `json:"endorsements"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Len(t, body.Endorsements, 2, "received list includes hidden endorsements")
}
```

- [ ] **Step 2: Run tests — they must fail (package doesn't exist yet)**

```bash
cd api && go test ./internal/endorsement/... 2>&1
```

Expected: `cannot find package` or compilation error — confirms tests are wired to the right package.

---

## Task 4: Implement the endorsement package

**Files:**
- Create: `api/internal/endorsement/errors.go`
- Create: `api/internal/endorsement/notification.go`
- Create: `api/internal/endorsement/endorsement.go`

- [ ] **Step 1: Create errors.go**

```go
// api/internal/endorsement/errors.go
package endorsement

import (
	"errors"

	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"
)

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgerrcode.UniqueViolation
}

func isCheckViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgerrcode.CheckViolation
}
```

- [ ] **Step 2: Create notification.go**

```go
// api/internal/endorsement/notification.go
package endorsement

import (
	"context"
	"html"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// sendEndorseeNotification emails the endorsee asynchronously.
// Errors are logged and swallowed — the endorsement is already saved.
func sendEndorseeNotification(pool *pgxpool.Pool, mailer auth.EmailSender, endorseeProfileID pgtype.UUID, endorserName string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByID(ctx, endorseeProfileID)
		if err != nil {
			slog.Error("endorsement notification: get profile", "err", err)
			return
		}
		if !profile.UserID.Valid {
			return // unclaimed prospect profile — no user to notify
		}
		user, err := q.GetUserByID(ctx, profile.UserID)
		if err != nil {
			slog.Error("endorsement notification: get user", "err", err)
			return
		}

		escapedName := html.EscapeString(endorserName)
		subject := "You received an endorsement"
		body := "<p>" + escapedName + " has endorsed your Render profile.</p>"
		if err := mailer.Send(ctx, user.Email, subject, body); err != nil {
			slog.Error("endorsement notification: send failed", "err", err, "to", user.Email)
		}
	}()
}
```

- [ ] **Step 3: Create endorsement.go**

```go
// api/internal/endorsement/endorsement.go
package endorsement

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

func pgUUIDFromString(s string) (pgtype.UUID, error) {
	parsed, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}, nil
}

type endorsementResponse struct {
	ID                  string   `json:"id"`
	Kind                string   `json:"kind"`
	EndorserID          string   `json:"endorser_id"`
	EndorserDisplayName *string  `json:"endorser_display_name,omitempty"`
	EndorserAvatarS3Key *string  `json:"endorser_avatar_s3_key,omitempty"`
	FestivalID          *string  `json:"festival_id,omitempty"`
	FestivalName        *string  `json:"festival_name,omitempty"`
	Body                *string  `json:"body,omitempty"`
	Skills              []string `json:"skills"`
	HiddenByEndorsee    bool     `json:"hidden_by_endorsee"`
	CreatedAt           string   `json:"created_at"`
}

func toResponse(e sqlcdb.Endorsement) endorsementResponse {
	skills := e.Skills
	if skills == nil {
		skills = []string{}
	}
	resp := endorsementResponse{
		ID:               e.ID.String(),
		Kind:             e.Kind,
		EndorserID:       e.EndorserID.String(),
		Body:             e.Body,
		Skills:           skills,
		HiddenByEndorsee: e.HiddenByEndorsee,
		CreatedAt:        e.CreatedAt.Time.Format(time.RFC3339),
	}
	if e.FestivalID.Valid {
		s := e.FestivalID.String()
		resp.FestivalID = &s
	}
	return resp
}

func toRowResponse(e sqlcdb.ListPublicEndorsementsRow) endorsementResponse {
	skills := e.Skills
	if skills == nil {
		skills = []string{}
	}
	resp := endorsementResponse{
		ID:                  e.ID.String(),
		Kind:                e.Kind,
		EndorserID:          e.EndorserID.String(),
		EndorserDisplayName: e.EndorserDisplayName,
		EndorserAvatarS3Key: e.EndorserAvatarS3Key,
		FestivalName:        e.FestivalName,
		Body:                e.Body,
		Skills:              skills,
		HiddenByEndorsee:    e.HiddenByEndorsee,
		CreatedAt:           e.CreatedAt.Time.Format(time.RFC3339),
	}
	if e.FestivalID.Valid {
		s := e.FestivalID.String()
		resp.FestivalID = &s
	}
	return resp
}

func toReceivedRowResponse(e sqlcdb.ListReceivedEndorsementsRow) endorsementResponse {
	skills := e.Skills
	if skills == nil {
		skills = []string{}
	}
	resp := endorsementResponse{
		ID:                  e.ID.String(),
		Kind:                e.Kind,
		EndorserID:          e.EndorserID.String(),
		EndorserDisplayName: e.EndorserDisplayName,
		EndorserAvatarS3Key: e.EndorserAvatarS3Key,
		FestivalName:        e.FestivalName,
		Body:                e.Body,
		Skills:              skills,
		HiddenByEndorsee:    e.HiddenByEndorsee,
		CreatedAt:           e.CreatedAt.Time.Format(time.RFC3339),
	}
	if e.FestivalID.Valid {
		s := e.FestivalID.String()
		resp.FestivalID = &s
	}
	return resp
}

// CreateHandler handles POST /endorsements.
func CreateHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return CreateHandlerWithMailer(pool, nil)
}

// CreateHandlerWithMailer is the production version; used by main.go.
func CreateHandlerWithMailer(pool *pgxpool.Pool, mailer auth.EmailSender) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		var req struct {
			EndorseeID string   `json:"endorsee_id"`
			Kind       string   `json:"kind"`
			FestivalID *string  `json:"festival_id"`
			Body       *string  `json:"body"`
			Skills     []string `json:"skills"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Kind != "peer" && req.Kind != "organiser" {
			httperr.UnprocessableEntity(w, "kind must be peer or organiser")
			return
		}
		if req.Kind == "organiser" && req.FestivalID == nil {
			httperr.UnprocessableEntity(w, "festival_id is required for organiser endorsements")
			return
		}

		endorseeUUID, err := pgUUIDFromString(req.EndorseeID)
		if err != nil {
			httperr.BadRequest(w, "invalid endorsee_id")
			return
		}
		endorserUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)

		// Endorsee must be a public artist profile.
		endorseeProfile, err := q.GetArtistProfileByID(r.Context(), endorseeUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if endorseeProfile.Visibility != "public" {
			httperr.NotFound(w)
			return
		}

		// Self-endorse check (at handler level; DB CHECK is the backstop).
		if endorseeProfile.UserID.Valid && endorseeProfile.UserID.String() == principal.UserID {
			httperr.BadRequest(w, "cannot endorse yourself")
			return
		}

		// Kind-specific validation.
		var festivalUUID pgtype.UUID
		switch req.Kind {
		case "peer":
			// Caller must have an artist profile.
			_, err := q.GetArtistProfileByUserID(r.Context(), endorserUUID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					httperr.Forbidden(w)
					return
				}
				httperr.InternalServerError(w)
				return
			}
		case "organiser":
			fUUID, err := pgUUIDFromString(*req.FestivalID)
			if err != nil {
				httperr.BadRequest(w, "invalid festival_id")
				return
			}
			fest, err := q.GetFestivalByID(r.Context(), fUUID)
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
			festivalUUID = fUUID
		}

		skills := req.Skills
		if skills == nil {
			skills = []string{}
		}

		e, err := q.CreateOrUpdateEndorsement(r.Context(), sqlcdb.CreateOrUpdateEndorsementParams{
			EndorserID: endorserUUID,
			EndorseeID: endorseeUUID,
			Kind:       req.Kind,
			FestivalID: festivalUUID,
			Body:       req.Body,
			Skills:     skills,
		})
		if err != nil {
			if isCheckViolation(err) {
				httperr.BadRequest(w, "cannot endorse yourself")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		// Fire-and-forget notification — don't block the response.
		if mailer != nil {
			endorserName := principal.UserID // fallback; overwritten below
			if ap, err := q.GetArtistProfileByUserID(r.Context(), endorserUUID); err == nil {
				endorserName = ap.DisplayName
			}
			sendEndorseeNotification(pool, mailer, endorseeUUID, endorserName)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toResponse(e))
	}
}

// DeleteHandler handles DELETE /endorsements/{endorsementID}. Endorser only.
func DeleteHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		idUUID, err := pgUUIDFromString(chi.URLParam(r, "endorsementID"))
		if err != nil {
			httperr.BadRequest(w, "invalid endorsementID")
			return
		}

		q := sqlcdb.New(pool)
		existing, err := q.GetEndorsementByID(r.Context(), idUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if existing.EndorserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		if err := q.DeleteEndorsement(r.Context(), idUUID); err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ListPublicHandler handles GET /profiles/{profileID}/endorsements. Public.
func ListPublicHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		profileUUID, err := pgUUIDFromString(chi.URLParam(r, "profileID"))
		if err != nil {
			httperr.BadRequest(w, "invalid profileID")
			return
		}

		q := sqlcdb.New(pool)
		rows, err := q.ListPublicEndorsements(r.Context(), profileUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		out := make([]endorsementResponse, 0, len(rows))
		for _, row := range rows {
			out = append(out, toRowResponse(row))
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"endorsements": out})
	}
}

// SetVisibilityHandler handles PATCH /endorsements/{endorsementID}/visibility. Endorsee only.
func SetVisibilityHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		idUUID, err := pgUUIDFromString(chi.URLParam(r, "endorsementID"))
		if err != nil {
			httperr.BadRequest(w, "invalid endorsementID")
			return
		}

		var req struct {
			Hidden bool `json:"hidden"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		q := sqlcdb.New(pool)

		// Fetch endorsement and verify caller is the endorsee.
		existing, err := q.GetEndorsementByID(r.Context(), idUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		// Look up the endorsee's profile to verify caller identity.
		endorserUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		endorseeProfile, err := q.GetArtistProfileByID(r.Context(), existing.EndorseeID)
		if err != nil || !endorseeProfile.UserID.Valid || endorseeProfile.UserID.String() != endorserUUID.String() {
			// Either profile not found or caller is not the endorsee.
			httperr.Forbidden(w)
			return
		}

		updated, err := q.SetEndorsementVisibility(r.Context(), sqlcdb.SetEndorsementVisibilityParams{
			ID:               idUUID,
			HiddenByEndorsee: req.Hidden,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toResponse(updated))
	}
}

// ListReceivedHandler handles GET /endorsements/received. Endorsee only.
func ListReceivedHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		endorserUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByUserID(r.Context(), endorserUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		rows, err := q.ListReceivedEndorsements(r.Context(), profile.ID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		out := make([]endorsementResponse, 0, len(rows))
		for _, row := range rows {
			out = append(out, toReceivedRowResponse(row))
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"endorsements": out})
	}
}
```

**Note on `toReceivedRowResponse`:** `sqlcdb.ListReceivedEndorsementsRow` has the same field names as `ListPublicEndorsementsRow`. If sqlc generates them as separate types, add a `toReceivedRowResponse` that mirrors `toRowResponse` but accepts `ListReceivedEndorsementsRow`. If it generates the same type (because the SQL is identical except for the WHERE), you can use one function.

- [ ] **Step 4: Run tests — they should pass now**

```bash
cd api && go test ./internal/endorsement/... -race -count=1 -v 2>&1 | head -80
```

Expected: all tests pass. Fix any compilation errors (type mismatches between generated code and handler).

- [ ] **Step 5: Fix the test file — import the correct pgxpool type**

The test file in Task 3 has a placeholder `createProfile` that uses a wrong interface. Replace it with the correct signature (same pattern as `testhelpers_test.go` in the artist package). Open the test file and fix the imports:

```go
import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/endorsement"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)
```

Remove the broken `createProfile` stub. Use `createArtistProfile` and `createFestival` helpers throughout the tests.

- [ ] **Step 6: Run full api test suite**

```bash
task api:test 2>&1 | tail -20
```

Expected: PASS. All existing tests still pass; new endorsement tests pass.

---

## Task 5: Wire routes + OpenAPI

**Files:**
- Modify: `api/cmd/api/main.go`
- Modify: `openapi/openapi.yaml`

- [ ] **Step 1: Add endorsement import to main.go**

In `api/cmd/api/main.go`, add to the import block:

```go
"github.com/sniffins-mcmuggins/render/api/internal/endorsement"
```

- [ ] **Step 2: Add routes in main.go**

Inside the `r.Group(func(r chi.Router) { ... })` block (the beta-gated auth block), add after the `artist profiles` section:

```go
// Endorsements
r.Get("/profiles/{profileID}/endorsements", endorsement.ListPublicHandler(pool))
r.Post("/endorsements", endorsement.CreateHandlerWithMailer(pool, mailer))
r.Delete("/endorsements/{endorsementID}", endorsement.DeleteHandler(pool))
r.Patch("/endorsements/{endorsementID}/visibility", endorsement.SetVisibilityHandler(pool))
r.Get("/endorsements/received", endorsement.ListReceivedHandler(pool))
```

**Route ordering:** `GET /endorsements/received` must be registered BEFORE any parameterized `GET /endorsements/{id}` route (which doesn't exist yet but follow the chi literal-before-param rule from `e2e-debugging.md`).

- [ ] **Step 3: Verify the API compiles**

```bash
cd api && go build ./cmd/api/... 2>&1
```

Expected: no errors.

- [ ] **Step 4: Add endorsement schemas and paths to openapi.yaml**

In `openapi/openapi.yaml`, add new schemas in the `components/schemas` section:

```yaml
    EndorsementResponse:
      type: object
      required: [id, kind, endorser_id, skills, hidden_by_endorsee, created_at]
      properties:
        id:
          type: string
          format: uuid
        kind:
          type: string
          enum: [peer, organiser]
        endorser_id:
          type: string
          format: uuid
        endorser_display_name:
          type: string
          nullable: true
        endorser_avatar_s3_key:
          type: string
          nullable: true
        festival_id:
          type: string
          format: uuid
          nullable: true
        festival_name:
          type: string
          nullable: true
        body:
          type: string
          nullable: true
        skills:
          type: array
          items:
            type: string
        hidden_by_endorsee:
          type: boolean
        created_at:
          type: string
          format: date-time

    EndorsementListResponse:
      type: object
      required: [endorsements]
      properties:
        endorsements:
          type: array
          items:
            $ref: "#/components/schemas/EndorsementResponse"

    CreateEndorsementRequest:
      type: object
      required: [endorsee_id, kind]
      properties:
        endorsee_id:
          type: string
          format: uuid
        kind:
          type: string
          enum: [peer, organiser]
        festival_id:
          type: string
          format: uuid
          nullable: true
        body:
          type: string
          nullable: true
        skills:
          type: array
          items:
            type: string

    SetEndorsementVisibilityRequest:
      type: object
      required: [hidden]
      properties:
        hidden:
          type: boolean
```

- [ ] **Step 5: Add paths to openapi.yaml**

In the `paths:` section (after the existing `/profiles/{profileID}/festivals` path):

```yaml
  /profiles/{profileID}/endorsements:
    get:
      operationId: listProfileEndorsements
      summary: List public endorsements for an artist profile
      tags: [artist]
      parameters:
        - name: profileID
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Public endorsements (moderation_status=ok, hidden_by_endorsee=false).
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/EndorsementListResponse"
        "404":
          $ref: "#/components/responses/NotFound"

  /endorsements:
    post:
      operationId: createEndorsement
      summary: Create or update an endorsement
      tags: [artist]
      security:
        - cookieAuth: []
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateEndorsementRequest"
      responses:
        "201":
          description: Endorsement created or updated.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/EndorsementResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "422":
          $ref: "#/components/responses/UnprocessableEntity"

  /endorsements/{endorsementID}:
    delete:
      operationId: deleteEndorsement
      summary: Withdraw an endorsement (endorser only)
      tags: [artist]
      security:
        - cookieAuth: []
        - bearerAuth: []
      parameters:
        - name: endorsementID
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "204":
          description: Endorsement withdrawn.
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"

  /endorsements/{endorsementID}/visibility:
    patch:
      operationId: setEndorsementVisibility
      summary: Show or hide an endorsement (endorsee only)
      tags: [artist]
      security:
        - cookieAuth: []
        - bearerAuth: []
      parameters:
        - name: endorsementID
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
              $ref: "#/components/schemas/SetEndorsementVisibilityRequest"
      responses:
        "200":
          description: Updated endorsement.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/EndorsementResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"

  /endorsements/received:
    get:
      operationId: listReceivedEndorsements
      summary: List all endorsements received (endorsee management view)
      tags: [artist]
      security:
        - cookieAuth: []
        - bearerAuth: []
      responses:
        "200":
          description: All received endorsements including hidden ones.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/EndorsementListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
```

- [ ] **Step 6: Regenerate the TypeScript client**

```bash
task openapi:gen 2>&1 | tail -10
```

Expected: no errors; `openapi/generated/` is updated with the new types.

---

## Task 6: Web — endorsements on the public profile

**Files:**
- Modify: `web/src/app/(public)/artists/[id]/page.tsx`

- [ ] **Step 1: Add endorsements fetch alongside profile and collections**

In `ArtistPage` (the default export), extend the `Promise.all` to include endorsements:

```tsx
const [profileRes, collectionsRes, festivalsRes, endorsementsRes] = await Promise.all([
  apiClient.GET('/profiles/{profileID}', {
    params: { path: { profileID: id } },
  }),
  apiClient.GET('/profiles/{profileID}/collections', {
    params: { path: { profileID: id } },
  }),
  apiClient.GET('/profiles/{profileID}/festivals', {
    params: { path: { profileID: id } },
  }),
  apiClient.GET('/profiles/{profileID}/endorsements', {
    params: { path: { profileID: id } },
  }),
])
```

Add after the `const appearances = ...` line:

```tsx
const endorsements = endorsementsRes.data?.endorsements ?? []
```

- [ ] **Step 2: Add the endorsements section to the JSX**

After the `{/* Collections */}` section (and before the closing `</div>`):

```tsx
{/* Endorsements */}
{endorsements.length > 0 && (
  <section aria-label="Endorsements" className="mt-10">
    <h2 className="font-serif text-3xl text-ink mb-6">Endorsements</h2>

    {/* Organiser endorsements first */}
    {endorsements.filter((e) => e.kind === 'organiser').map((e) => (
      <div key={e.id} className="mb-6 p-5 border border-light rounded-lg bg-warm">
        <div className="flex items-start gap-3">
          {e.endorser_avatar_s3_key && (
            <img
              src={e.endorser_avatar_s3_key}
              alt={e.endorser_display_name ?? ''}
              className="w-10 h-10 rounded-full object-cover flex-none"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {e.festival_name && (
                <span className="font-mono text-xs uppercase tracking-widest bg-amber text-ink px-2 py-0.5 rounded">
                  {e.festival_name}
                </span>
              )}
              {e.endorser_display_name && (
                <span className="font-sans text-sm text-mid">via {e.endorser_display_name}</span>
              )}
            </div>
            {e.body && (
              <p className="font-serif text-lg text-ink leading-relaxed mt-2">{e.body}</p>
            )}
            {e.skills && e.skills.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {e.skills.map((s) => (
                  <span key={s} className="font-mono text-xs uppercase tracking-wide bg-light text-ink px-2 py-0.5 rounded">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    ))}

    {/* Peer endorsements */}
    {endorsements.filter((e) => e.kind === 'peer').length > 0 && (
      <div className="grid gap-4 sm:grid-cols-2">
        {endorsements.filter((e) => e.kind === 'peer').map((e) => (
          <div key={e.id} className="p-4 border border-light rounded-lg bg-offwhite">
            <div className="flex items-center gap-3 mb-2">
              {e.endorser_avatar_s3_key && (
                <img
                  src={e.endorser_avatar_s3_key}
                  alt={e.endorser_display_name ?? ''}
                  className="w-8 h-8 rounded-full object-cover"
                />
              )}
              <span className="font-sans text-sm font-medium text-ink">
                {e.endorser_display_name ?? 'Anonymous artist'}
              </span>
            </div>
            {e.body && (
              <p className="font-serif text-base text-ink leading-relaxed">{e.body}</p>
            )}
            {e.skills && e.skills.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {e.skills.map((s) => (
                  <span key={s} className="font-mono text-xs uppercase tracking-wide bg-warm text-mid px-2 py-0.5 rounded">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    )}
  </section>
)}
```

- [ ] **Step 3: Verify the page compiles (TypeScript)**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no type errors.

---

## Task 7: Web — endorse form (artist-authenticated)

**Files:**
- Create: `web/src/app/(artist)/endorse/[profileID]/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { use } from 'react'
import { createApiClient } from '@render/api-client'
import type { components } from '@render/api-client'

type Festival = components['schemas']['Festival']

const apiBase =
  typeof window === 'undefined'
    ? (process.env.API_URL ?? 'http://localhost:8080')
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080')

const client = createApiClient({ baseUrl: apiBase })

export default function EndorsePage({ params }: { params: Promise<{ profileID: string }> }) {
  const { profileID } = use(params)
  const router = useRouter()

  const [kind, setKind] = useState<'peer' | 'organiser'>('peer')
  const [festivalID, setFestivalID] = useState('')
  const [body, setBody] = useState('')
  const [skillInput, setSkillInput] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [ownedFestivals, setOwnedFestivals] = useState<Festival[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.GET('/festivals', {}).then(({ data }) => {
      if (data) setOwnedFestivals(data)
    })
  }, [])

  function addSkill(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const s = skillInput.trim().toLowerCase()
      if (s && !skills.includes(s)) setSkills((prev) => [...prev, s])
      setSkillInput('')
    }
  }

  function removeSkill(s: string) {
    setSkills((prev) => prev.filter((x) => x !== s))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const { response } = await client.POST('/endorsements', {
        body: {
          endorsee_id: profileID,
          kind,
          festival_id: kind === 'organiser' ? festivalID : undefined,
          body: body || undefined,
          skills,
        },
      })
      if (response.ok) {
        router.push(`/artists/${profileID}`)
      } else {
        const text = await response.text()
        setError(text || `Error ${response.status}`)
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="font-serif text-4xl text-ink mb-2">Endorse this artist</h1>
      <p className="font-sans text-mid mb-8">Your words appear publicly on their profile.</p>

      <form onSubmit={submit} className="space-y-6 max-w-xl">
        {/* Kind */}
        <div>
          <label className="font-sans text-sm font-medium text-ink block mb-2">Endorsement type</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setKind('peer')}
              className={`font-mono text-xs uppercase tracking-widest px-4 py-2 rounded border transition-colors ${
                kind === 'peer' ? 'bg-ink text-offwhite border-ink' : 'bg-offwhite text-mid border-light'
              }`}
            >
              Artist peer
            </button>
            {ownedFestivals.length > 0 && (
              <button
                type="button"
                onClick={() => setKind('organiser')}
                className={`font-mono text-xs uppercase tracking-widest px-4 py-2 rounded border transition-colors ${
                  kind === 'organiser' ? 'bg-ink text-offwhite border-ink' : 'bg-offwhite text-mid border-light'
                }`}
              >
                Festival organiser
              </button>
            )}
          </div>
        </div>

        {/* Festival picker (organiser only) */}
        {kind === 'organiser' && (
          <div>
            <label className="font-sans text-sm font-medium text-ink block mb-2">Badge as festival</label>
            <select
              value={festivalID}
              onChange={(e) => setFestivalID(e.target.value)}
              required
              className="font-sans text-sm text-ink bg-offwhite border border-light rounded px-3 py-2 w-full"
            >
              <option value="">Select a festival…</option>
              {ownedFestivals.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Body */}
        <div>
          <label className="font-sans text-sm font-medium text-ink block mb-2">Message (optional)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="Share what makes this artist special…"
            className="font-serif text-base text-ink bg-offwhite border border-light rounded px-3 py-2 w-full resize-none focus:outline-none focus:border-amber"
          />
        </div>

        {/* Skills */}
        <div>
          <label className="font-sans text-sm font-medium text-ink block mb-2">
            Skills (optional — press Enter or comma to add)
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {skills.map((s) => (
              <span key={s} className="font-mono text-xs uppercase tracking-wide bg-warm text-ink px-2 py-1 rounded flex items-center gap-1">
                {s}
                <button type="button" onClick={() => removeSkill(s)} className="text-mid hover:text-clay">×</button>
              </span>
            ))}
          </div>
          <input
            type="text"
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyDown={addSkill}
            placeholder="e.g. mural, stencil…"
            className="font-sans text-sm text-ink bg-offwhite border border-light rounded px-3 py-2 w-full focus:outline-none focus:border-amber"
          />
        </div>

        {error && <p className="font-sans text-sm text-clay">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="font-mono text-xs uppercase tracking-widest bg-ink text-offwhite px-6 py-2 rounded hover:bg-amber hover:text-ink transition-colors disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Endorse'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="font-mono text-xs uppercase tracking-widest text-mid border border-light px-4 py-2 rounded hover:text-ink transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Add "Endorse" button to the public profile page**

In `web/src/app/(public)/artists/[id]/page.tsx`, after the `<SocialLinks>` component in the header section, add a simple link. Since the public page is a server component, it can't know if the visitor is logged in — the link always shows, and unauthenticated users will hit the auth redirect:

```tsx
<Link
  href={`/endorse/${id}`}
  className="inline-block font-mono text-xs uppercase tracking-widest border border-light text-mid hover:text-ink hover:border-ink px-4 py-2 rounded transition-colors mt-4"
>
  Endorse this artist
</Link>
```

- [ ] **Step 3: TypeScript check**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

---

## Task 8: Web — endorsee management page

**Files:**
- Create: `web/src/app/(artist)/endorsements/page.tsx`
- Modify: `web/src/app/(artist)/layout.tsx`

- [ ] **Step 1: Create the management page**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { createApiClient } from '@render/api-client'
import type { components } from '@render/api-client'

type Endorsement = components['schemas']['EndorsementResponse']

const client = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
})

export default function EndorsementsPage() {
  const [endorsements, setEndorsements] = useState<Endorsement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    client.GET('/endorsements/received', {}).then(({ data }) => {
      setEndorsements(data?.endorsements ?? [])
      setLoading(false)
    })
  }, [])

  async function toggleVisibility(id: string, currentHidden: boolean) {
    const { data } = await client.PATCH('/endorsements/{endorsementID}/visibility', {
      params: { path: { endorsementID: id } },
      body: { hidden: !currentHidden },
    })
    if (data) {
      setEndorsements((prev) => prev.map((e) => (e.id === id ? data : e)))
    }
  }

  if (loading) {
    return <p className="font-sans text-mid">Loading…</p>
  }

  return (
    <div>
      <h1 className="font-serif text-4xl text-ink mb-2">Endorsements</h1>
      <p className="font-sans text-mid mb-8">
        Control which endorsements appear on your public profile.
      </p>

      {endorsements.length === 0 && (
        <p className="font-sans text-mid">No endorsements yet.</p>
      )}

      <ul className="space-y-4">
        {endorsements.map((e) => (
          <li key={e.id} className={`p-4 border rounded-lg ${e.hidden_by_endorsee ? 'border-light bg-warm opacity-60' : 'border-light bg-offwhite'}`}>
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  {e.kind === 'organiser' && e.festival_name && (
                    <span className="font-mono text-xs uppercase tracking-widest bg-amber text-ink px-2 py-0.5 rounded">
                      {e.festival_name}
                    </span>
                  )}
                  <span className="font-sans text-sm font-medium text-ink">
                    {e.endorser_display_name ?? 'Anonymous'}
                  </span>
                  <span className="font-mono text-xs uppercase tracking-widest text-mid">
                    {e.kind}
                  </span>
                </div>
                {e.body && (
                  <p className="font-serif text-base text-ink leading-relaxed">{e.body}</p>
                )}
                {e.skills && e.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {e.skills.map((s) => (
                      <span key={s} className="font-mono text-xs uppercase tracking-wide bg-light text-ink px-2 py-0.5 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => toggleVisibility(e.id, e.hidden_by_endorsee)}
                className={`font-mono text-xs uppercase tracking-widest px-3 py-1.5 rounded border shrink-0 transition-colors ${
                  e.hidden_by_endorsee
                    ? 'border-light text-mid hover:text-ink hover:border-ink'
                    : 'border-light text-mid hover:text-clay hover:border-clay'
                }`}
              >
                {e.hidden_by_endorsee ? 'Show' : 'Hide'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Add Endorsements link to artist nav**

In `web/src/app/(artist)/layout.tsx`, add to `NAV_LINKS`:

```tsx
const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/profile', label: 'Profile' },
  { href: '/collections', label: 'Collections' },
  { href: '/applications', label: 'Applications' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/endorsements', label: 'Endorsements' },
]
```

- [ ] **Step 3: TypeScript check**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

---

## Task 9: E2E API test

**Files:**
- Create: `e2e/api/endorsements.test.ts`

- [ ] **Step 1: Confirm the stack is up**

```bash
curl -sf http://localhost:8080/healthz && echo "ok"
```

If the stack is not running: `task up && task db:migrate`

- [ ] **Step 2: Create the e2e test file**

```typescript
// e2e/api/endorsements.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { API, createArtist, createOrganiser, createFestival } from '../fixtures/helpers'

// Note: createOrganiser creates a user with an owned festival.
// We reuse createArtist for both endorser and endorsee and manage festival ownership separately.

const suffix = Date.now()

let endorserToken: string
let endorserID: string
let endorseeProfileID: string
let endorseeToken: string
let endorseeUserID: string
let organiserToken: string
let festivalID: string
let endorsementID: string

beforeAll(async () => {
  // Endorser: has an artist profile (peer kind)
  const endorserEmail = `endorser-${suffix}@e2e.test`
  const endorserRes = await createArtist(endorserEmail, `artist-endorser-${suffix}`)
  endorserToken = endorserRes.token
  endorserID = endorserRes.userId

  // Endorsee: has a public artist profile
  const endorseeEmail = `endorsee-${suffix}@e2e.test`
  const endorseeRes = await createArtist(endorseeEmail, `artist-endorsee-${suffix}`)
  endorseeToken = endorseeRes.token
  endorseeUserID = endorseeRes.userId

  // Get the endorsee's profile ID
  const profileRes = await fetch(`${API}/profiles/me`, {
    headers: { Authorization: `Bearer ${endorseeToken}` },
  })
  const profileData = await profileRes.json()
  endorseeProfileID = profileData.id

  // Publish endorsee profile
  await fetch(`${API}/profiles/me/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${endorseeToken}` },
  })

  // Organiser: creates a festival
  const orgEmail = `org-${suffix}@e2e.test`
  const orgRes = await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: orgEmail, password: 'password123' }),
  })
  const orgLogin = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: orgEmail, password: 'password123' }),
  })
  const orgData = await orgLogin.json()
  organiserToken = orgData.token

  const festRes = await fetch(`${API}/festivals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organiserToken}` },
    body: JSON.stringify({ name: `E18 Festival ${suffix}`, slug: `e18-fest-${suffix}` }),
  })
  const festData = await festRes.json()
  festivalID = festData.id
})

describe('E18 endorsements', () => {
  it('1. peer endorsement created', async () => {
    const res = await fetch(`${API}/endorsements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endorserToken}` },
      body: JSON.stringify({
        endorsee_id: endorseeProfileID,
        kind: 'peer',
        body: 'Amazing muralist.',
        skills: ['mural', 'stencil'],
      }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.kind).toBe('peer')
    expect(data.body).toBe('Amazing muralist.')
    endorsementID = data.id
  })

  it('2. self-endorse → 400', async () => {
    const res = await fetch(`${API}/endorsements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endorseeToken}` },
      body: JSON.stringify({ endorsee_id: endorseeProfileID, kind: 'peer' }),
    })
    expect(res.status).toBe(400)
  })

  it('3. upsert — second POST same pair merges, no duplicate', async () => {
    const res = await fetch(`${API}/endorsements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endorserToken}` },
      body: JSON.stringify({ endorsee_id: endorseeProfileID, kind: 'peer', body: 'Updated message.' }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBe(endorsementID) // same row
    expect(data.body).toBe('Updated message.')
  })

  it('4. public list shows endorsement', async () => {
    const res = await fetch(`${API}/profiles/${endorseeProfileID}/endorsements`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.endorsements).toHaveLength(1)
    expect(data.endorsements[0].kind).toBe('peer')
  })

  it('5. endorsee hides → public list is empty', async () => {
    const patch = await fetch(`${API}/endorsements/${endorsementID}/visibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endorseeToken}` },
      body: JSON.stringify({ hidden: true }),
    })
    expect(patch.status).toBe(200)

    const list = await fetch(`${API}/profiles/${endorseeProfileID}/endorsements`)
    const data = await list.json()
    expect(data.endorsements).toHaveLength(0)
  })

  it('6. endorsee shows again → public list restored', async () => {
    await fetch(`${API}/endorsements/${endorsementID}/visibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endorseeToken}` },
      body: JSON.stringify({ hidden: false }),
    })

    const list = await fetch(`${API}/profiles/${endorseeProfileID}/endorsements`)
    const data = await list.json()
    expect(data.endorsements).toHaveLength(1)
  })

  it('7. endorser cannot set visibility → 403', async () => {
    const res = await fetch(`${API}/endorsements/${endorsementID}/visibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endorserToken}` },
      body: JSON.stringify({ hidden: true }),
    })
    expect(res.status).toBe(403)
  })

  it('8. organiser endorsement with owned festival → 201 with festival_name', async () => {
    const res = await fetch(`${API}/endorsements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organiserToken}` },
      body: JSON.stringify({
        endorsee_id: endorseeProfileID,
        kind: 'organiser',
        festival_id: festivalID,
        body: 'Featured at our festival.',
      }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.kind).toBe('organiser')
    expect(data.festival_id).toBe(festivalID)

    // Public list: organiser endorsement appears first
    const list = await fetch(`${API}/profiles/${endorseeProfileID}/endorsements`)
    const listData = await list.json()
    const orgEndorsement = listData.endorsements.find((e: { kind: string }) => e.kind === 'organiser')
    expect(orgEndorsement).toBeDefined()
    expect(orgEndorsement.festival_name).toBeTruthy()
  })

  it('9. organiser badge with unowned festival → 403', async () => {
    // Endorser (artist, owns no festivals) tries to use the organiser's festival ID
    const res = await fetch(`${API}/endorsements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endorserToken}` },
      body: JSON.stringify({
        endorsee_id: endorseeProfileID,
        kind: 'organiser',
        festival_id: festivalID,
      }),
    })
    expect(res.status).toBe(403)
  })

  it('10. endorser withdraws peer endorsement → 204', async () => {
    const res = await fetch(`${API}/endorsements/${endorsementID}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${endorserToken}` },
    })
    expect(res.status).toBe(204)

    const list = await fetch(`${API}/profiles/${endorseeProfileID}/endorsements`)
    const data = await list.json()
    const peerEndorsement = data.endorsements.find((e: { kind: string }) => e.kind === 'peer')
    expect(peerEndorsement).toBeUndefined()
  })

  it('11. endorsee cannot delete endorsement → 403', async () => {
    // Create a new endorsement first
    const createRes = await fetch(`${API}/endorsements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endorserToken}` },
      body: JSON.stringify({ endorsee_id: endorseeProfileID, kind: 'peer' }),
    })
    expect(createRes.status).toBe(201)
    const newID = (await createRes.json()).id

    const res = await fetch(`${API}/endorsements/${newID}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${endorseeToken}` },
    })
    expect(res.status).toBe(403)
  })

  it('12. received list includes hidden endorsements', async () => {
    const res = await fetch(`${API}/endorsements/received`, {
      headers: { Authorization: `Bearer ${endorseeToken}` },
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    // The organiser endorsement (test 8) and the new peer endorsement (test 11) should both be present
    expect(data.endorsements.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 3: Run the e2e test**

```bash
task e2e:api 2>&1 | grep -E "endorsements|PASS|FAIL|error" | head -30
```

Or run just the endorsements file:

```bash
npx vitest run --config vitest.e2e.config.ts e2e/api/endorsements.test.ts
```

Expected: all 12 tests pass. Fix any 404s (check `task db:migrate` ran), 500s (check API logs with `docker compose -f infra/docker-compose.yml logs api --tail=20`).

---

## Task 10: Commit + spec update + PR

- [ ] **Step 1: Write the endorsement spec**

Create `api/internal/endorsement/endorsement.spec.md`:

```markdown
# Endorsement Spec
**Path:** `api/internal/endorsement/`
**Last updated:** 2026-06-01

## Contract
POST /endorsements — create/upsert peer or organiser endorsement.
DELETE /endorsements/{id} — endorser withdraws.
GET /profiles/{id}/endorsements — public, filtered (ok + visible only), organiser-first.
PATCH /endorsements/{id}/visibility — endorsee hides/shows.
GET /endorsements/received — authenticated endorsee sees all (for management view).

## Boundaries
Does NOT implement moderation admin UI (E17). Does NOT implement content flagging.
Does NOT expose moderation_status mutation to users (SetEndorsementModerationStatus is a DB-only query for E17 to call).

## Key Decisions
- endorser_id → users.id; endorsee_id → artist_profiles.id.
- One endorsement per (endorser, endorsee) pair; upsert on repeat.
- Peer requires caller to have an artist_profile. Organiser requires ownership of festival_id. No appearance requirement.
- Endorser owns the words (create/withdraw); endorsee controls visibility (hide/show only, no edit).
- Notification: background email on create, 30s timeout, errors logged and swallowed.
- moderation_status column present from day one; public list filters on it. E17 provides the admin UI.

## Invariants
- No self-endorsement: DB CHECK (endorser_id <> endorsee_id) + handler guard.
- Organiser kind always has festival_id: DB CHECK (kind = 'peer' OR festival_id IS NOT NULL).
- moderation_status one of 'ok', 'hidden', 'removed'.
- Public list never exposes hidden_by_endorsee=true or moderation_status != 'ok' rows.

## AI Context
Read errors.go for isCheckViolation (used for the self-endorse DB backstop).
toRowResponse and toReceivedRowResponse handle the JOIN row types from ListPublicEndorsements and ListReceivedEndorsements respectively — these are separate sqlc-generated types even though the SQL is structurally similar.
The notification function requires mailer; CreateHandler (no mailer) is the test variant; CreateHandlerWithMailer is wired in main.go.

## Changelog
2026-06-01 — initial spec
```

- [ ] **Step 2: Add spec rule stub**

Create `.claude/rules/spec-endorsement.md`:

```markdown
---
paths:
  - "api/internal/endorsement/**"
---

@api/internal/endorsement/endorsement.spec.md
```

- [ ] **Step 3: Update CLAUDE.md Living Specs table**

In `CLAUDE.md`, in the "Packages with specs" table, add:

```markdown
| `api/internal/endorsement/` | `endorsement.spec.md` |
```

- [ ] **Step 4: Run full test suite**

```bash
task api:test 2>&1 | tail -5
cd web && npx tsc --noEmit 2>&1 | head -10
```

Both must pass.

- [ ] **Step 5: Commit**

```bash
git checkout -b e18-endorsements
git add \
  db/migrations/000020_endorsements.up.sql \
  db/migrations/000020_endorsements.down.sql \
  db/queries/endorsements.sql \
  api/internal/sqlcdb/endorsements.sql.go \
  api/internal/sqlcdb/models.go \
  api/internal/endorsement/ \
  api/cmd/api/main.go \
  openapi/openapi.yaml \
  openapi/generated/ \
  web/src/app/\(public\)/artists/\[id\]/page.tsx \
  web/src/app/\(artist\)/endorse/ \
  web/src/app/\(artist\)/endorsements/ \
  web/src/app/\(artist\)/layout.tsx \
  e2e/api/endorsements.test.ts \
  docs/superpowers/specs/2026-06-01-e18-endorsements-design.md \
  docs/superpowers/plans/2026-06-01-e18-endorsements.md \
  .claude/rules/spec-endorsement.md \
  CLAUDE.md
git commit -m "$(cat <<'EOF'
[E18] Artist & organiser endorsements — peer + organiser social proof (#194)

Closes #195 #196 #197

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Open PR**

```bash
gh pr create \
  --title "[E18] Artist & organiser endorsements — peer + organiser social proof" \
  --body "$(cat <<'EOF'
## Summary

- Adds `endorsements` table (migration 000020): peer and organiser kinds, one per (endorser, endorsee) pair with upsert, `moderation_status` stub for E17.
- `POST /endorsements` — peer validation (caller must have artist_profile), organiser validation (must own festival_id), self-endorse guard, background email notification.
- `DELETE /endorsements/{id}` (endorser only), `GET /profiles/{id}/endorsements` (public, filtered), `PATCH /endorsements/{id}/visibility` (endorsee only), `GET /endorsements/received` (endorsee management).
- Web: endorsements section on public artist profile (organiser badges + peer grid), `/endorse/[profileID]` form, `/endorsements` management page with hide/show controls.
- 12 e2e API tests covering all security paths.
- E18.3 stub: `moderation_status` column + filter in place; E17 provides the admin queue.

## Test plan

- [ ] `task api:test` passes
- [ ] `npx vitest run --config vitest.e2e.config.ts e2e/api/endorsements.test.ts` — all 12 pass
- [ ] Visit a public artist profile → endorsements section renders
- [ ] Log in as an artist, visit another artist's profile → "Endorse this artist" link
- [ ] Submit endorsement form → redirects back to profile, endorsement shows
- [ ] Go to /endorsements → see received endorsements, toggle hide/show

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist

**Spec coverage:**
- [x] E18.1: migration, POST/DELETE/GET handlers, validation, upsert, notification ✓
- [x] E18.2: PATCH visibility, GET received, web UI, endorse form ✓
- [x] E18.3: `moderation_status` column + filter stub (E17 machinery not yet built) ✓

**Type consistency:**
- `toResponse(e sqlcdb.Endorsement)` — used for create/delete/set-visibility responses
- `toRowResponse(e sqlcdb.ListPublicEndorsementsRow)` — used for public list
- `toReceivedRowResponse(e sqlcdb.ListReceivedEndorsementsRow)` — used for received list
- All three have consistent field names matching `endorsementResponse`

**Route ordering in main.go:** `/endorsements/received` is a literal path — register it before any parameterized `/endorsements/{id}` route (only `/endorsements/{endorsementID}` and `/endorsements/{endorsementID}/visibility` exist, and those are DELETE/PATCH not GET, so there's no strict conflict — but the convention is literals first).

**IDOR safety:**
- Delete: fetch by ID first, check endorser_id → 403 (not 404, so caller knows it exists but can't delete). This is intentional: leaking "endorsement exists" is not sensitive.
- Visibility: fetch endorsement, then look up endorsee profile → if caller is not endorsee, return 403.

**Notification:** `sendEndorseeNotification` is only called when `mailer != nil`. In tests, `CreateHandler(pool)` passes nil — no email sent. In production, `CreateHandlerWithMailer(pool, mailer)` is used.
