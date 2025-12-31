-- 028_cases_docs_status.sql
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS docs_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS docs_notes  jsonb NOT NULL DEFAULT '{}'::jsonb;

-- (opcjonalnie) indeks pod zapytania po jsonb – na później, na razie pomiń
-- CREATE INDEX IF NOT EXISTS cases_docs_status_gin ON cases USING GIN (docs_status);