package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

func googleOAuthConfig(clientID, clientSecret, redirectBase string) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectBase + "/auth/oauth/google/callback",
		Scopes:       []string{"openid", "email", "profile"},
		Endpoint:     google.Endpoint,
	}
}

// GoogleRedirectHandler handles GET /auth/oauth/google.
func GoogleRedirectHandler(clientID, clientSecret, redirectBase string) http.HandlerFunc {
	cfg := googleOAuthConfig(clientID, clientSecret, redirectBase)
	return func(w http.ResponseWriter, r *http.Request) {
		state := randomState()
		http.SetCookie(w, &http.Cookie{
			Name:     "oauth_state",
			Value:    state,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   300,
			Path:     "/",
		})
		http.Redirect(w, r, cfg.AuthCodeURL(state), http.StatusTemporaryRedirect)
	}
}

type googleUserInfo struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
}

// GoogleCallbackHandler handles GET /auth/oauth/google/callback.
func GoogleCallbackHandler(pool *pgxpool.Pool, clientID, clientSecret, redirectBase, jwtSecret string) http.HandlerFunc {
	cfg := googleOAuthConfig(clientID, clientSecret, redirectBase)
	return func(w http.ResponseWriter, r *http.Request) {
		stateCookie, err := r.Cookie("oauth_state")
		if err != nil || r.URL.Query().Get("state") != stateCookie.Value {
			httperr.BadRequest(w, "invalid oauth state")
			return
		}

		code := r.URL.Query().Get("code")
		token, err := cfg.Exchange(r.Context(), code)
		if err != nil {
			httperr.Write(w, http.StatusBadGateway, "OAuth Error", "failed to exchange code")
			return
		}

		userInfo, err := fetchGoogleUserInfo(r.Context(), cfg, token)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		if !userInfo.EmailVerified {
			http.Error(w, "google account email not verified", http.StatusBadRequest)
			return
		}

		user, err := upsertOAuthUser(r.Context(), pool, userInfo.Email, userInfo.Sub, "google")
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		jwtToken, err := IssueToken(user.ID.String(), string(user.Role), jwtSecret)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		http.SetCookie(w, &http.Cookie{
			Name:     "session",
			Value:    jwtToken,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Path:     "/",
			MaxAge:   int(tokenTTL.Seconds()),
		})
		http.SetCookie(w, &http.Cookie{
			Name:     "oauth_state",
			MaxAge:   -1,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
		})
		http.Redirect(w, r, redirectBase+"/dashboard", http.StatusSeeOther)
	}
}

func fetchGoogleUserInfo(ctx context.Context, cfg *oauth2.Config, token *oauth2.Token) (*googleUserInfo, error) {
	client := cfg.Client(ctx, token)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v3/userinfo")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google userinfo: unexpected status %d", resp.StatusCode)
	}
	var info googleUserInfo
	return &info, json.NewDecoder(resp.Body).Decode(&info)
}

// upsertOAuthUser finds or creates a user for the given OAuth provider+subject.
func upsertOAuthUser(ctx context.Context, pool *pgxpool.Pool, email, subject, provider string) (sqlcdb.User, error) {
	q := sqlcdb.New(pool)

	// Check for existing OAuth link
	existing, err := q.GetUserByOAuth(ctx, sqlcdb.GetUserByOAuthParams{
		OauthProvider: &provider,
		OauthSubject:  &subject,
	})
	if err == nil {
		return existing, nil
	}
	if err != pgx.ErrNoRows {
		return sqlcdb.User{}, err
	}

	// Check if email already exists (link OAuth to existing account)
	emailLower := strings.ToLower(email)
	byEmail, err := q.GetUserByEmail(ctx, emailLower)
	if err == nil {
		return q.LinkOAuthToUser(ctx, sqlcdb.LinkOAuthToUserParams{
			ID:            byEmail.ID,
			OauthProvider: &provider,
			OauthSubject:  &subject,
		})
	}
	if err != pgx.ErrNoRows {
		return sqlcdb.User{}, err
	}

	// New OAuth user — create account with artist role by default
	return q.CreateOAuthUser(ctx, sqlcdb.CreateOAuthUserParams{
		Email:         emailLower,
		Role:          sqlcdb.UserRoleArtist,
		OauthProvider: &provider,
		OauthSubject:  &subject,
	})
}

func randomState() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("crypto/rand.Read failed: %v", err))
	}
	return base64.URLEncoding.EncodeToString(b)
}
