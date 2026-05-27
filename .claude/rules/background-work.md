# Background work (`go func()` outside tests)

When adding a detached goroutine in `api/` outside test files, load: @api/internal/auth/reset.go (canonical example: `forgotPasswordWork`)

This rule is about goroutines launched *from* an HTTP handler that outlive the request — typically because we don't want to make the user wait for SES, S3 writes, analytics, etc.

## The three things every detached goroutine must do

### 1. Bounded context — never `context.Background()` alone

```go
// BAD
go func() {
    ctx := context.Background()
    mailer.Send(ctx, ...) // hangs forever if SES is wedged
}()

// GOOD
go func() {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    mailer.Send(ctx, ...)
}()
```

A bare `context.Background()` lets the goroutine outlive `srv.Shutdown` and leaves work in progress when the binary exits. With a timeout the worst case is bounded: we abandon work at most 30s after the deadline, and if SES hangs we get a logged timeout instead of a leak.

Pick the timeout based on what the goroutine actually does. DB + one HTTP call → 30s. Just a DB write → 5s. A batch job → minutes. Don't default to 30s blindly.

### 2. Log errors at the right level — never `_ = err`

```go
// BAD
_, _ = q.CreatePasswordResetToken(ctx, ...) // failures vanish

// GOOD
if _, err := q.CreatePasswordResetToken(ctx, ...); err != nil {
    slog.Error("forgot-password: create token failed", "err", err)
    return
}
```

Distinguish *normal misses* from *infrastructure failures*:

| What happened | Level |
|---|---|
| `pgx.ErrNoRows` looking up a user by email (account doesn't exist) | `Debug` or skip |
| `pgx.ErrNoRows` looking up something that *must* exist | `Error` |
| Network / 5xx from external service | `Error` |
| Validation / 4xx from external service caused by user input | `Warn` |
| Context deadline exceeded | `Error` (something is slower than expected) |

The pattern: a normal cold path is silent, but anything that could indicate broken infrastructure is loud.

### 3. Don't capture the request context

```go
// BAD
http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusAccepted)
    go doWork(r.Context()) // r.Context() is cancelled when the response writes
})

// GOOD
http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusAccepted)
    go doWork() // doWork builds its own bounded ctx from context.Background()
})
```

`r.Context()` is tied to the request's lifecycle. Once `WriteHeader` returns and the response is flushed, the context can be cancelled — your goroutine then sees `context.Canceled` mid-query.

If the goroutine genuinely needs request-scoped values (trace ID, user ID), copy them out into typed variables *before* the `go func()` call.

## When to *not* detach

Detached goroutines hide failures from users. Use them only when:

- The user genuinely doesn't need to wait (sending an email, kicking off an analytics event).
- The handler must return quickly for a security reason (timing-attack mitigation in `/auth/forgot-password`).

If the user *should* know whether the work succeeded (saving form input, uploading a file), do the work synchronously and return a proper status.

## Pre-merge checklist

- [ ] `go func()` body uses `context.WithTimeout(context.Background(), …)` with a deliberate duration, not a copy-paste 30s.
- [ ] `defer cancel()` immediately after the timeout context, no early returns before it.
- [ ] All errors logged with `slog`, with the right level per the table above.
- [ ] Request context is NOT captured into the goroutine.
- [ ] If sensitive: the level / message doesn't leak whether a record exists.
