package image

import (
	"encoding/json"
	"net/http"

	"github.com/minio/minio-go/v7"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
)

type confirmRequest struct {
	S3Key        string `json:"s3Key"`
	ResourceType string `json:"resourceType"`
	ResourceID   string `json:"resourceId"`
}

type confirmResponse struct {
	CDNURL string `json:"cdnUrl"`
}

// ConfirmHandler handles POST /images/confirm.
// Requires auth. Verifies the object exists in MinIO and returns its CDN URL.
// Resource association (collection_images etc.) is done in E5, not here.
func ConfirmHandler(mc *minio.Client, bucket, cdnBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := auth.User(r.Context()); err != nil {
			httperr.Unauthorized(w)
			return
		}

		var req confirmRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		if req.S3Key == "" {
			httperr.UnprocessableEntity(w, "s3Key is required")
			return
		}

		if _, err := mc.StatObject(r.Context(), bucket, req.S3Key, minio.StatObjectOptions{}); err != nil {
			errResp := minio.ToErrorResponse(err)
			switch errResp.Code {
			case "NoSuchKey", "NoSuchBucket":
				httperr.NotFound(w)
			default:
				httperr.InternalServerError(w)
			}
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(confirmResponse{
			CDNURL: PublicURL(cdnBase, req.S3Key),
		})
	}
}
