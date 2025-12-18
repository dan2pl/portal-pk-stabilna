BEGIN;

-- 1) Backfill: jeśli są stare dane, przepisz je do nowych kolumn (bezpiecznie)
UPDATE case_emails
SET from_address = from_addr
WHERE from_address IS NULL AND from_addr IS NOT NULL;

UPDATE case_emails
SET to_address = ARRAY[trim(to_addr)]
WHERE (to_address IS NULL OR array_length(to_address, 1) IS NULL)
  AND to_addr IS NOT NULL
  AND trim(to_addr) <> '';

UPDATE case_emails
SET cc_address = regexp_split_to_array(cc_addr, '\s*,\s*')
WHERE (cc_address IS NULL OR array_length(cc_address, 1) IS NULL)
  AND cc_addr IS NOT NULL
  AND trim(cc_addr) <> '';

UPDATE case_emails
SET bcc_address = regexp_split_to_array(bcc_addr, '\s*,\s*')
WHERE (bcc_address IS NULL OR array_length(bcc_address, 1) IS NULL)
  AND bcc_addr IS NOT NULL
  AND trim(bcc_addr) <> '';

UPDATE case_emails
SET sent_by = created_by
WHERE sent_by IS NULL AND created_by IS NOT NULL;

-- 2) Direction: domyślnie "sent"
UPDATE case_emails
SET direction = 'sent'
WHERE direction IS NULL OR trim(direction) = '';

ALTER TABLE case_emails
  ALTER COLUMN direction SET DEFAULT 'sent';

-- 3) Wywal legacy kolumny (to rozwiąże NOT NULL z from_addr / to_addr)
ALTER TABLE case_emails
  DROP COLUMN IF EXISTS from_addr,
  DROP COLUMN IF EXISTS to_addr,
  DROP COLUMN IF EXISTS cc_addr,
  DROP COLUMN IF EXISTS bcc_addr,
  DROP COLUMN IF EXISTS created_by;

COMMIT;