package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port                string
	DatabaseURL         string
	MinioEndpoint       string
	MinioPublicEndpoint string
	MinioAccessKey      string
	MinioSecretKey      string
	MinioBucket         string
	MinioUseSSL         bool
	CDNBaseURL          string
	JWTSecret           string
	LogLevel            string
	AWSRegion           string
	SESFromEmail        string
	// SESRequired makes a missing/broken SES configuration a fatal startup
	// error. Set in production so we never silently fall back to NoopMailer
	// and lock users out of password reset.
	SESRequired bool
	// SMTP sender — used for local dev (Mailpit). When SMTPHost is set,
	// buildMailer uses SMTPSender instead of SES so no AWS credentials are needed.
	SMTPHost           string
	SMTPPort           string
	SMTPFrom           string
	GoogleClientID     string
	GoogleClientSecret string
	APIPublicBase      string // public URL of this API (used for OAuth redirect_uri)
	WebPublicBase      string // public URL of the web app (post-OAuth redirect + email links)
	AppleClientID      string
	AppleTeamID        string
	AppleKeyID         string
	ApplePrivateKey    string
	TOTPEncryptionKey  string // base64-encoded 32-byte AES-256-GCM key
	// LoginRateLimitPerMin / LoginRateLimitBurst control the per-IP token
	// bucket on /auth/login, /auth/forgot-password, /auth/reset-password, and
	// /auth/mfa/verify. Defaults are tight enough for prod (5/min) but
	// docker-compose / CI override them — every e2e worker shares the same
	// source IP, so the prod ceiling exhausts in seconds under parallel runs.
	LoginRateLimitPerMin int
	LoginRateLimitBurst  int
	// CORSAllowedOrigins is the set of origins permitted to make credentialed
	// cross-origin requests. Set CORS_ALLOWED_ORIGINS to a comma-separated list
	// in production (e.g. "https://app.example.com,https://www.example.com").
	CORSAllowedOrigins []string
	// Stripe billing
	StripeSecretKey               string
	StripeWebhookSecret           string
	StripeArtistBasicAnnualPrice  string
	StripeArtistBasicMonthPrice   string
	StripeArtistProAnnualPrice    string
	StripeArtistProMonthPrice     string
	StripeOrgSetupPrice           string
	StripeFestivalActivationPrice string // £99 one-off per festival
	StripeFestivalAnnualPrice     string // £49/yr recurring listing fee
	// Frontend base URL (for Stripe redirect URLs)
	SiteBase string
	// BetaMode gates the platform behind invite-only access when true.
	// Set BETA_MODE=true in production to enable beta. Setting it to false
	// (the default) is a no-op passthrough — zero code rip-out at launch.
	BetaMode bool
}

func Load() Config {
	minioEndpoint := env("MINIO_ENDPOINT", "localhost:9000")
	return Config{
		Port:                          env("PORT", "8080"),
		DatabaseURL:                   env("DATABASE_URL", "postgres://render:render@localhost:5432/render?sslmode=disable"),
		MinioEndpoint:                 minioEndpoint,
		MinioPublicEndpoint:           env("MINIO_PUBLIC_ENDPOINT", minioEndpoint),
		MinioAccessKey:                env("MINIO_ACCESS_KEY", "renderdev"),
		MinioSecretKey:                env("MINIO_SECRET_KEY", "renderdev123"),
		MinioBucket:                   env("MINIO_BUCKET", "render-images"),
		MinioUseSSL:                   envBool("MINIO_USE_SSL", false),
		CDNBaseURL:                    env("CDN_BASE_URL", "http://localhost:9000/render-images"),
		JWTSecret:                     env("JWT_SECRET", "dev-jwt-secret-change-in-prod"),
		LogLevel:                      env("LOG_LEVEL", "info"),
		AWSRegion:                     env("AWS_REGION", "eu-west-2"),
		SESFromEmail:                  env("SES_FROM_EMAIL", ""),
		SESRequired:                   envBool("SES_REQUIRED", false),
		SMTPHost:                      env("SMTP_HOST", ""),
		SMTPPort:                      env("SMTP_PORT", "1025"),
		SMTPFrom:                      env("SMTP_FROM", "noreply@painttrace.art"),
		GoogleClientID:                env("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:            env("GOOGLE_CLIENT_SECRET", ""),
		APIPublicBase:                 env("API_PUBLIC_BASE", "http://localhost:8080"),
		WebPublicBase:                 env("WEB_PUBLIC_BASE", "http://localhost:3000"),
		AppleClientID:                 env("APPLE_CLIENT_ID", ""),
		AppleTeamID:                   env("APPLE_TEAM_ID", ""),
		AppleKeyID:                    env("APPLE_KEY_ID", ""),
		ApplePrivateKey:               env("APPLE_PRIVATE_KEY", ""),
		TOTPEncryptionKey:             env("TOTP_ENCRYPTION_KEY", ""),
		LoginRateLimitPerMin:          envInt("LOGIN_RATE_LIMIT_PER_MIN", 5),
		LoginRateLimitBurst:           envInt("LOGIN_RATE_LIMIT_BURST", 5),
		CORSAllowedOrigins:            envStringSlice("CORS_ALLOWED_ORIGINS", []string{"http://localhost:3000"}),
		StripeSecretKey:               env("STRIPE_SECRET_KEY", ""),
		StripeWebhookSecret:           env("STRIPE_WEBHOOK_SECRET", ""),
		StripeArtistBasicAnnualPrice:  env("STRIPE_ARTIST_BASIC_ANNUAL_PRICE_ID", ""),
		StripeArtistBasicMonthPrice:   env("STRIPE_ARTIST_BASIC_MONTH_PRICE_ID", ""),
		StripeArtistProAnnualPrice:    env("STRIPE_ARTIST_PRO_ANNUAL_PRICE_ID", ""),
		StripeArtistProMonthPrice:     env("STRIPE_ARTIST_PRO_MONTH_PRICE_ID", ""),
		StripeOrgSetupPrice:           env("STRIPE_ORG_SETUP_PRICE_ID", ""),
		StripeFestivalActivationPrice: env("STRIPE_FESTIVAL_ACTIVATION_PRICE_ID", ""),
		StripeFestivalAnnualPrice:     env("STRIPE_FESTIVAL_ANNUAL_PRICE_ID", ""),
		SiteBase:                      env("SITE_BASE_URL", "http://localhost:3000"),
		BetaMode:                      envBool("BETA_MODE", false),
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func envBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}

func envStringSlice(key string, fallback []string) []string {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			out = append(out, s)
		}
	}
	return out
}
