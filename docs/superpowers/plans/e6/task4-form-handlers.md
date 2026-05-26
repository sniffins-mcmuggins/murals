# Task 4: Application Form Handlers

**Files:**
- Create: `api/internal/festival/form.go`
- Create: `api/internal/festival/form_test.go`

**Context:** Application form is owned by the festival (unique FK). PUT /festivals/{festivalID}/form upserts. GET /festivals/{festivalID}/form is public. Only the festival's organiser can upsert. Helpers from testhelpers_test.go (createTestUser, createTestFestival, createTestApplicationForm, pgUUID, doRequest) are available.

---

- [ ] **Step 1: Write failing tests**

Create `api/internal/festival/form_test.go`:

```go
package festival_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestUpsertForm_CreatesAndUpdates(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "formorg@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "form-test-fest", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Put("/festivals/{festivalID}/form", festival.UpsertFormHandler(db))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Create
	body := `{"fields":[{"id":"q1","label":"Why do you want to paint?","type":"long_text","required":true}]}`
	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/form", body, orgToken)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, b)
	}
	var form map[string]any
	json.NewDecoder(resp.Body).Decode(&form)
	resp.Body.Close()
	fields := form["fields"].([]any)
	if len(fields) != 1 {
		t.Errorf("expected 1 field, got %d", len(fields))
	}

	// Update — replace fields wholesale
	body2 := `{"fields":[{"id":"q1","label":"Why?","type":"long_text","required":true},{"id":"q2","label":"Portfolio URL","type":"url","required":false}]}`
	resp2 := doRequest(t, srv, "PUT", "/festivals/"+festID+"/form", body2, orgToken)
	if resp2.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp2.Body)
		t.Fatalf("expected 200 on update, got %d: %s", resp2.StatusCode, b)
	}
	var form2 map[string]any
	json.NewDecoder(resp2.Body).Decode(&form2)
	resp2.Body.Close()
	if len(form2["fields"].([]any)) != 2 {
		t.Errorf("expected 2 fields after update, got %d", len(form2["fields"].([]any)))
	}
}

func TestUpsertForm_OnlyOrganiserOwnerCanUpsert(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "formorg2@example.com", "organiser")
	_, otherToken := createTestUser(t, db, "formorg3@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "form-test-fest2", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Put("/festivals/{festivalID}/form", festival.UpsertFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/form", `{"fields":[]}`, otherToken)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestGetForm_Public(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "formorg4@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "form-test-fest3", "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/form", "", "")
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, b)
	}
	resp.Body.Close()
}

func TestGetForm_NotFound(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "formorg5@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "form-no-form", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/form", "", "")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && go test ./internal/festival/... -run TestUpsertForm -v 2>&1 | head -10
```

Expected: compile error — festival.UpsertFormHandler and festival.GetFormHandler undefined.

- [ ] **Step 3: Implement api/internal/festival/form.go**

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

type formResponse struct {
	ID             string          `json:"id"`
	FestivalID     string          `json:"festival_id"`
	Fields         json.RawMessage `json:"fields"`
	OpenAt         *string         `json:"open_at,omitempty"`
	CloseAt        *string         `json:"close_at,omitempty"`
	MaxApplications *int32          `json:"max_applications,omitempty"`
	CreatedAt      string          `json:"created_at"`
	UpdatedAt      string          `json:"updated_at"`
}

func toFormResponse(f sqlcdb.ApplicationForm) formResponse {
	resp := formResponse{
		ID:         f.ID.String(),
		FestivalID: f.FestivalID.String(),
		Fields:     f.Fields,
		CreatedAt:  f.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:  f.UpdatedAt.Time.Format(time.RFC3339),
	}
	if f.OpenAt != nil && f.OpenAt.Valid {
		s := f.OpenAt.Time.Format(time.RFC3339)
		resp.OpenAt = &s
	}
	if f.CloseAt != nil && f.CloseAt.Valid {
		s := f.CloseAt.Time.Format(time.RFC3339)
		resp.CloseAt = &s
	}
	if f.MaxApplications != nil {
		resp.MaxApplications = f.MaxApplications
	}
	return resp
}

// UpsertFormHandler handles PUT /festivals/{festivalID}/form. Requires auth + festival ownership.
func UpsertFormHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
			Fields json.RawMessage `json:"fields"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Fields == nil {
			req.Fields = json.RawMessage(`[]`)
		}

		form, err := q.UpsertApplicationForm(r.Context(), sqlcdb.UpsertApplicationFormParams{
			FestivalID: festUUID,
			Fields:     req.Fields,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toFormResponse(form))
	}
}

// GetFormHandler handles GET /festivals/{festivalID}/form. Public.
func GetFormHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toFormResponse(form))
	}
}
```

- [ ] **Step 4: Run tests**

```bash
cd api && go test ./internal/festival/... -run TestUpsertForm -v
cd api && go test ./internal/festival/... -run TestGetForm -v
```

Expected: all 4 form tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/internal/festival/form.go api/internal/festival/form_test.go
git commit -m "feat(festival): add application form upsert and get handlers"
```
