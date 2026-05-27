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
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
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

	r := chi.NewRouter()
	r.Use(corsMiddleware)
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
	r.Post("/images/presign", image.PresignHandler(mcPublic, cfg.MinioBucket))
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
	r.Get("/collections/{collectionID}/images", artist.ListCollectionImagesHandler(pool))
	r.Post("/collections/{collectionID}/images", artist.AttachImageHandler(pool))
	r.Put("/collections/{collectionID}/images/order", artist.ReorderImagesHandler(pool))
	r.Delete("/collections/{collectionID}/images/{imageID}", artist.DeleteImageHandler(pool))

	// Festivals
	r.Post("/festivals", festival.CreateHandler(pool))
	r.Get("/festivals", festival.ListHandler(pool))
	r.Get("/festivals/slug/{slug}/map", festival.GetMapDataHandler(pool))
	r.Get("/public/festivals", festival.ListPublicHandler(pool))
	r.Get("/public/profiles", artist.ListPublicProfilesHandler(pool))
	r.Get("/festivals/{festivalID}", festival.GetHandler(pool))
	r.Patch("/festivals/{festivalID}", festival.UpdateHandler(pool))
	r.Delete("/festivals/{festivalID}", festival.DeleteHandler(pool))

	// Application forms
	r.Put("/festivals/{festivalID}/form", festival.UpsertFormHandler(pool))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(pool))

	// Applications
	r.Get("/me/applications", festival.GetMyApplicationsHandler(pool))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(pool))

	// Review
	r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(pool))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/accept", festival.AcceptApplicationHandler(pool))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/decline", festival.DeclineApplicationHandler(pool))

	// Map editor
	r.Get("/festivals/{festivalID}/artists/accepted", festival.GetAcceptedArtistsHandler(pool))
	r.Patch("/festivals/{festivalID}/artists/{artistID}/pin", festival.SetArtistPinHandler(pool))

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

// corsMiddleware reflects the Origin header with credentials support.
// Required for browser-to-API requests when web and API run on different ports.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
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
