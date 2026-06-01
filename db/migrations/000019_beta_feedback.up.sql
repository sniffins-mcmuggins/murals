CREATE TABLE beta_feedback (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       varchar(20)  NOT NULL CHECK (kind IN ('idea', 'bug', 'direction', 'praise')),
  body       text         NOT NULL,
  admin_note text,
  created_at timestamptz  NOT NULL DEFAULT now()
);
