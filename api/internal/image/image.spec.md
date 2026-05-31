# image Spec
**Path:** `api/internal/image/`
**Last updated:** 2026-05-31

## Contract
- `POST /images/presign` → returns `{ uploadUrl, s3Key }` — presigned MinIO PUT URL valid for 15 minutes; auth required
- `POST /images/confirm` → writes a row to the `images` table with `s3_key`, `cdn_url`, `content_type`; returns the image record; auth required
- `url.go`: `CDNUrl(cdnBase, s3Key)` utility — constructs the public CDN URL from a base and key

## Boundaries
- Does NOT attach images to collections or profiles — that is the `artist` package (`collection_image.go`)
- Does NOT delete images from MinIO — images are retained; the artist package manages collection attachment/detachment

## Key Decisions
- **Two MinIO clients in `main.go`**: `mc` (internal, `minio:9000`) is used by `ConfirmHandler` for bucket operations; `mcPublic` (public-facing, `localhost:9000` in dev / CDN in prod) is used by `PresignHandler` so the presigned URL's Host matches what the browser sends. Mixing these up causes 403s on the S3 PUT.
- **`Region: "us-east-1"` on `mcPublic` is non-negotiable**: without it, `minio-go` calls `GetBucketLocation` before presigning — that network call uses the public endpoint which is unreachable from inside the API container → 500. Setting the region skips the call.
- **15-minute presign TTL**: long enough for a slow upload; short enough to limit exposure if a URL leaks
- **Accepted content types**: `image/jpeg`, `image/png`, `image/gif`, `image/webp` — return 400 for anything else

## Invariants
- `PresignHandler` MUST use `mcPublic` (not `mc`) — the signature must match the Host header the browser will send
- `ConfirmHandler` MUST use `mc` (not `mcPublic`) — bucket operations from inside the container use the internal network endpoint
- The s3 key passed to `ConfirmHandler` MUST be a key that was returned by a prior `PresignHandler` call — no arbitrary key injection

## AI Context
- `presign.go`: `PresignHandler` — uses `mcPublic`; the 403-on-PUT root cause is almost always using `mc` here by mistake
- `confirm.go`: `ConfirmHandler` — uses `mc`; writes the `images` row; returns the CDN URL constructed via `CDNUrl`
- `url.go`: `CDNUrl` utility
- The dual-client pattern and `Region: "us-east-1"` are documented in `.claude/rules/e2e-debugging.md` under "MinIO PUT returns 403"

## Changelog
2026-05-31 — initial spec
