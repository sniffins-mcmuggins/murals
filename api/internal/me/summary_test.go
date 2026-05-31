package me_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/me"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

var testUserSeq, testFestSeq atomic.Int64

func pgUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	parsed, err := uuid.Parse(s)
	if err != nil {
		t.Fatalf("parse uuid %q: %v", s, err)
	}
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}
}

func createTestUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	email := fmt.Sprintf("t-%d@t.local", testUserSeq.Add(1))
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
		t.Fatalf("create user: %v", err)
	}
	return user.ID.String()
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

func createTestFestival(t *testing.T, pool *pgxpool.Pool, organiserID, name string) (festID, slug string) {
	t.Helper()
	slug = fmt.Sprintf("fest-%d", testFestSeq.Add(1))
	q := sqlcdb.New(pool)
	fest, err := q.CreateFestival(context.Background(), sqlcdb.CreateFestivalParams{
		OrganiserID:   pgUUID(t, organiserID),
		Name:          name,
		Slug:          slug,
		Description:   "",
		LocationLabel: "",
		Status:        sqlcdb.FestivalStatus("draft"),
	})
	if err != nil {
		t.Fatalf("create festival: %v", err)
	}
	return fest.ID.String(), slug
}

func TestSummary_NoProfileNoFestivals(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID := createTestUser(t, db)

	handler := me.SummaryHandler(db)
	ctx := auth.WithUserForTest(t.Context(), userID, false)
	r := httptest.NewRequestWithContext(ctx, http.MethodGet, "/me/summary", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var body struct {
		ArtistProfile any   `json:"artist_profile"`
		Festivals     []any `json:"festivals"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Nil(t, body.ArtistProfile)
	assert.Empty(t, body.Festivals)
}

func TestSummary_WithProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID := createTestUser(t, db)
	profileID := createTestArtistProfile(t, db, userID, "Bob the Painter")

	handler := me.SummaryHandler(db)
	ctx := auth.WithUserForTest(t.Context(), userID, false)
	r := httptest.NewRequestWithContext(ctx, http.MethodGet, "/me/summary", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var body struct {
		ArtistProfile struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"artist_profile"`
		Festivals []any `json:"festivals"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Equal(t, profileID, body.ArtistProfile.ID)
	assert.Equal(t, "Bob the Painter", body.ArtistProfile.DisplayName)
	assert.Empty(t, body.Festivals)
}

func TestSummary_WithFestivals(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID := createTestUser(t, db)
	festID, slug := createTestFestival(t, db, userID, "My Festival")

	handler := me.SummaryHandler(db)
	ctx := auth.WithUserForTest(t.Context(), userID, false)
	r := httptest.NewRequestWithContext(ctx, http.MethodGet, "/me/summary", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var body struct {
		ArtistProfile any `json:"artist_profile"`
		Festivals     []struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Slug   string `json:"slug"`
			Status string `json:"status"`
		} `json:"festivals"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Nil(t, body.ArtistProfile)
	require.Len(t, body.Festivals, 1)
	assert.Equal(t, festID, body.Festivals[0].ID)
	assert.Equal(t, "My Festival", body.Festivals[0].Name)
	assert.Equal(t, slug, body.Festivals[0].Slug)
	assert.Equal(t, "draft", body.Festivals[0].Status)
}

func TestSummary_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := me.SummaryHandler(db)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/me/summary", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
