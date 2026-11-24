-- Store infrastructure-provider API credentials as authenticated ciphertext. Secret values are
-- write-only through the Super Admin API; readers can retrieve names/presence without decrypting.
CREATE TABLE IF NOT EXISTS infrastructure_provider_credentials (
  provider_id uuid PRIMARY KEY REFERENCES infrastructure_providers(id) ON DELETE CASCADE,
  encrypted_credentials text NOT NULL,
  credential_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NULL,
  CONSTRAINT infrastructure_provider_credentials_names_array_check
    CHECK (jsonb_typeof(credential_names) = 'array')
);

COMMENT ON TABLE infrastructure_provider_credentials IS
  'AES-256-GCM encrypted infrastructure API credentials. Never return encrypted or decrypted values to clients.';
