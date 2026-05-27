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
	// CORSAllowedOrigins is the set of origins permitted to make credentialed
	// cross-origin requests. Set CORS_ALLOWED_ORIGINS to a comma-separated list
	// in production (e.g. "https://app.example.com,https://www.example.com").
	CORSAllowedOrigins []string
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
		CORSAllowedOrigins:  envStringSlice("CORS_ALLOWED_ORIGINS", []string{"http://localhost:3000"}),
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
