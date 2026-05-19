package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port           string
	DatabaseURL    string
	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	MinioBucket    string
	MinioUseSSL    bool
	CDNBaseURL     string
	JWTSecret      string
	LogLevel       string
}

func Load() Config {
	return Config{
		Port:           env("PORT", "8080"),
		DatabaseURL:    env("DATABASE_URL", "postgres://render:render@localhost:5432/render?sslmode=disable"),
		MinioEndpoint:  env("MINIO_ENDPOINT", "localhost:9000"),
		MinioAccessKey: env("MINIO_ACCESS_KEY", "renderdev"),
		MinioSecretKey: env("MINIO_SECRET_KEY", "renderdev123"),
		MinioBucket:    env("MINIO_BUCKET", "render-images"),
		MinioUseSSL:    envBool("MINIO_USE_SSL", false),
		CDNBaseURL:     env("CDN_BASE_URL", "http://localhost:9000/render-images"),
		JWTSecret:      env("JWT_SECRET", "dev-jwt-secret-change-in-prod"),
		LogLevel:       env("LOG_LEVEL", "info"),
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
