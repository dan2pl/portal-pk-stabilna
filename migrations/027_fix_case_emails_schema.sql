-- direction
ALTER TABLE case_emails
ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'sent';

-- adresy
ALTER TABLE case_emails
ADD COLUMN IF NOT EXISTS from_address TEXT;

ALTER TABLE case_emails
ADD COLUMN IF NOT EXISTS to_address TEXT[];

ALTER TABLE case_emails
ADD COLUMN IF NOT EXISTS cc_address TEXT[];

ALTER TABLE case_emails
ADD COLUMN IF NOT EXISTS bcc_address TEXT[];

-- user
ALTER TABLE case_emails
ADD COLUMN IF NOT EXISTS sent_by INTEGER REFERENCES users(id);

-- Uzupełnienie NOT NULL tam, gdzie trzeba
UPDATE case_emails
SET from_address = 'Portal PK <portal@pokonajkredyt.pl>'
WHERE from_address IS NULL;

UPDATE case_emails
SET to_address = ARRAY['unknown@example.com']
WHERE to_address IS NULL;

ALTER TABLE case_emails
ALTER COLUMN from_address SET NOT NULL;

ALTER TABLE case_emails
ALTER COLUMN to_address SET NOT NULL;