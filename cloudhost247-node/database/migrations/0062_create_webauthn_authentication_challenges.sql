CREATE TABLE IF NOT EXISTS webauthn_authentication_challenges (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,challenge_hash char(64) NOT NULL UNIQUE,session_version integer NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webauthn_authentication_challenges_active_idx ON webauthn_authentication_challenges(id,expires_at) WHERE used_at IS NULL;
