# Task 6: Review / Accept / Decline Handlers

**Files:**
- Create: `api/internal/festival/review.go`
- Create: `api/internal/festival/review_test.go`

**Context:** Organiser reviews applications. Accept: update status to 'accepted' + upsert festival_artist (AddFestivalArtist with status 'accepted'). Decline: update status to 'declined'. List: organiser gets all applications for a festival. All require auth + festival ownership. The accept flow uses AddFestivalArtist which is an ON CONFLICT DO UPDATE upsert.

---

- [ ] **Step 1: Write failing tests**

Create `api/internal/festival/review_test.go`:

```go
package festival_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

type reviewScenario struct {
	orgToken      string
	festID        string
	applicationID string
}

func setupReviewScenario(t *testing.T, db *pgxpool.Pool) reviewScenario {
	t.Helper()
	orgID, orgToken := createTestUser(t, db, "revorg@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "review-fest", "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)

	artistID, _ := createTestUser(t, db, "revartist@example.com", "artist")
	createTestArtistProfile(t, db, artistID, "Review Artist")

	// Insert application directly via sqlc
	q := sqlcdb.New(db)
	form, err := q.GetApplicationFormByFestivalID(context.Background(), pgUUID(t, festID))
	if err != nil {
		t.Fatalf("get form: %v", err)
	}
	artistProfile, err := q.GetArtistProfileByUserID(context.Background(), pgUUID(t, artistID))
	if err != nil {
		t.Fatalf("get profile: %v", err)
	}
	app, err := q.CreateApplication(context.Background(), sqlcdb.CreateApplicationParams{
		FormID:   form.ID,
		ArtistID: artistProfile.ID,
		Answers:  []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("create application: %v", err)
	}

	return reviewScenario{
		orgToken:      orgToken,
		festID:        festID,
		applicationID: app.ID.String(),
	}
}

func TestListApplications(t *testing.T) {
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/applications", "", sc.orgToken)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, b)
	}
	var list []map[string]any
	json.NewDecoder(resp.Body).Decode(&list)
	resp.Body.Close()
	if len(list) != 1 {
		t.Errorf("expected 1 application, got %d", len(list))
	}
}

func TestAcceptApplication(t *testing.T) {
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/accept", festival.AcceptApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/accept", "", sc.orgToken)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, b)
	}
	var app map[string]any
	json.NewDecoder(resp.Body).Decode(&app)
	resp.Body.Close()
	if app["status"] != "accepted" {
		t.Errorf("expected status accepted, got %v", app["status"])
	}
}

func TestDeclineApplication(t *testing.T) {
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/decline", festival.DeclineApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/decline", "", sc.orgToken)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, b)
	}
	var app map[string]any
	json.NewDecoder(resp.Body).Decode(&app)
	resp.Body.Close()
	if app["status"] != "declined" {
		t.Errorf("expected status declined, got %v", app["status"])
	}
}

func TestReview_ForbiddenForNonOwner(t *testing.T) {
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	_, otherToken := createTestUser(t, db, "revother@example.com", "organiser")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/applications", "", otherToken)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}
```

Note: The test file imports `pgxpool` for the `setupReviewScenario` signature. Add the import:
```go
import (
    ...
    "github.com/jackc/pgx/v5/pgxpool"
    ...
)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && go test ./internal/festival/... -run TestListApplications -v 2>&1 | head -10
```

Expected: compile error — festival.ListApplicationsHandler etc undefined.

- [ ] **Step 3: Implement api/internal/festival/review.go**

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

// festivalOwnershipCheck fetches the festival and verifies the caller owns it.
// Returns the festival or writes an error response and returns false.
func festivalOwnershipCheck(w http.ResponseWriter, r *http.Request, q *sqlcdb.Queries, festUUID interface{ String() string }, principalID string) bool {
	// This helper is implemented inline in each handler for clarity.
	return false
}

// ListApplicationsHandler handles GET /festivals/{festivalID}/applications. Requires auth + ownership.
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

		apps, err := q.ListApplicationsByForm(r.Context(), form.ID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		resp := make([]applicationResponse, len(apps))
		for i, a := range apps {
			resp[i] = toApplicationResponse(a)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// AcceptApplicationHandler handles POST /festivals/{festivalID}/applications/{applicationID}/accept.
// Updates application status to 'accepted' and upserts a festival_artist record.
func AcceptApplicationHandler(pool *pgxpool.Pool) http.HandlerFunc {
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

		app, err := q.GetApplicationByID(r.Context(), appUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		updated, err := q.UpdateApplicationStatus(r.Context(), sqlcdb.UpdateApplicationStatusParams{
			ID:     appUUID,
			Status: sqlcdb.ApplicationStatusAccepted,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Upsert festival_artist
		_, err = q.AddFestivalArtist(r.Context(), sqlcdb.AddFestivalArtistParams{
			FestivalID: festUUID,
			ArtistID:   app.ArtistID,
			Status:     sqlcdb.FestivalArtistStatusAccepted,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toApplicationResponse(updated))
	}
}

// DeclineApplicationHandler handles POST /festivals/{festivalID}/applications/{applicationID}/decline.
func DeclineApplicationHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
			Status: sqlcdb.ApplicationStatusDeclined,
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

Note: Remove the unused `festivalOwnershipCheck` stub if the compiler complains (it's not needed since ownership is checked inline).

- [ ] **Step 4: Run tests**

```bash
cd api && go test ./internal/festival/... -run "TestListApplications|TestAcceptApplication|TestDeclineApplication|TestReview_" -v
```

Expected: all 4 review tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/internal/festival/review.go api/internal/festival/review_test.go
git commit -m "feat(festival): add application list/accept/decline review handlers"
```
