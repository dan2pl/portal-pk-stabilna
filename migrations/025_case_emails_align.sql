-- migrations/025_case_emails_align.sql
BEGIN;

-- 1) direction
ALTER TABLE case_emails
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'sent';

-- 2) Nowe kolumny docelowe (jeśli ich nie ma)
ALTER TABLE case_emails
  ADD COLUMN IF NOT EXISTS from_address text,
  ADD COLUMN IF NOT EXISTS to_address text[],
  ADD COLUMN IF NOT EXISTS cc_address text[],
  ADD COLUMN IF NOT EXISTS bcc_address text[],
  ADD COLUMN IF NOT EXISTS sent_by integer;

-- 3) Przenieś dane ze starych pól do nowych
UPDATE case_emails
SET
  from_address = COALESCE(from_address, from_addr),
  to_address   = COALESCE(to_address, ARRAY[ to_addr ]),
  cc_address   = COALESCE(cc_address, CASE WHEN cc_addr IS NULL OR cc_addr = '' THEN NULL ELSE ARRAY[cc_addr] END),
  bcc_address  = COALESCE(bcc_address, CASE WHEN bcc_addr IS NULL OR bcc_addr = '' THEN NULL ELSE ARRAY[bcc_addr] END),
  sent_by      = COALESCE(sent_by, created_by);

-- 4) Ustaw NOT NULL tam, gdzie tego oczekuje nowy schemat (minimalnie)
ALTER TABLE case_emails
  ALTER COLUMN from_address SET NOT NULL,
  ALTER COLUMN to_address SET NOT NULL;

COMMIT;