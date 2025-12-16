-- migrations/023_case_logs.sql
-- Case logs (historia zmian)

CREATE TABLE IF NOT EXISTS case_logs (
  id BIGSERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  message TEXT,
  meta JSONB,
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_logs_case_id_idx ON case_logs(case_id);
CREATE INDEX IF NOT EXISTS case_logs_user_id_idx ON case_logs(user_id);
CREATE INDEX IF NOT EXISTS case_logs_action_type_idx ON case_logs(action_type);