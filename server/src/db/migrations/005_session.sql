-- Login sessions. The id is a keyed hash (HMAC with a key derived from the app password) of a random
-- token, so the table holds nothing that can be turned back into a working cookie or into the password,
-- and changing the password makes every existing session unusable.

CREATE TABLE session (
  id           TEXT PRIMARY KEY,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX idx_session_last_seen ON session (last_seen_at);
