-- PTExchange bot schema (Neon Postgres)
-- Replaces TBC's Bot.getData/saveData/User.getData key-value store with real tables.

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,               -- Telegram user id
  username TEXT,
  first_name TEXT,
  is_registered BOOLEAN NOT NULL DEFAULT FALSE,
  api_key TEXT,
  last_tx_time DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_tx INTEGER NOT NULL DEFAULT 0,
  total_paid DOUBLE PRECISION NOT NULL DEFAULT 0,
  balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  notify_deposits BOOLEAN NOT NULL DEFAULT TRUE,
  notify_withdrawals BOOLEAN NOT NULL DEFAULT TRUE,
  pin_hash TEXT,                       -- scrypt hash, NULL = no PIN set yet
  pin_salt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migration-safe: adds the new columns if this ran against a DB that already
-- had the old `users` table from before this feature set existed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_deposits BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_withdrawals BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_salt TEXT;

-- One row per (user, chain). chain = 'ton' | 'bsc'
CREATE TABLE IF NOT EXISTS wallets (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain TEXT NOT NULL CHECK (chain IN ('ton', 'bsc')),
  address TEXT NOT NULL,
  address_eq TEXT,                     -- TON only
  raw_address TEXT,                    -- TON only, "workchain:hex" form TonAPI needs for subscriptions/lookups
  version TEXT,                        -- v4 / v5 for TON, 'bsc' for BSC
  path TEXT,
  encrypted_mnemonic TEXT,             -- AES-256-GCM ciphertext (iv:tag:data), replaces the old obfuscate()
  encrypted_private_key TEXT,
  import_type TEXT,                    -- 'generated' | 'mnemonic' | 'privkey'
  backup_confirmed BOOLEAN NOT NULL DEFAULT FALSE, -- did the user re-enter words to confirm they saved it
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chain)
);

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS backup_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS raw_address TEXT;

-- Fast lookup from an incoming TonAPI webhook (which gives us the raw
-- account_id) back to which user it belongs to.
CREATE INDEX IF NOT EXISTS idx_wallets_raw_address ON wallets (raw_address) WHERE raw_address IS NOT NULL;

-- Generic small-value config store, replaces global Bot.getData("fee_percent") etc.
CREATE TABLE IF NOT EXISTS bot_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Short-lived per-user conversational state: pending wallet version, pending imports,
-- "next command" flow state, cached paginated lists. Replaces Bot.handleNextCommand
-- and the various *_pending_{u} keys. Rows are cleaned up on use or by expiry.
CREATE TABLE IF NOT EXISTS sessions (
  user_id BIGINT NOT NULL,
  key TEXT NOT NULL,
  value JSONB,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- Supports ORDER BY created_at in /users pagination and the deposit monitor's
-- user list. Table is small today (135 rows, sequential scan is fine either
-- way) but this keeps pagination sub-millisecond as it grows instead of
-- degrading silently.
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at);

-- Deposit monitor's WHERE api_key IS NOT NULL - lets Postgres skip
-- unregistered rows entirely instead of scanning the whole table every 60s.
CREATE INDEX IF NOT EXISTS idx_users_api_key ON users (api_key) WHERE api_key IS NOT NULL;

-- Seed default config values
INSERT INTO bot_config (key, value) VALUES
  ('fee_percent', '"0"'),
  ('fee_address', '"Not set"'),
  ('maintenance', '"off"')
ON CONFLICT (key) DO NOTHING;
