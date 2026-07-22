const pool = require('./pool');

// ── Users ──────────────────────────────────────────────

async function upsertUser(id, { username, firstName } = {}) {
  await pool.query(
    `INSERT INTO users (id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       username = COALESCE(EXCLUDED.username, users.username),
       first_name = COALESCE(EXCLUDED.first_name, users.first_name)`,
    [id, username || '', firstName || '']
  );
}

async function getUser(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getApiKey(id) {
  const user = await getUser(id);
  return user ? user.api_key : null;
}

// Combines what dashboard/ton/bsc/settings/apiKey all needed as 3 separate
// queries (getUser + getWallet('ton') + getWallet('bsc')) into one round trip
// via a LEFT JOIN. Cuts DB latency for those screens from ~3x to ~1x per view.
async function getUserWithWallets(id) {
  const { rows } = await pool.query(
    `SELECT
       u.*,
       tw.address AS ton_address, tw.address_eq AS ton_address_eq, tw.version AS ton_version,
       tw.encrypted_mnemonic AS ton_encrypted_mnemonic, tw.import_type AS ton_import_type,
       bw.address AS bsc_address, bw.path AS bsc_path,
       bw.encrypted_mnemonic AS bsc_encrypted_mnemonic, bw.encrypted_private_key AS bsc_encrypted_private_key,
       bw.import_type AS bsc_import_type
     FROM users u
     LEFT JOIN wallets tw ON tw.user_id = u.id AND tw.chain = 'ton'
     LEFT JOIN wallets bw ON bw.user_id = u.id AND bw.chain = 'bsc'
     WHERE u.id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;

  return {
    user: row,
    tonWallet: row.ton_address ? {
      address: row.ton_address, address_eq: row.ton_address_eq, version: row.ton_version,
      encrypted_mnemonic: row.ton_encrypted_mnemonic, import_type: row.ton_import_type,
    } : null,
    bscWallet: row.bsc_address ? {
      address: row.bsc_address, path: row.bsc_path,
      encrypted_mnemonic: row.bsc_encrypted_mnemonic, encrypted_private_key: row.bsc_encrypted_private_key,
      import_type: row.bsc_import_type,
    } : null,
  };
}

async function setApiKey(id, apiKey) {
  await pool.query(
    `UPDATE users SET api_key = $2, is_registered = TRUE WHERE id = $1`,
    [id, apiKey]
  );
}

async function getAllUserIds() {
  const { rows } = await pool.query('SELECT id FROM users ORDER BY created_at ASC');
  return rows.map((r) => r.id);
}

// One query for everything the deposit monitor needs per user, instead of
// getApiKey(uid) + getUser(uid) - which were two separate SELECT * FROM users
// WHERE id=$1 queries for the SAME row, run back-to-back, once per user,
// every 60 seconds.
async function getUsersForDepositCheck() {
  const { rows } = await pool.query(
    `SELECT id, api_key, last_tx_time FROM users WHERE api_key IS NOT NULL`
  );
  return rows;
}

async function countUsers() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  return rows[0].count;
}

// Paginated user list for /admin's /users view - queried live instead of the
// TPY version's users_list_cache blob (which went stale/expired between pages).
async function getUsersPage(offset, limit) {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.first_name,
            EXISTS(SELECT 1 FROM wallets w WHERE w.user_id = u.id AND w.chain = 'ton') AS has_wallet
     FROM users u
     ORDER BY u.created_at ASC
     OFFSET $1 LIMIT $2`,
    [offset, limit]
  );
  return rows;
}

// Combines countUsers() + getUsersPage() into one round trip via a window
// function, instead of 2 separate queries every time an admin flips a page.
async function getUsersPageWithCount(offset, limit) {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.first_name,
            EXISTS(SELECT 1 FROM wallets w WHERE w.user_id = u.id AND w.chain = 'ton') AS has_wallet,
            COUNT(*) OVER()::int AS total_count
     FROM users u
     ORDER BY u.created_at ASC
     OFFSET $1 LIMIT $2`,
    [offset, limit]
  );
  const total = rows[0]?.total_count ?? 0;
  return { rows, total };
}

// ── Wallets ────────────────────────────────────────────
// chain: 'ton' | 'bsc'

async function getWallet(userId, chain) {
  const { rows } = await pool.query(
    'SELECT * FROM wallets WHERE user_id = $1 AND chain = $2',
    [userId, chain]
  );
  return rows[0] || null;
}

async function saveWallet(userId, chain, fields) {
  const {
    address,
    addressEq = null,
    rawAddress = null,
    version = null,
    path = null,
    encryptedMnemonic = null,
    encryptedPrivateKey = null,
    importType = null,
  } = fields;

  // Grab the previous address first (if any) - the caller needs this to
  // unsubscribe it from TonAPI when a wallet is being replaced, since
  // otherwise we'd keep watching an address the user no longer controls.
  const { rows: prevRows } = await pool.query(
    'SELECT raw_address FROM wallets WHERE user_id = $1 AND chain = $2',
    [userId, chain]
  );
  const previousRawAddress = prevRows[0]?.raw_address || null;

  await pool.query(
    `INSERT INTO wallets (user_id, chain, address, address_eq, raw_address, version, path, encrypted_mnemonic, encrypted_private_key, import_type, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (user_id, chain) DO UPDATE SET
       address = EXCLUDED.address,
       address_eq = EXCLUDED.address_eq,
       raw_address = EXCLUDED.raw_address,
       version = EXCLUDED.version,
       path = EXCLUDED.path,
       encrypted_mnemonic = EXCLUDED.encrypted_mnemonic,
       encrypted_private_key = EXCLUDED.encrypted_private_key,
       import_type = EXCLUDED.import_type,
       updated_at = now()`,
    [userId, chain, address, addressEq, rawAddress, version, path, encryptedMnemonic, encryptedPrivateKey, importType]
  );

  return { previousRawAddress };
}

// Looks up which user a TonAPI webhook's account_id (raw format) belongs to.
async function getUserByRawAddress(rawAddress) {
  const { rows } = await pool.query(
    'SELECT user_id, chain FROM wallets WHERE raw_address = $1',
    [rawAddress]
  );
  return rows[0] || null;
}

// All TON wallets with an address - used by the one-time bulk-subscribe
// script and can be re-run anytime to pick up anyone missed.
async function getAllTonWallets() {
  const { rows } = await pool.query(
    `SELECT user_id, address, raw_address FROM wallets WHERE chain = 'ton' AND address IS NOT NULL`
  );
  return rows;
}

// ── Global bot config (fee_percent, fee_address, maintenance) ──

async function getConfig(key, fallback = null) {
  const { rows } = await pool.query('SELECT value FROM bot_config WHERE key = $1', [key]);
  if (!rows[0]) return fallback;
  return rows[0].value;
}

async function setConfig(key, value) {
  await pool.query(
    `INSERT INTO bot_config (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}

// ── Sessions: short-lived per-user state ──────────────
// Replaces Bot.handleNextCommand(...) and *_pending_{u} keys.

async function setSession(userId, key, value, ttlSeconds = 900) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await pool.query(
    `INSERT INTO sessions (user_id, key, value, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
    [userId, key, JSON.stringify(value), expiresAt]
  );
}

async function getSession(userId, key) {
  const { rows } = await pool.query(
    `SELECT value FROM sessions WHERE user_id = $1 AND key = $2 AND (expires_at IS NULL OR expires_at > now())`,
    [userId, key]
  );
  return rows[0] ? rows[0].value : null;
}

async function clearSession(userId, key) {
  await pool.query('DELETE FROM sessions WHERE user_id = $1 AND key = $2', [userId, key]);
}

// "Next command" state - what should handle the user's very next plain-text message
async function setNextCommand(userId, commandName) {
  await setSession(userId, '__next_command', commandName, 600);
}

async function popNextCommand(userId) {
  const cmd = await getSession(userId, '__next_command');
  if (cmd) await clearSession(userId, '__next_command');
  return cmd;
}

// ── Deposit monitor helpers ──

async function updateLastTxTime(userId, time) {
  await pool.query('UPDATE users SET last_tx_time = $2 WHERE id = $1', [userId, time]);
}

async function addBalance(userId, amount) {
  const { rows } = await pool.query(
    'UPDATE users SET balance = balance + $2 WHERE id = $1 RETURNING balance',
    [userId, amount]
  );
  return rows[0]?.balance;
}

// Bug fix: total_tx/total_paid were never incremented anywhere, so the
// dashboard's "Transactions: 0" was always 0 regardless of activity.
// Called on every confirmed deposit (webhook + fallback cron) and every
// successful outgoing /send.
async function incrementTxStats(userId, amountPaid = 0) {
  await pool.query(
    'UPDATE users SET total_tx = total_tx + 1, total_paid = total_paid + $2 WHERE id = $1',
    [userId, amountPaid]
  );
}

// ── Notification preferences ──

async function setNotifyPref(userId, type, value) {
  const column = type === 'deposits' ? 'notify_deposits' : 'notify_withdrawals';
  await pool.query(`UPDATE users SET ${column} = $2 WHERE id = $1`, [userId, value]);
}

async function getNotifyPrefs(userId) {
  const { rows } = await pool.query('SELECT notify_deposits, notify_withdrawals FROM users WHERE id = $1', [userId]);
  return rows[0] || { notify_deposits: true, notify_withdrawals: true };
}

// ── PIN (gates viewing seed phrases / private keys) ──

async function setPin(userId, hash, salt) {
  await pool.query('UPDATE users SET pin_hash = $2, pin_salt = $3 WHERE id = $1', [userId, hash, salt]);
}

async function getPin(userId) {
  const { rows } = await pool.query('SELECT pin_hash, pin_salt FROM users WHERE id = $1', [userId]);
  return rows[0] || null;
}

// ── Wallet backup confirmation ──

async function setBackupConfirmed(userId, chain, confirmed = true) {
  await pool.query(
    'UPDATE wallets SET backup_confirmed = $3 WHERE user_id = $1 AND chain = $2',
    [userId, chain, confirmed]
  );
}

// ── Simple cooldown-based rate limiting, reusing the sessions table ──
// (no new table needed - a rate limit IS a short-lived per-user key/value).

async function checkRateLimit(userId, action, cooldownSeconds) {
  const key = `rl_${action}`;
  const existing = await getSession(userId, key);
  if (existing) {
    const retryAfterMs = new Date(existing.until).getTime() - Date.now();
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  await setSession(userId, key, { until: new Date(Date.now() + cooldownSeconds * 1000).toISOString() }, cooldownSeconds);
  return { allowed: true };
}

// Idempotency check for webhook deliveries that might be retried (TonAPI can
// redeliver the same event). Returns true the FIRST time a given key is seen
// within the TTL window, false on any repeat - so callers do
// `if (!(await markIfFirstTime(...))) return;` to skip duplicate processing.
async function markIfFirstTime(dedupKey, ttlSeconds) {
  const existing = await getSession(0, dedupKey);
  if (existing) return false;
  await setSession(0, dedupKey, true, ttlSeconds);
  return true;
}

module.exports = {
  upsertUser,
  getUser,
  getApiKey,
  getUserWithWallets,
  setApiKey,
  getAllUserIds,
  getUsersForDepositCheck,
  countUsers,
  getUsersPage,
  getUsersPageWithCount,
  getWallet,
  saveWallet,
  getUserByRawAddress,
  getAllTonWallets,
  getConfig,
  setConfig,
  setSession,
  getSession,
  clearSession,
  setNextCommand,
  popNextCommand,
  updateLastTxTime,
  addBalance,
  incrementTxStats,
  setNotifyPref,
  getNotifyPrefs,
  setPin,
  getPin,
  setBackupConfirmed,
  checkRateLimit,
  markIfFirstTime,
};
