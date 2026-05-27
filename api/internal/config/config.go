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
	AWSRegion           string
	SESFromEmail        string
	GoogleClientID      string
	GoogleClientSecret  string
	APIPublicBase       string // public URL of this API (used for OAuth redirect_uri)
	WebPublicBase       string // public URL of the web app (post-OAuth redirect + email links)
	AppleClientID       string
	AppleTeamID         string
	AppleKeyID          string
	ApplePrivateKey     string
	TOTPEncryptionKey   string // base64-encoded 32-byte AES-256-GCM key
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
		AWSRegion:           env("AWS_REGION", "eu-west-2"),
		SESFromEmail:        env("SES_FROM_EMAIL", ""),
		GoogleClientID:      env("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:  env("GOOGLE_CLIENT_SECRET", ""),
		APIPublicBase:       env("API_PUBLIC_BASE", "http://localhost:8080"),
		WebPublicBase:       env("WEB_PUBLIC_BASE", "http://localhost:3000"),
		AppleClientID:       env("APPLE_CLIENT_ID", ""),
		AppleTeamID:         env("APPLE_TEAM_ID", ""),
		AppleKeyID:          env("APPLE_KEY_ID", ""),
		ApplePrivateKey:     env("APPLE_PRIVATE_KEY", ""),
		TOTPEncryptionKey:   env("TOTP_ENCRYPTION_KEY", ""),
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
