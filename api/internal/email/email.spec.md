# email Spec
**Path:** `api/internal/email/`
**Last updated:** 2026-05-31

## Contract
- `email.NewSender(ctx, region, fromAddr) (*Sender, error)` — initialises an SES v2 client
- `(*Sender).Send(ctx, to, subject, bodyHTML string) error` — sends a single transactional email via AWS SES v2
- Implements the `auth.EmailSender` interface (defined in `api/internal/auth/ctx.go`)

## Boundaries
- Does NOT template emails — callers (auth handlers) construct the HTML body
- Does NOT queue or batch — every call is a synchronous single send
- Does NOT have a fallback or retry — callers wrap in a goroutine with timeout if fire-and-forget is needed

## Key Decisions
- **SES v2 not v1**: `sesv2` SDK; `v1` is end-of-life
- **`SES_REQUIRED=true` in production**: if `NewSender` fails and `SES_REQUIRED` is false, `main.go` falls back to `auth.NoopMailer{}` with a WARN log. In prod, `SES_REQUIRED=true` causes `os.Exit(1)` on init failure — see prod-fail-loud rule
- **HTML-only**: all emails are HTML; no plain-text fallback currently

## Invariants
- `NewSender` authenticates via the AWS default credential chain — the caller must ensure `AWS_REGION` and credentials are set before calling
- `Send` logs `slog.Error` on failure but returns the error — callers decide whether to surface it

## AI Context
- `ses.go`: the entire package is one file — `Sender` struct, `NewSender`, `Send`
- `auth.NoopMailer{}` is defined in `api/internal/auth/ctx.go` — used in local dev when `SES_REQUIRED` is false
- See `api/cmd/api/main.go` `buildMailer` function for the `SES_REQUIRED` guard pattern

## Changelog
2026-05-31 — initial spec
