package artist_test

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

const testSecret = "test-secret-key"

var testUserSeq atomic.Int64

func pgUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	parsed, err := uuid.Parse(s)
	if err != nil {
		t.Fatalf("parse uuid %q: %v", s, err)
	}
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}
}

func createTestUser(t *testing.T, pool *pgxpool.Pool) (userID string, token string) {
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
	userID = user.ID.String()
	token, err = auth.IssueToken(userID, user.IsAdmin, user.SessionVersion, testSecret)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return userID, token
}

func createTestProfile(t *testing.T, pool *pgxpool.Pool, userID, displayName string) string {
	t.Helper()
	q := sqlcdb.New(pool)
	profile, err := q.CreateArtistProfile(context.Background(), sqlcdb.CreateArtistProfileParams{
		UserID:      pgUUID(t, userID),
		DisplayName: displayName,
	})
	if err != nil {
		t.Fatalf("create profile for %s: %v", userID, err)
	}
	return profile.ID.String()
}

func pgTimestamptzForArtistTest(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func grantArtistBasic(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	q := sqlcdb.New(pool)
	hash, _ := bcrypt.GenerateFromPassword([]byte("g"), bcrypt.MinCost)
	hashStr := string(hash)
	grantor, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email: "grantor-" + userID + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)
	_, err = q.CreateAccessGrant(context.Background(), sqlcdb.CreateAccessGrantParams{
		UserID:      pgUUID(t, userID),
		Plan:        "artist_basic",
		FestivalID:  pgtype.UUID{},
		ValidUntil:  pgTimestamptzForArtistTest(time.Now().Add(30 * 24 * time.Hour)),
		GrantedBy:   grantor.ID,
		PromoCodeID: pgtype.UUID{},
		Note:        nil,
	})
	require.NoError(t, err)
}

// publishTestProfile sets a profile's visibility to "public" so it passes
// the visibility gate on public endpoints. Copies all existing field values.
func publishTestProfile(t *testing.T, pool *pgxpool.Pool, profileID string) {
	t.Helper()
	q := sqlcdb.New(pool)
	existing, err := q.GetArtistProfileByID(context.Background(), pgUUID(t, profileID))
	if err != nil {
		t.Fatalf("get profile %s for publish: %v", profileID, err)
	}
	headlineImageUrls := existing.HeadlineImageUrls
	if headlineImageUrls == nil {
		headlineImageUrls = []string{}
	}
	mediumTags := existing.MediumTags
	if mediumTags == nil {
		mediumTags = []string{}
	}
	_, err = q.UpdateArtistProfile(context.Background(), sqlcdb.UpdateArtistProfileParams{
		ID:                existing.ID,
		DisplayName:       existing.DisplayName,
		Bio:               existing.Bio,
		LocationLabel:     existing.LocationLabel,
		ShowLocation:      existing.ShowLocation,
		MediumTags:        mediumTags,
		SocialLinks:       existing.SocialLinks,
		AvatarS3Key:       existing.AvatarS3Key,
		HeadlineImageUrls: headlineImageUrls,
		Visibility:        "public",
	})
	if err != nil {
		t.Fatalf("publish profile %s: %v", profileID, err)
	}
}
