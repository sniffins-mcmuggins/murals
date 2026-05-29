package festival_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
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

func createTestUser(t *testing.T, pool *pgxpool.Pool, email string) (userID string, token string) {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("hunter2hunter"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	hashStr := string(hash)
	q := sqlcdb.New(pool)
	user, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email:        email,
		PasswordHash: &hashStr,
	})
	if err != nil {
		t.Fatalf("create user %s: %v", email, err)
	}
	userID = user.ID.String()
	token, err = auth.IssueToken(userID, user.IsAdmin, user.SessionVersion, testSecret)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return userID, token
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

func addReviewer(t *testing.T, db *pgxpool.Pool, festID, userID string) {
	t.Helper()
	_, err := sqlcdb.New(db).AddFestivalReviewer(context.Background(), sqlcdb.AddFestivalReviewerParams{
		FestivalID: pgUUID(t, festID), UserID: pgUUID(t, userID),
	})
	require.NoError(t, err)
}

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

func setFormAnonymousReview(t *testing.T, pool *pgxpool.Pool, festivalID string, value bool) {
	t.Helper()
	_, err := sqlcdb.New(pool).PatchFormAnonymousReview(context.Background(), sqlcdb.PatchFormAnonymousReviewParams{
		FestivalID:      pgUUID(t, festivalID),
		AnonymousReview: value,
	})
	require.NoError(t, err)
}
