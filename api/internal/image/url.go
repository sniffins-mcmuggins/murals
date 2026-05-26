package image

import "strings"

// PublicURL constructs the public CDN URL for an uploaded object.
// cdnBase is CDN_BASE_URL ("http://localhost:9000/render-images" in dev).
// Phase 2: swap CDN_BASE_URL to the CloudFront distribution URL — no code change needed.
func PublicURL(cdnBase, s3Key string) string {
	return strings.TrimRight(cdnBase, "/") + "/" + s3Key
}
