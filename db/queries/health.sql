-- name: HealthCheck :one
SELECT applied_at FROM _migrations_health ORDER BY applied_at DESC LIMIT 1;
