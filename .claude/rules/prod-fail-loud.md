# Production must fail loud, never silent

When wiring an external-service client (SES, S3, payment, push, OAuth provider) in `api/cmd/api/main.go` or adding config in `api/internal/config/config.go`, load: @api/cmd/api/main.go @api/internal/config/config.go

This rule exists because the *worst* class of prod bug is one that looks like nothing happened.

## The pattern to avoid

```go
// BAD — silently degrades in production
var mailer auth.EmailSender
sender, err := email.NewSender(ctx, cfg.AWSRegion, cfg.SESFromEmail)
if err != nil {
    slog.Warn("SES init failed, using NoopMailer", "err", err)
    mailer = auth.NoopMailer{}
} else {
    mailer = sender
}
```

In prod, this means: SES creds rotate → `mailer.Send` returns nil → password reset emails disappear → users lock themselves out. There is no signal that anything is wrong until a user opens a support ticket two weeks later.

## The pattern to use

Every external-service client must support an `XXX_REQUIRED` config flag. When true, init failure exits with a non-zero status before the HTTP server starts listening — health checks fail, deploys roll back, on-call sees the alert immediately.

```go
// GOOD — see buildMailer in api/cmd/api/main.go for the canonical version
if cfg.SESRequired {
    if cfg.SESFromEmail == "" || cfg.AWSRegion == "" {
        slog.Error("SES_REQUIRED=true but SES_FROM_EMAIL or AWS_REGION is missing")
        os.Exit(1)
    }
    sender, err := email.NewSender(ctx, cfg.AWSRegion, cfg.SESFromEmail)
    if err != nil {
        slog.Error("SES init failed and SES_REQUIRED=true", "err", err)
        os.Exit(1)
    }
    return sender
}
// Non-required path may fall back to a Noop, but must WARN.
```

Production config sets `SES_REQUIRED=true`. Local dev leaves it unset and falls back to a Noop implementation — the WARN log makes the fallback visible.

## Checklist when adding a new external service

- [ ] Config struct gains `XXXRequired bool`, default `false`.
- [ ] `main.go` (or a `buildXxx` helper) reads `XXXRequired` and `os.Exit(1)` on init failure when true.
- [ ] Non-required path logs `slog.Warn` mentioning *both* the fallback being used AND the user-visible consequence ("password reset emails disabled", "image uploads will fail", etc.).
- [ ] The README / deploy docs add `XXX_REQUIRED=true` to the production env-var list for that service.
- [ ] If the service has a noop fallback, document the failure mode here in this rule.

## Known failure modes (extend as you go)

- **SES → NoopMailer**: password reset emails are silently dropped. Users who lose their password have no recovery path. → `SES_REQUIRED=true` in prod.
- (Add the next one here when you wire it up.)

## When in doubt: prefer the boot-time error to the runtime mystery

A failed deploy is recoverable in minutes — you fix the env var and ship again. A silently-degraded prod is recoverable in weeks, after enough users complain.
