CREATE TABLE notifications (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    case_id      INTEGER REFERENCES cases(id) ON DELETE CASCADE,
    type         VARCHAR(100) NOT NULL,
    title        VARCHAR(200) NOT NULL,
    body         TEXT NOT NULL,
    meta         JSONB DEFAULT '{}'::jsonb NOT NULL,
    is_read      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    read_at      TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_notifications_user_id_created_at
    ON notifications (user_id, created_at DESC);

CREATE INDEX idx_notifications_user_id_is_read
    ON notifications (user_id, is_read);