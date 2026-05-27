package image

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
)

type presignRequest struct {
	ContentType string `json:"contentType"`
}

type presignResponse struct {
	UploadURL string `json:"uploadUrl"`
	S3Key     string `json:"s3Key"`
}

var contentTypeExts = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

// PresignHandler handles POST /images/presign.
// Requires auth. Returns a presigned MinIO PUT URL valid for 15 minutes and the s3Key to pass to /images/confirm.
// mc must be initialised with the publicly-reachable endpoint so the URL signature matches the Host header
// the browser will send (e.g. localhost:9000 in dev rather than the internal minio:9000 hostname).
func PresignHandler(mc *minio.Client, bucket string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := auth.User(r.Context()); err != nil {
			httperr.Unauthorized(w)
			return
		}

		var req presignRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		ext, ok := contentTypeExts[req.ContentType]
		if !ok {
			httperr.UnprocessableEntity(w, "unsupported content type; accepted: image/jpeg, image/png, image/gif, image/webp")
			return
		}

		s3Key := uuid.New().String() + ext

		presignedURL, err := mc.PresignedPutObject(r.Context(), bucket, s3Key, 15*time.Minute)
		if err != nil {
			slog.Error("presign failed", "err", err, "bucket", bucket, "key", s3Key)
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(presignResponse{
			UploadURL: presignedURL.String(),
			S3Key:     s3Key,
		})
	}
}
