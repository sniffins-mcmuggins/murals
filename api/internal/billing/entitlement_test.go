package billing_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestCanPublish_NoEntitlement_ReturnsFalse(t *testing.T) {
	t.Parallel()
	pool := testutil.NewDB(t)
	q := sqlcdb.New(pool)
	ctx := context.Background()

	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "nopub-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)

	ok, err := billing.CanPublish(ctx, pool, user.ID)
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestCanPublish_ActiveArtistBasicGrant_ReturnsTrue(t *testing.T) {
	t.Parallel()
	pool := testutil.NewDB(t)
	q := sqlcdb.New(pool)
	ctx := context.Background()

	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "pub-basic-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)
	grantor, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "grantor-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)

	_, err = q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:     user.ID,
		Plan:       "artist_basic",
		FestivalID: pgtype.UUID{},
		ValidUntil: pgtype.Timestamptz{Time: time.Now().Add(30 * 24 * time.Hour), Valid: true},
		GrantedBy:  grantor.ID,
		Note:       ptr("comp test"),
	})
	require.NoError(t, err)

	ok, err := billing.CanPublish(ctx, pool, user.ID)
	require.NoError(t, err)
	assert.True(t, ok)
}

func TestCanPublish_ActiveArtistProGrant_ReturnsTrue(t *testing.T) {
	t.Parallel()
	pool := testutil.NewDB(t)
	q := sqlcdb.New(pool)
	ctx := context.Background()

	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "pub-pro-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)
	grantor, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "grantor-pro-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)

	_, err = q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:     user.ID,
		Plan:       "artist_pro",
		FestivalID: pgtype.UUID{},
		ValidUntil: pgtype.Timestamptz{Time: time.Now().Add(30 * 24 * time.Hour), Valid: true},
		GrantedBy:  grantor.ID,
		Note:       ptr("comp pro test"),
	})
	require.NoError(t, err)

	ok, err := billing.CanPublish(ctx, pool, user.ID)
	require.NoError(t, err)
	assert.True(t, ok)
}

func TestCanPublish_ExpiredGrant_ReturnsFalse(t *testing.T) {
	t.Parallel()
	pool := testutil.NewDB(t)
	q := sqlcdb.New(pool)
	ctx := context.Background()

	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "expired-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)
	grantor, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "grantor-exp-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)

	_, err = q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:     user.ID,
		Plan:       "artist_basic",
		FestivalID: pgtype.UUID{},
		ValidUntil: pgtype.Timestamptz{Time: time.Now().Add(-24 * time.Hour), Valid: true}, // expired yesterday
		GrantedBy:  grantor.ID,
		Note:       ptr("expired comp"),
	})
	require.NoError(t, err)

	ok, err := billing.CanPublish(ctx, pool, user.ID)
	require.NoError(t, err)
	assert.False(t, ok)
}
