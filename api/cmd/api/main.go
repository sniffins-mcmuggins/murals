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

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/config"
	"github.com/sniffins-mcmuggins/render/api/internal/db"
	"github.com/sniffins-mcmuggins/render/api/internal/health"
	"github.com/sniffins-mcmuggins/render/api/internal/image"
	"github.com/sniffins-mcmuggins/render/api/internal/metrics"
	"github.com/sniffins-mcmuggins/render/api/internal/middleware"
)

func main() {
	cfg := config.Load()

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

	r := chi.NewRouter()
	r.Use(chiMiddleware.RealIP)
	r.Use(middleware.Logger(logger))
	r.Use(middleware.Recover)
	r.Use(metrics.Middleware())
	r.Use(auth.Middleware(cfg.JWTSecret))

	r.Get("/healthz", health.Handler(pool))
	r.Handle("/metrics", metrics.Handler())
	r.Post("/auth/signup", auth.SignupHandler(pool))
	r.Post("/auth/login", auth.LoginHandler(pool, cfg.JWTSecret))
	r.Get("/me", auth.MeHandler(pool))
	r.Post("/images/presign", image.PresignHandler(mc, cfg.MinioBucket))
	r.Post("/images/confirm", image.ConfirmHandler(mc, cfg.MinioBucket, cfg.CDNBaseURL))

	// Artist profiles
	r.Post("/profiles", artist.CreateProfileHandler(pool))
	r.Get("/profiles/me", artist.GetMyProfileHandler(pool))
	r.Patch("/profiles/me", artist.UpdateProfileHandler(pool))
	r.Get("/profiles/{profileID}", artist.GetProfileHandler(pool))
	r.Get("/profiles/{profileID}/collections", artist.ListCollectionsHandler(pool))

	// Collections
	r.Post("/collections", artist.CreateCollectionHandler(pool))
	r.Get("/collections/{collectionID}", artist.GetCollectionHandler(pool))
	r.Patch("/collections/{collectionID}", artist.UpdateCollectionHandler(pool))
	r.Delete("/collections/{collectionID}", artist.DeleteCollectionHandler(pool))
	r.Post("/collections/{collectionID}/images", artist.AttachImageHandler(pool))
	r.Put("/collections/{collectionID}/images/order", artist.ReorderImagesHandler(pool))
	r.Delete("/collections/{collectionID}/images/{imageID}", artist.DeleteImageHandler(pool))

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
