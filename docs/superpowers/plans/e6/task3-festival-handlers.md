# Task 3: Festival CRUD Handlers

**Files:**
- Create: `api/internal/festival/errors.go`
- Create: `api/internal/festival/testhelpers_test.go`
- Create: `api/internal/festival/festival.go`
- Create: `api/internal/festival/festival_test.go`

**Context:** Follow patterns from `api/internal/artist/profile.go` and `api/internal/artist/errors.go`. Package is `festival` (handlers) and `festival_test` (tests). Auth via `auth.User(r.Context())`. RFC 7807 errors via `httperr` package. Route param: `{festivalID}`. Organiser ownership: compare festival.OrganiserID to pgUUIDFromString(principal.UserID). Non-live festivals return 404 for public GET.

---

- [ ] **Step 1: Write failing tests for festival CRUD**

Create `api/internal/festival/festival_test.go`:

```go
package festival_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestCreateFestival(t *testing.T) {
	db := testutil.NewDB(t)
	_, orgToken := createTestUser(t, db, "org@example.com", "organiser")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals", festival.CreateHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals",
		`{"name":"Summer Walls","slug":"summer-walls-2027","description":"Annual mural festival","locationLabel":"Bristol","startDate":"2027-06-01","endDate":"2027-06-07"}`,
		orgToken)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, body)
	}
	resp.Body.Close()
}

func TestCreateFestival_RequiresOrganiser(t *testing.T) {
	db := testutil.NewDB(t)
	_, artistToken := createTestUser(t, db, "artist@example.com", "artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals", festival.CreateHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals",
		`{"name":"X","slug":"x","description":"","locationLabel":""}`,
		artistToken)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestGetFestival_PublicDraftReturns404(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "org2@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "draft-fest", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/{festivalID}", festival.GetHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Public request (no token) - draft → 404
	resp := doRequest(t, srv, "GET", "/festivals/"+festID, "", "")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for draft festival (public), got %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Organiser request with token - draft → 200
	resp = doRequest(t, srv, "GET", "/festivals/"+festID, "", orgToken)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200 for draft festival (owner), got %d: %s", resp.StatusCode, body)
	}
	resp.Body.Close()
}

func TestUpdateFestival_OnlyOrganiserCanUpdate(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "org3@example.com", "organiser")
	_, otherToken := createTestUser(t, db, "other@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "my-fest", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Patch("/festivals/{festivalID}", festival.UpdateHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Other organiser → 403
	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID,
		`{"name":"Changed","slug":"changed","description":"","locationLabel":""}`, otherToken)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Correct organiser → 200
	resp = doRequest(t, srv, "PATCH", "/festivals/"+festID,
		`{"name":"Updated Name","slug":"my-fest","description":"Updated desc","locationLabel":"Bristol"}`, orgToken)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, body)
	}
	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	if body["name"] != "Updated Name" {
		t.Errorf("expected updated name, got %v", body["name"])
	}
}

func TestDeleteFestival_SoftDelete(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "org4@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "to-delete", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Delete("/festivals/{festivalID}", festival.DeleteHandler(db))
	r.Get("/festivals/{festivalID}", festival.GetHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "DELETE", "/festivals/"+festID, "", orgToken)
	if resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 204, got %d: %s", resp.StatusCode, body)
	}
	resp.Body.Close()

	// Verify gone
	resp = doRequest(t, srv, "GET", "/festivals/"+festID, "", orgToken)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestListFestivals(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "org5@example.com", "organiser")
	createTestFestival(t, db, orgID, "fest-a", "draft")
	createTestFestival(t, db, orgID, "fest-b", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals", festival.ListHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals", "", orgToken)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var list []map[string]any
	json.NewDecoder(resp.Body).Decode(&list)
	resp.Body.Close()
	if len(list) != 2 {
		t.Errorf("expected 2 festivals, got %d", len(list))
	}
}

// doRequest is a helper used across test files in this package.
func doRequest(t *testing.T, srv *httptest.Server, method, path, body, token string) *http.Response {
	t.Helper()
	var reqBody io.Reader
	if body != "" {
		reqBody = strings.NewReader(body)
	}
	req, _ := http.NewRequestWithContext(t.Context(), method, srv.URL+path, reqBody)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}
```

- [ ] **Step 2: Run tests to verify they fail (compilation error — no festival package yet)**

```bash
cd api && go test ./internal/festival/... 2>&1 | head -20
```

Expected: compile error referencing missing festival package.

- [ ] **Step 3: Create api/internal/festival/errors.go**

```go
package festival

import (
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgerrcode.UniqueViolation
}

func pgUUIDFromString(s string) (pgtype.UUID, error) {
	parsed, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}, nil
}
```

- [ ] **Step 4: Create api/internal/festival/testhelpers_test.go**

```go
package festival_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

const testSecret = "test-secret-key"

func pgUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	parsed, err := uuid.Parse(s)
	if err != nil {
		t.Fatalf("parse uuid %q: %v", s, err)
	}
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}
}

func createTestUser(t *testing.T, pool *pgxpool.Pool, email, role string) (userID string, token string) {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("hunter2hunter"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	q := sqlcdb.New(pool)
	user, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email:        email,
		PasswordHash: string(hash),
		Role:         sqlcdb.UserRole(role),
	})
	if err != nil {
		t.Fatalf("create user %s: %v", email, err)
	}
	userID = user.ID.String()
	token, err = auth.IssueToken(userID, role, testSecret)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return userID, token
}

func createTestArtistProfile(t *testing.T, pool *pgxpool.Pool, userID, displayName string) string {
	t.Helper()
	q := sqlcdb.New(pool)
	profile, err := q.CreateArtistProfile(context.Background(), sqlcdb.CreateArtistProfileParams{
		UserID:      pgUUID(t, userID),
		DisplayName: displayName,
	})
	if err != nil {
		t.Fatalf("create artist profile for %s: %v", userID, err)
	}
	return profile.ID.String()
}

func createTestFestival(t *testing.T, pool *pgxpool.Pool, organiserID, slug, status string) string {
	t.Helper()
	q := sqlcdb.New(pool)
	fest, err := q.CreateFestival(context.Background(), sqlcdb.CreateFestivalParams{
		OrganiserID:   pgUUID(t, organiserID),
		Name:          slug,
		Slug:          slug,
		Description:   "",
		LocationLabel: "",
		Status:        sqlcdb.FestivalStatus(status),
	})
	if err != nil {
		t.Fatalf("create festival %s: %v", slug, err)
	}
	return fest.ID.String()
}

func createTestApplicationForm(t *testing.T, pool *pgxpool.Pool, festivalID string) string {
	t.Helper()
	q := sqlcdb.New(pool)
	form, err := q.UpsertApplicationForm(context.Background(), sqlcdb.UpsertApplicationFormParams{
		FestivalID: pgUUID(t, festivalID),
		Fields:     []byte(`[]`),
	})
	if err != nil {
		t.Fatalf("create application form for festival %s: %v", festivalID, err)
	}
	return form.ID.String()
}
```

- [ ] **Step 5: Create api/internal/festival/festival.go**

```go
package festival

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type festivalResponse struct {
	ID            string  `json:"id"`
	OrganiserID   string  `json:"organiser_id"`
	Name          string  `json:"name"`
	Slug          string  `json:"slug"`
	Description   string  `json:"description"`
	LocationLabel string  `json:"location_label"`
	StartDate     *string `json:"start_date,omitempty"`
	EndDate       *string `json:"end_date,omitempty"`
	Status        string  `json:"status"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

func toFestivalResponse(f sqlcdb.Festival) festivalResponse {
	resp := festivalResponse{
		ID:            f.ID.String(),
		OrganiserID:   f.OrganiserID.String(),
		Name:          f.Name,
		Slug:          f.Slug,
		Description:   f.Description,
		LocationLabel: f.LocationLabel,
		Status:        string(f.Status),
		CreatedAt:     f.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:     f.UpdatedAt.Time.Format(time.RFC3339),
	}
	if f.StartDate.Valid {
		s := f.StartDate.Time.Format("2006-01-02")
		resp.StartDate = &s
	}
	if f.EndDate.Valid {
		s := f.EndDate.Time.Format("2006-01-02")
		resp.EndDate = &s
	}
	return resp
}

// CreateHandler handles POST /festivals. Requires organiser role.
func CreateHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		if principal.Role != "organiser" {
			httperr.Forbidden(w)
			return
		}

		var req struct {
			Name          string `json:"name"`
			Slug          string `json:"slug"`
			Description   string `json:"description"`
			LocationLabel string `json:"locationLabel"`
			StartDate     string `json:"startDate"`
			EndDate       string `json:"endDate"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Name == "" || req.Slug == "" {
			httperr.UnprocessableEntity(w, "name and slug are required")
			return
		}

		organiserUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		params := sqlcdb.CreateFestivalParams{
			OrganiserID:   organiserUUID,
			Name:          req.Name,
			Slug:          req.Slug,
			Description:   req.Description,
			LocationLabel: req.LocationLabel,
			Status:        sqlcdb.FestivalStatusDraft,
		}
		fest, err := q.CreateFestival(r.Context(), params)
		if err != nil {
			if isUniqueViolation(err) {
				httperr.Write(w, http.StatusConflict, "Conflict", "slug already in use")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toFestivalResponse(fest))
	}
}

// GetHandler handles GET /festivals/{festivalID}. Public for live festivals; organiser can see own draft.
func GetHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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

		if fest.Status != sqlcdb.FestivalStatusLive {
			principal, authErr := auth.User(r.Context())
			if authErr != nil || fest.OrganiserID.String() != principal.UserID {
				httperr.NotFound(w)
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toFestivalResponse(fest))
	}
}

// ListHandler handles GET /festivals. Requires auth; returns festivals owned by the caller.
func ListHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		organiserUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		festivals, err := q.ListFestivalsByOrganiser(r.Context(), organiserUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		resp := make([]festivalResponse, len(festivals))
		for i, f := range festivals {
			resp[i] = toFestivalResponse(f)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// UpdateHandler handles PATCH /festivals/{festivalID}. Requires auth + ownership.
func UpdateHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		existing, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if existing.OrganiserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		var req struct {
			Name          string `json:"name"`
			Slug          string `json:"slug"`
			Description   string `json:"description"`
			LocationLabel string `json:"locationLabel"`
			Status        string `json:"status"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		name := existing.Name
		if req.Name != "" {
			name = req.Name
		}
		slug := existing.Slug
		if req.Slug != "" {
			slug = req.Slug
		}
		description := existing.Description
		if req.Description != "" {
			description = req.Description
		}
		locationLabel := existing.LocationLabel
		if req.LocationLabel != "" {
			locationLabel = req.LocationLabel
		}
		status := existing.Status
		if req.Status != "" {
			status = sqlcdb.FestivalStatus(req.Status)
		}

		updated, err := q.UpdateFestival(r.Context(), sqlcdb.UpdateFestivalParams{
			ID:            festUUID,
			Name:          name,
			Slug:          slug,
			Description:   description,
			LocationLabel: locationLabel,
			Status:        status,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httperr.Write(w, http.StatusConflict, "Conflict", "slug already in use")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toFestivalResponse(updated))
	}
}

// DeleteHandler handles DELETE /festivals/{festivalID}. Requires auth + ownership. Soft-deletes.
func DeleteHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		existing, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if existing.OrganiserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		if err := q.SoftDeleteFestival(r.Context(), festUUID); err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
```

- [ ] **Step 6: Run tests**

```bash
cd api && go test ./internal/festival/... -run TestCreate -v
cd api && go test ./internal/festival/... -v
```

Expected: all 7 tests pass.

- [ ] **Step 7: Commit**

```bash
git add api/internal/festival/
git commit -m "feat(festival): add festival CRUD handlers with organiser ownership"
```
