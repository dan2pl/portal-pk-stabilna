ALTER TABLE case_files
  ADD COLUMN IF NOT EXISTS doc_key text;

CREATE INDEX IF NOT EXISTS idx_case_files_case_id_doc_key
  ON case_files(case_id, doc_key);