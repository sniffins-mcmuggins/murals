# Task 5: Submit Application Handler

**Files:**
- Create: `api/internal/festival/application.go`
- Create: `api/internal/festival/application_test.go`
- Modify: `api/internal/festival/testhelpers_test.go` — add `createTestApplicationFormWithFields`

**Context:** Artist submits answers to a form. Handler must: (1) fetch the form, (2) check open window if set, (3) parse fields jsonb as []formField, (4) validate required fields in answers, (5) look up artist profile by userID, (6) insert application. Unique violation on (form_id, artist_id) → 409. Requires artist role.

---

- [ ] **Step 1: Add createTestApplicationFormWithFields to testhelpers_test.go**

Add this function to `api/internal/festival/testhelpers_test.go` (after the existing `createTestApplicationForm` function):

```go
func createTestApplicationFormWithFields(t *testing.T, pool *pgxpool.Pool, festivalID string, fieldsJSON string) string {
	t.Helper()
	q := sqlcdb.New(pool)
	form, err := q.UpsertApplicationForm(context.Background(), sqlcdb.UpsertApplicationFormParams{
		FestivalID: pgUUID(t, festivalID),
		Fields:     []byte(fieldsJSON),
	})
	if err != nil {
		t.Fatalf("create application form with fields for festival %s: %v", festivalID, err)
	}
	return form.ID.String()
}
```

- [ ] **Step 2: Write failing tests**

Create `api/internal/festival/application_test.go`:

```go
package festival_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestSubmitApplication_Success(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "applyorg@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "apply-fest", "open")
	createTestApplicationFormWithFields(t, db, festID,
		`[{"id":"q1","label":"Why?","type":"long_text","required":true}]`)

	artistID, artistToken := createTestUser(t, db, "applyartist@example.com", "artist")
	createTestArtistProfile(t, db, artistID, "Apply Artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply",
		`{"answers":{"q1":"I love murals"}}`, artistToken)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, b)
	}
	resp.Body.Close()
}

func TestSubmitApplication_MissingRequiredField(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "applyorg2@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "apply-fest2", "open")
	createTestApplicationFormWithFields(t, db, festID,
		`[{"id":"q1","label":"Why?","type":"long_text","required":true}]`)

	artistID, artistToken := createTestUser(t, db, "applyartist2@example.com", "artist")
	createTestArtistProfile(t, db, artistID, "Apply Artist 2")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Empty answers — required field q1 missing
	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply",
		`{"answers":{}}`, artistToken)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestSubmitApplication_DuplicateReturns409(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "applyorg3@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "apply-fest3", "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)

	artistID, artistToken := createTestUser(t, db, "applyartist3@example.com", "artist")
	createTestArtistProfile(t, db, artistID, "Apply Artist 3")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply", `{"answers":{}}`, artistToken)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("first apply: expected 201, got %d: %s", resp.StatusCode, b)
	}
	resp.Body.Close()

	resp2 := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply", `{"answers":{}}`, artistToken)
	if resp2.StatusCode != http.StatusConflict {
		t.Fatalf("second apply: expected 409, got %d", resp2.StatusCode)
	}
	resp2.Body.Close()
}

func TestSubmitApplication_RequiresArtistRole(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "applyorg4@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "apply-fest4", "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply", `{"answers":{}}`, orgToken)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for organiser, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd api && go test ./internal/festival/... -run TestSubmitApplication -v 2>&1 | head -10
```

Expected: compile error — festival.SubmitApplicationHandler undefined.

- [ ] **Step 4: Implement api/internal/festival/application.go**

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

type formField struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Type     string `json:"type"`
	Required bool   `json:"required"`
}

type applicationResponse struct {
	ID        string          `json:"id"`
	FormID    string          `json:"form_id"`
	ArtistID  string          `json:"artist_id"`
	Status    string          `json:"status"`
	Answers   json.RawMessage `json:"answers"`
	CreatedAt string          `json:"created_at"`
	UpdatedAt string          `json:"updated_at"`
}

func toApplicationResponse(a sqlcdb.Application) applicationResponse {
	return applicationResponse{
		ID:        a.ID.String(),
		FormID:    a.FormID.String(),
		ArtistID:  a.ArtistID.String(),
		Status:    string(a.Status),
		Answers:   a.Answers,
		CreatedAt: a.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt: a.UpdatedAt.Time.Format(time.RFC3339),
	}
}

// SubmitApplicationHandler handles POST /festivals/{festivalID}/apply. Requires artist role.
func SubmitApplicationHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		if principal.Role != "artist" {
			httperr.Forbidden(w)
			return
		}

		festUUID, err := pgUUIDFromString(chi.URLParam(r, "festivalID"))
		if err != nil {
			httperr.BadRequest(w, "invalid festivalID")
			return
		}

		q := sqlcdb.New(pool)
		form, err := q.GetApplicationFormByFestivalID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		// Check open window
		now := time.Now().UTC()
		if form.OpenAt != nil && form.OpenAt.Valid && now.Before(form.OpenAt.Time) {
			httperr.Write(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "applications not yet open")
			return
		}
		if form.CloseAt != nil && form.CloseAt.Valid && now.After(form.CloseAt.Time) {
			httperr.Write(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "applications closed")
			return
		}

		var req struct {
			Answers map[string]string `json:"answers"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Answers == nil {
			req.Answers = map[string]string{}
		}

		// Validate required fields
		var fields []formField
		if err := json.Unmarshal(form.Fields, &fields); err != nil {
			httperr.InternalServerError(w)
			return
		}
		for _, f := range fields {
			if f.Required {
				if v, ok := req.Answers[f.ID]; !ok || v == "" {
					httperr.UnprocessableEntity(w, "required field missing: "+f.ID)
					return
				}
			}
		}

		// Get artist profile
		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.Write(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "artist profile required to apply")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		answersJSON, err := json.Marshal(req.Answers)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		app, err := q.CreateApplication(r.Context(), sqlcdb.CreateApplicationParams{
			FormID:   form.ID,
			ArtistID: profile.ID,
			Answers:  answersJSON,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httperr.Write(w, http.StatusConflict, "Conflict", "already applied to this festival")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toApplicationResponse(app))
	}
}
```

- [ ] **Step 5: Run tests**

```bash
cd api && go test ./internal/festival/... -run TestSubmitApplication -v
```

Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add api/internal/festival/application.go \
        api/internal/festival/application_test.go \
        api/internal/festival/testhelpers_test.go
git commit -m "feat(festival): add submit application handler with field validation"
```
