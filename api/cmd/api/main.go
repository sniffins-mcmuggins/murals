package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/sniffins-mcmuggins/render/api/internal/admin"
	"github.com/sniffins-mcmuggins/render/api/internal/analytics"
	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/beta"
	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/config"
	"github.com/sniffins-mcmuggins/render/api/internal/db"
	"github.com/sniffins-mcmuggins/render/api/internal/email"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/health"
	"github.com/sniffins-mcmuggins/render/api/internal/image"
	"github.com/sniffins-mcmuggins/render/api/internal/me"
	"github.com/sniffins-mcmuggins/render/api/internal/metrics"
	"github.com/sniffins-mcmuggins/render/api/internal/middleware"
)

func main() {
	cfg := config.Load()
	if cfg.BetaMode {
		slog.Info("beta mode enabled — invite-only access enforced")
	}

	logger := newLogger(cfg.LogLevel)
	slog.SetDefault(logger)

	ctx := context.Background()
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("database connection failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	mc, err := minio.New(cfg.MinioEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinioAccessKey, cfg.MinioSecretKey, ""),
		Secure: cfg.MinioUseSSL,
	})
	if err != nil {
		slog.Error("minio client init failed", "err", err)
		os.Exit(1)
	}

	// Public-facing client: presigned URLs are signed with the public endpoint so
	// browsers can PUT directly without a Host header mismatch invalidating the signature.
	// Region is set to skip the GetBucketLocation network call, which fails when the public
	// endpoint is not reachable from inside the container (e.g. localhost:9000 in Docker).
	mcPublic, err := minio.New(cfg.MinioPublicEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinioAccessKey, cfg.MinioSecretKey, ""),
		Secure: cfg.MinioUseSSL,
		Region: "us-east-1",
	})
	if err != nil {
		slog.Error("minio public client init failed", "err", err)
		os.Exit(1)
	}

	// Email sender: SES in production, no-op locally when SES isn't configured.
	//
	// In prod set SES_REQUIRED=true so a missing/broken SES config is fatal.
	// Falling back silently to NoopMailer would mean password reset emails
	// disappear into the void, leaving users with no recovery path.
	mailer := buildMailer(ctx, cfg)

	// Configure the per-IP rate limiter for auth routes. Prod keeps the
	// default (5/min); compose/CI bumps it via env so every e2e worker
	// (which shares the same source IP from the API's POV) doesn't trip the
	// shared bucket within seconds.
	auth.ConfigureRateLimit(cfg.LoginRateLimitPerMin, cfg.LoginRateLimitBurst)

	stripeClient := billing.NewStripeClient(cfg.StripeSecretKey)
	billingPrices := billing.Prices{
		ArtistBasicAnnual:  cfg.StripeArtistBasicAnnualPrice,
		ArtistBasicMonth:   cfg.StripeArtistBasicMonthPrice,
		ArtistProAnnual:    cfg.StripeArtistProAnnualPrice,
		ArtistProMonth:     cfg.StripeArtistProMonthPrice,
		OrgSetup:           cfg.StripeOrgSetupPrice,
		FestivalActivation: cfg.StripeFestivalActivationPrice,
		FestivalAnnual:     cfg.StripeFestivalAnnualPrice,
	}
	warnIfStripeMisconfigured(cfg)

	r := chi.NewRouter()
	r.Use(corsMiddleware(cfg.CORSAllowedOrigins))
	r.Use(chiMiddleware.RealIP)
	r.Use(middleware.Logger(logger))
	r.Use(middleware.Recover)
	r.Use(metrics.Middleware())
	r.Use(auth.Middleware(pool, cfg.JWTSecret))

	r.Get("/healthz", health.Handler(pool))
	r.Handle("/metrics", metrics.Handler())

	// Public routes — no auth or beta gate required.
	r.Get("/public/beta-status", beta.BetaStatusHandler(cfg))
	r.Get("/public/festivals", festival.ListPublicHandler(pool))
	r.Get("/public/profiles", artist.ListPublicProfilesHandler(pool))
	r.Get("/festivals/slug/{slug}/map", festival.GetMapDataHandler(pool))

	// Rate-limited auth routes (5/min per IP) — login, password reset, MFA verify,
	// promo redemption (prevents bulk code enumeration), and waitlist signups.
	r.Group(func(r chi.Router) {
		r.Use(auth.RateLimitMiddleware)
		r.Post("/auth/login", auth.LoginHandler(pool, cfg.JWTSecret))
		r.Post("/auth/forgot-password", auth.ForgotPasswordHandler(pool, mailer, cfg.WebPublicBase))
		r.Post("/auth/reset-password", auth.ResetPasswordHandler(pool))
		r.Post("/auth/mfa/verify", auth.TOTPVerifyHandler(pool, cfg.TOTPEncryptionKey, cfg.JWTSecret))
		r.Post("/promo/redeem", admin.RedeemPromoHandler(pool))
		r.Post("/waitlist", beta.WaitlistHandler(pool))
	})

	r.Post("/auth/signup", auth.SignupHandler(pool, cfg))

	// MFA enrolment — requires an authenticated session (the auth middleware gate is sufficient).
	r.Post("/auth/mfa/enroll", auth.TOTPEnrollHandler(pool, cfg.TOTPEncryptionKey))
	r.Post("/auth/mfa/confirm", auth.TOTPConfirmHandler(pool, cfg.TOTPEncryptionKey))

	// OAuth — only register if the provider is configured.
	if cfg.GoogleClientID != "" {
		r.Get("/auth/oauth/google", auth.GoogleRedirectHandler(cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.APIPublicBase))
		r.Get("/auth/oauth/google/callback", auth.GoogleCallbackHandler(pool, cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.APIPublicBase, cfg.WebPublicBase, cfg.JWTSecret))
	}
	if cfg.AppleClientID != "" {
		r.Get("/auth/oauth/apple", auth.AppleRedirectHandler(cfg.AppleClientID, cfg.APIPublicBase))
		r.Post("/auth/oauth/apple/callback", auth.AppleCallbackHandler(pool, cfg.AppleClientID, cfg.AppleTeamID, cfg.AppleKeyID, cfg.ApplePrivateKey, cfg.APIPublicBase, cfg.WebPublicBase, cfg.JWTSecret))
	}

	// ── Authenticated + beta-gated routes ──
	// beta.Gate is a no-op when BetaMode is false (launch exit path).
	// Anonymous requests pass through; downstream handlers return 401 if they
	// require auth. Authenticated non-beta users receive 403 when BetaMode=true.
	r.Group(func(r chi.Router) {
		r.Use(beta.Gate(cfg, pool))

		r.Get("/me", auth.MeHandler(pool))
		r.Get("/me/summary", me.SummaryHandler(pool))
		r.Post("/images/presign", image.PresignHandler(mcPublic, cfg.MinioBucket))
		r.Post("/images/confirm", image.ConfirmHandler(mc, cfg.MinioBucket, cfg.CDNBaseURL))

		// Artist profiles
		r.Post("/profiles", artist.CreateProfileHandler(pool))
		r.Get("/profiles/me", artist.GetMyProfileHandler(pool))
		r.Patch("/profiles/me", artist.UpdateProfileHandler(pool))
		r.Get("/profiles/me/qr", artist.ProfileQRHandler(pool, cfg.WebPublicBase))          // literal /me before /{profileID}
		r.Get("/profiles/me/analytics", analytics.MyAnalyticsHandler(pool))                 // literal /me before /{profileID}
		r.Post("/profiles/me/preview-token/rotate", artist.RotatePreviewTokenHandler(pool)) // literal /me before /{profileID}
		r.Get("/profiles/preview/{token}", artist.PreviewByTokenHandler(pool))              // literal /preview before /{profileID}
		r.Post("/profiles/{profileID}/link-click", analytics.LinkClickHandler(pool))        // public — no auth
		r.Get("/profiles/{profileID}", artist.GetProfileHandler(pool))
		r.Get("/profiles/{profileID}/collections", artist.ListCollectionsHandler(pool))
		r.Get("/profiles/{profileID}/festivals", festival.ListArtistFestivalsHandler(pool)) // public festival appearances

		// Collections
		r.Post("/collections", artist.CreateCollectionHandler(pool))
		r.Put("/collections/order", artist.ReorderCollectionsHandler(pool)) // literal before /{collectionID}
		r.Get("/collections/{collectionID}", artist.GetCollectionHandler(pool))
		r.Patch("/collections/{collectionID}", artist.UpdateCollectionHandler(pool))
		r.Delete("/collections/{collectionID}", artist.DeleteCollectionHandler(pool))
		r.Get("/collections/{collectionID}/images", artist.ListCollectionImagesHandler(pool))
		r.Post("/collections/{collectionID}/images", artist.AttachImageHandler(pool))
		r.Put("/collections/{collectionID}/images/order", artist.ReorderImagesHandler(pool))
		r.Delete("/collections/{collectionID}/images/{imageID}", artist.DeleteImageHandler(pool))

		// Festivals
		r.Post("/festivals", festival.CreateHandler(pool))
		r.Get("/festivals", festival.ListHandler(pool))
		r.Get("/festivals/{festivalID}", festival.GetHandler(pool))
		r.Patch("/festivals/{festivalID}", festival.UpdateHandler(pool))
		r.Delete("/festivals/{festivalID}", festival.DeleteHandler(pool))

		// Application forms
		r.Put("/festivals/{festivalID}/form", festival.UpsertFormHandler(pool))
		r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(pool))
		r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(pool))

		// Applications
		r.Get("/me/applications", festival.GetMyApplicationsHandler(pool))
		r.Get("/me/reviewing", festival.MyReviewingHandler(pool))
		r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(pool))

		// Review
		r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(pool))
		r.Post("/festivals/{festivalID}/applications/{applicationID}/accept", festival.AcceptApplicationHandler(pool, mailer))
		r.Post("/festivals/{festivalID}/applications/{applicationID}/decline", festival.DeclineApplicationHandler(pool, mailer))
		r.Post("/festivals/{festivalID}/applications/{applicationID}/waitlist", festival.WaitlistApplicationHandler(pool, mailer))
		r.Patch("/festivals/{festivalID}/applications/{applicationID}", festival.PatchApplicationHandler(pool))
		r.Post("/festivals/{festivalID}/applications/reorder", festival.ReorderApplicationsHandler(pool))
		r.Post("/festivals/{festivalID}/applications/{applicationID}/notes", festival.AddApplicationNoteHandler(pool))

		// Reviewer management — owner only (handler-level check).
		r.Post("/festivals/{festivalID}/reviewers", festival.InviteReviewerHandler(pool, mailer, cfg.WebPublicBase))
		r.Get("/festivals/{festivalID}/reviewers", festival.ListReviewersHandler(pool))
		r.Delete("/festivals/{festivalID}/reviewers/{userID}", festival.RemoveReviewerHandler(pool))

		// Per-reviewer score — owner or reviewer (handler-level check).
		r.Put("/festivals/{festivalID}/applications/{applicationID}/score", festival.ScoreApplicationHandler(pool))

		// Spots (map editor)
		r.Get("/festivals/{festivalID}/spots", festival.GetSpotsHandler(pool))
		r.Post("/festivals/{festivalID}/spots", festival.CreateSpotHandler(pool))
		r.Patch("/festivals/{festivalID}/spots/{spotID}", festival.UpdateSpotHandler(pool))
		r.Delete("/festivals/{festivalID}/spots/{spotID}", festival.DeleteSpotHandler(pool))
		r.Put("/festivals/{festivalID}/spots/{spotID}/artist", festival.SetSpotArtistHandler(pool))
		r.Delete("/festivals/{festivalID}/spots/{spotID}/artist", festival.ClearSpotArtistHandler(pool))

		// Billing — webhook first (no auth required; Stripe POSTs directly).
		// CSRF posture: the session cookie is SameSite=Lax (api/internal/auth/login.go),
		// which blocks cross-site form POSTs to these endpoints. The Authorization
		// header path is unaffected by SameSite. Do not relax to SameSiteNoneMode
		// without adding a CSRF token.
		r.Method(http.MethodPost, "/billing/webhook", billing.WebhookHandler(pool, stripeClient, cfg.StripeWebhookSecret, billingPrices))
		r.Post("/billing/artist/checkout", billing.ArtistCheckoutHandler(pool, stripeClient, billingPrices, cfg.SiteBase))
		r.Post("/billing/organiser/setup-checkout", billing.OrgSetupCheckoutHandler(pool, stripeClient, billingPrices, cfg.SiteBase))
		r.Post("/billing/festival/{festivalID}/activate-checkout", billing.FestivalActivateCheckoutHandler(pool, stripeClient, billingPrices, cfg.SiteBase))
		r.Post("/billing/portal", billing.CustomerPortalHandler(pool, stripeClient, cfg.SiteBase))
		// billing.RequirePlan(pool, "artist_pro") is available as middleware for
		// gating Pro-only routes. Wire it on the consumer endpoint when one lands
		// (e.g. a Pro-only feature flag check), not here — gating policy is a
		// product decision separate from the payments plumbing.
		//
		// Test-only probe: exercises RequirePlan from the routing layer so e2e tests
		// can verify the no-sub / basic / pro decision tree end-to-end. The handler
		// returns 200 if and only if the middleware lets the request through. Path
		// is namespaced under /_test/ and exposes no real functionality; keep it as
		// the smallest possible probe until a real Pro-only endpoint replaces it.
		r.With(billing.RequirePlan(pool, "artist_pro")).Get("/_test/billing/pro-only", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		// Admin — requires admin role + MFA enrollment.
		r.Route("/admin", func(r chi.Router) {
			r.Use(admin.RequireAdmin(pool))
			r.Get("/users", admin.ListUsersHandler(pool))
			r.Get("/users/{userID}", admin.GetUserHandler(pool))
			r.Post("/users/{userID}/password-reset", admin.TriggerPasswordResetHandler(pool, mailer, cfg.WebPublicBase))
			r.Post("/users/{userID}/grants", admin.CreateGrantHandler(pool))
			r.Delete("/grants/{grantID}", admin.RevokeGrantHandler(pool))
			r.Get("/promo-codes", admin.ListPromoCodesHandler(pool))
			r.Post("/promo-codes", admin.CreatePromoCodeHandler(pool))
			r.Delete("/promo-codes/{codeID}", admin.RevokePromoCodeHandler(pool))
		})

		// Test-only probe: always enforces beta gate regardless of BETA_MODE env.
		// Returns 401 if unauthenticated, 403 if authenticated but not beta,
		// 200 if authenticated + is_beta=true.
		// Namespaced under /_test/ — exposes no real functionality.
		r.With(beta.Gate(config.Config{BetaMode: true}, pool)).Get("/_test/beta/gated", func(w http.ResponseWriter, r *http.Request) {
			if _, err := auth.User(r.Context()); err != nil {
				http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusOK)
		})
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("api starting", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	<-quit

	slog.Info("shutting down")
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		slog.Error("shutdown error", "err", err)
	}
}

// buildMailer wires up SES if configured, otherwise returns NoopMailer for
// local dev. When SES_REQUIRED=true any error in this chain (missing config,
// init failure) is fatal — see SESRequired in config.go for the why.
func buildMailer(ctx context.Context, cfg config.Config) auth.EmailSender {
	if cfg.SESFromEmail == "" || cfg.AWSRegion == "" {
		if cfg.SESRequired {
			slog.Error("SES_REQUIRED=true but SES_FROM_EMAIL or AWS_REGION is missing")
			os.Exit(1)
		}
		slog.Warn("SES not configured — using NoopMailer (password reset emails disabled)")
		return auth.NoopMailer{}
	}
	sender, err := email.NewSender(ctx, cfg.AWSRegion, cfg.SESFromEmail)
	if err != nil {
		if cfg.SESRequired {
			slog.Error("SES init failed and SES_REQUIRED=true", "err", err)
			os.Exit(1)
		}
		slog.Warn("SES init failed — falling back to NoopMailer", "err", err)
		return auth.NoopMailer{}
	}
	return sender
}

// corsMiddleware sets CORS headers only for origins in the allowlist.
// CORS_ALLOWED_ORIGINS must include every production domain; arbitrary origins
// are rejected (no header set) to prevent credential-bearing cross-site requests.
func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[o] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if origin := r.Header.Get("Origin"); origin != "" {
				if _, ok := allowed[origin]; ok {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Access-Control-Allow-Credentials", "true")
					w.Header().Add("Vary", "Origin")
				}
			}
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				w.Header().Set("Access-Control-Max-Age", "86400")
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// warnIfStripeMisconfigured emits a startup warning when Stripe is partially
// configured (some env vars set, others empty). Fully empty is OK for local
// dev; fully populated is OK; mixed means a deploy-time misconfiguration that
// will surface as opaque runtime failures.
func warnIfStripeMisconfigured(cfg config.Config) {
	envs := map[string]string{
		"STRIPE_SECRET_KEY":                   cfg.StripeSecretKey,
		"STRIPE_WEBHOOK_SECRET":               cfg.StripeWebhookSecret,
		"STRIPE_ARTIST_BASIC_ANNUAL_PRICE_ID": cfg.StripeArtistBasicAnnualPrice,
		"STRIPE_ARTIST_BASIC_MONTH_PRICE_ID":  cfg.StripeArtistBasicMonthPrice,
		"STRIPE_ARTIST_PRO_ANNUAL_PRICE_ID":   cfg.StripeArtistProAnnualPrice,
		"STRIPE_ARTIST_PRO_MONTH_PRICE_ID":    cfg.StripeArtistProMonthPrice,
		"STRIPE_ORG_SETUP_PRICE_ID":           cfg.StripeOrgSetupPrice,
		"STRIPE_FESTIVAL_ACTIVATION_PRICE_ID": cfg.StripeFestivalActivationPrice,
		"STRIPE_FESTIVAL_ANNUAL_PRICE_ID":     cfg.StripeFestivalAnnualPrice,
	}
	set, missing := 0, []string{}
	for name, v := range envs {
		if v == "" {
			missing = append(missing, name)
		} else {
			set++
		}
	}
	if set > 0 && len(missing) > 0 {
		slog.Warn("stripe partially configured — billing endpoints may fail at runtime",
			"missing", missing, "set_count", set)
	}
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	switch level {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
}
