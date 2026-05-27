package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// oauthHTTPClient is used for outbound OAuth HTTP calls (Apple token endpoint, Google userinfo).
// A bounded timeout prevents handlers from hanging on unresponsive upstream providers.
var oauthHTTPClient = &http.Client{Timeout: 10 * time.Second}

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
	// Inject our bounded HTTP client so the userinfo call has a timeout.
	ctx = context.WithValue(ctx, oauth2.HTTPClient, oauthHTTPClient)
	client := cfg.Client(ctx, token)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.googleapis.com/oauth2/v3/userinfo", nil)
	if err != nil {
		return nil, fmt.Errorf("build google userinfo request: %w", err)
	}
	resp, err := client.Do(req)
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
//
// Lookup order:
//  1. By OAuth (provider, subject) — covers returning users, including Apple where
//     email is only returned on first login.
//  2. By email — link the OAuth identity to an existing email-based account.
//  3. Create a new account (artist role by default). Requires a non-empty email.
func upsertOAuthUser(ctx context.Context, pool *pgxpool.Pool, email, subject, provider string) (sqlcdb.User, error) {
	q := sqlcdb.New(pool)

	// 1. Check for existing OAuth link first — this is what catches returning Apple
	//    users (Apple only sends email on the very first sign-in).
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

	// 2. From here on we need an email. If the provider didn't give us one and
	//    the OAuth lookup above didn't find an existing link, we can't proceed.
	if email == "" {
		return sqlcdb.User{}, fmt.Errorf("oauth provider returned no email for new user")
	}
	emailLower := strings.ToLower(email)

	// 3. Try linking to an existing email account
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

	// 4. New OAuth user — create account with artist role by default
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

// appleClientSecret generates a short-lived JWT used as the Apple OAuth client secret.
func appleClientSecret(teamID, clientID, keyID, privateKeyPEM string) (string, error) {
	pemData := strings.ReplaceAll(privateKeyPEM, `\n`, "\n")
	block, _ := pem.Decode([]byte(pemData))
	if block == nil {
		return "", fmt.Errorf("failed to decode Apple private key PEM")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("parse Apple private key: %w", err)
	}
	ecKey, ok := key.(*ecdsa.PrivateKey)
	if !ok {
		return "", fmt.Errorf("Apple key is not ECDSA")
	}

	now := time.Now()
	claims := jwt.MapClaims{
		"iss": teamID,
		"iat": now.Unix(),
		"exp": now.Add(5 * time.Minute).Unix(),
		"aud": "https://appleid.apple.com",
		"sub": clientID,
	}
	t := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	t.Header["kid"] = keyID
	return t.SignedString(ecKey)
}

// AppleRedirectHandler handles GET /auth/oauth/apple.
func AppleRedirectHandler(clientID, redirectBase string) http.HandlerFunc {
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
		params := url.Values{}
		params.Set("client_id", clientID)
		params.Set("redirect_uri", redirectBase+"/auth/oauth/apple/callback")
		params.Set("response_type", "code")
		params.Set("response_mode", "form_post")
		params.Set("scope", "name email")
		params.Set("state", state)
		authorizeURL := "https://appleid.apple.com/auth/authorize?" + params.Encode()
		http.Redirect(w, r, authorizeURL, http.StatusTemporaryRedirect)
	}
}

// AppleCallbackHandler handles POST /auth/oauth/apple/callback (Apple uses form_post response mode).
func AppleCallbackHandler(pool *pgxpool.Pool, clientID, teamID, keyID, privateKey, redirectBase, jwtSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			httperr.BadRequest(w, "invalid form")
			return
		}
		state := r.FormValue("state")
		code := r.FormValue("code")

		stateCookie, err := r.Cookie("oauth_state")
		if err != nil || state != stateCookie.Value {
			httperr.BadRequest(w, "invalid oauth state")
			return
		}

		clientSecret, err := appleClientSecret(teamID, clientID, keyID, privateKey)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		appleEmail, appleSubject, err := exchangeAppleCode(r.Context(), code, clientID, clientSecret, redirectBase)
		if err != nil {
			httperr.Write(w, http.StatusBadGateway, "OAuth Error", "failed to exchange Apple code")
			return
		}
		// Apple only returns email on first login; returning users will have empty email
		// but must still have a subject. Subject is the stable user identifier.
		if appleSubject == "" {
			httperr.Write(w, http.StatusBadGateway, "OAuth Error", "apple id_token missing subject")
			return
		}

		user, err := upsertOAuthUser(r.Context(), pool, appleEmail, appleSubject, "apple")
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
			Name: "session", Value: jwtToken, HttpOnly: true,
			SameSite: http.SameSiteLaxMode, Path: "/", MaxAge: int(tokenTTL.Seconds()),
		})
		http.SetCookie(w, &http.Cookie{
			Name: "oauth_state", MaxAge: -1, Path: "/",
			HttpOnly: true, SameSite: http.SameSiteLaxMode,
		})
		http.Redirect(w, r, redirectBase+"/dashboard", http.StatusSeeOther)
	}
}

// exchangeAppleCode exchanges an authorization code with Apple and extracts email and subject from the id_token.
func exchangeAppleCode(ctx context.Context, code, clientID, clientSecret, redirectBase string) (email, subject string, err error) {
	v := url.Values{}
	v.Set("client_id", clientID)
	v.Set("client_secret", clientSecret)
	v.Set("code", code)
	v.Set("grant_type", "authorization_code")
	v.Set("redirect_uri", redirectBase+"/auth/oauth/apple/callback")
	body := v.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://appleid.apple.com/auth/token",
		strings.NewReader(body))
	if err != nil {
		return "", "", fmt.Errorf("build apple token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := oauthHTTPClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("apple token endpoint: unexpected status %d", resp.StatusCode)
	}

	var result struct {
		IDToken string `json:"id_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", err
	}

	// Parse id_token claims with validation. Signature is not verified (TLS to Apple
	// already authenticates the source), but iss/aud/exp must be valid.
	// TODO: verify signature against Apple JWKS for defense-in-depth.
	parser := jwt.NewParser(jwt.WithIssuer("https://appleid.apple.com"), jwt.WithAudience(clientID))
	var claims struct {
		jwt.RegisteredClaims
		Email string `json:"email"`
	}
	if _, _, err := parser.ParseUnverified(result.IDToken, &claims); err != nil {
		return "", "", fmt.Errorf("parse apple id_token: %w", err)
	}
	// ParseUnverified skips claim validation; run the same checks the Parser would
	// have run (iss, aud, exp) via a standalone Validator configured identically.
	validator := jwt.NewValidator(jwt.WithIssuer("https://appleid.apple.com"), jwt.WithAudience(clientID))
	if err := validator.Validate(&claims); err != nil {
		return "", "", fmt.Errorf("validate apple id_token claims: %w", err)
	}
	return claims.Email, claims.Subject, nil
}
