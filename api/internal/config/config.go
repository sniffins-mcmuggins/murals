package config

import (
	"os"
	"strconv"
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
	// Stripe billing
	StripeSecretKey              string
	StripeWebhookSecret          string
	StripeArtistBasicAnnualPrice string
	StripeArtistBasicMonthPrice  string
	StripeArtistProAnnualPrice   string
	StripeArtistProMonthPrice    string
	StripeOrgSetupPrice          string
	StripeFestivalMonthPrice     string
	StripeFestivalAnnualPrice    string
	// Frontend base URL (for Stripe redirect URLs)
	SiteBase                     string
}

func Load() Config {
	minioEndpoint := env("MINIO_ENDPOINT", "localhost:9000")
	return Config{
		Port:                env("PORT", "8080"),
		DatabaseURL:         env("DATABASE_URL", "postgres://render:render@localhost:5432/render?sslmode=disable"),
		MinioEndpoint:       minioEndpoint,
		MinioPublicEndpoint: env("MINIO_PUBLIC_ENDPOINT", minioEndpoint),
		MinioAccessKey:      env("MINIO_ACCESS_KEY", "renderdev"),
		MinioSecretKey:      env("MINIO_SECRET_KEY", "renderdev123"),
		MinioBucket:         env("MINIO_BUCKET", "render-images"),
		MinioUseSSL:         envBool("MINIO_USE_SSL", false),
		CDNBaseURL:          env("CDN_BASE_URL", "http://localhost:9000/render-images"),
		JWTSecret:           env("JWT_SECRET", "dev-jwt-secret-change-in-prod"),
		LogLevel:            env("LOG_LEVEL", "info"),
		StripeSecretKey:              env("STRIPE_SECRET_KEY", ""),
		StripeWebhookSecret:          env("STRIPE_WEBHOOK_SECRET", ""),
		StripeArtistBasicAnnualPrice: env("STRIPE_ARTIST_BASIC_ANNUAL_PRICE_ID", ""),
		StripeArtistBasicMonthPrice:  env("STRIPE_ARTIST_BASIC_MONTH_PRICE_ID", ""),
		StripeArtistProAnnualPrice:   env("STRIPE_ARTIST_PRO_ANNUAL_PRICE_ID", ""),
		StripeArtistProMonthPrice:    env("STRIPE_ARTIST_PRO_MONTH_PRICE_ID", ""),
		StripeOrgSetupPrice:          env("STRIPE_ORG_SETUP_PRICE_ID", ""),
		StripeFestivalMonthPrice:     env("STRIPE_FESTIVAL_MONTH_PRICE_ID", ""),
		StripeFestivalAnnualPrice:    env("STRIPE_FESTIVAL_ANNUAL_PRICE_ID", ""),
		SiteBase:                     env("SITE_BASE_URL", "http://localhost:3000"),
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
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
