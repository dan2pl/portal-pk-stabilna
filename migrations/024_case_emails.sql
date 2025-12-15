-- 024_case_emails.sql

CREATE TABLE case_emails (
  id            BIGSERIAL PRIMARY KEY,
  case_id       INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,

  direction     TEXT NOT NULL DEFAULT 'sent', -- 'sent' / 'received' (na przyszłość)
  from_address  TEXT NOT NULL,
  to_address    TEXT[] NOT NULL,
  cc_address    TEXT[],
  bcc_address   TEXT[],

  subject       TEXT NOT NULL,
  body_text     TEXT,
  body_html     TEXT,

  attachments   JSONB,           -- [{filename, mime_type, size, stored_name}, ...]
  status        TEXT NOT NULL DEFAULT 'queued',  -- 'queued' | 'sent' | 'failed' | 'skipped'
  error_message TEXT,

  sent_by       INTEGER REFERENCES users(id),
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX case_emails_case_id_idx ON case_emails(case_id);
CREATE INDEX case_emails_sent_by_idx ON case_emails(sent_by);