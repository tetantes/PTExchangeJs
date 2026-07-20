// One-time import of the full TBC data export (all_users, wallets, api keys,
// balances) into the new Postgres schema. Safe to re-run - it upserts.
//
// Usage:
//   node scripts/import-legacy-data.js /path/to/bot_full_export.json
//
// What it does per user:
//   - upserts the users row (username, first_name, api_key, total_tx, total_paid, balance)
//   - deobfuscates each wallet's mnemonic/private key using the OLD TPY scheme
//     (strip a leading char per "|"-joined word) and re-encrypts with AES-256-GCM
//   - skips empty wallets (address == "")
//
// This does not touch any live balances on your TON/BSC API - it only mirrors
// what TBC already had stored, into the new database.

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = require('../src/db/pool');
const cryptoLib = require('../src/lib/crypto');
const store = require('../src/db/store');

function sanitizeJson(raw) {
  // Some exported names contain literal control characters that break strict
  // JSON parsing - escape them if they appear inside string literals.
  raw = raw.replace(/"all_users":\s*\[[^\]]*\]/, '"all_users": []');
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const code = raw.charCodeAt(i);
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === '\\') { out += ch; escaped = true; continue; }
      if (ch === '"') { out += ch; inString = false; continue; }
      if (code < 0x20) {
        if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        continue; // drop other stray control chars
      }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

// Old TPY obfuscation: text was split on "|" into words, each word prefixed
// with one throwaway character. Deobfuscating = strip the first char of each
// "|"-separated part and rejoin with spaces. A single-word value (like a hex
// private key, which has no spaces) is just one "part" with no "|".
function deobfuscateLegacy(text) {
  if (!text) return null;
  const parts = text.split('|');
  return parts.map((p) => p.slice(1)).join(' ').trim() || null;
}

async function importAll(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(sanitizeJson(raw));

  // ── Global config ──
  const g = data.global_data || {};
  if (g.fee_percent !== undefined) await store.setConfig('fee_percent', g.fee_percent);
  if (g.fee_address !== undefined) await store.setConfig('fee_address', g.fee_address);
  if (g.maintenance !== undefined) await store.setConfig('maintenance', g.maintenance);

  let imported = 0;
  let walletsImported = 0;

  for (const u of data.users || []) {
    const userId = u.user_id;
    if (!userId) continue;

    await pool.query(
      `INSERT INTO users (id, username, first_name, api_key, is_registered, total_tx, total_paid, balance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         first_name = EXCLUDED.first_name,
         api_key = EXCLUDED.api_key,
         is_registered = EXCLUDED.is_registered,
         total_tx = EXCLUDED.total_tx,
         total_paid = EXCLUDED.total_paid,
         balance = EXCLUDED.balance`,
      [
        userId,
        u.username || '',
        u.first_name || '',
        u.api_key || null,
        String(u.registered).toLowerCase() === 'true',
        parseInt(u.total_tx || 0, 10),
        parseFloat(u.total_paid || 0),
        parseFloat(u.balance || 0),
      ]
    );
    imported++;

    // ── TON wallet ──
    const ton = u.ton_wallet;
    if (ton && ton.address) {
      const mnemonic = deobfuscateLegacy(ton.encrypted);
      await store.saveWallet(userId, 'ton', {
        address: ton.address,
        addressEq: ton.address_eq || null,
        version: ton.version || null,
        encryptedMnemonic: mnemonic ? cryptoLib.encrypt(mnemonic) : null,
        importType: mnemonic ? 'mnemonic' : 'generated',
      });
      walletsImported++;
    }

    // ── BSC wallet ──
    const bnb = u.bnb_wallet;
    if (bnb && bnb.address) {
      const mnemonic = deobfuscateLegacy(bnb.encrypted);
      const privKey = deobfuscateLegacy(bnb.encrypted_key);
      await store.saveWallet(userId, 'bsc', {
        address: bnb.address,
        version: 'bsc',
        path: bnb.path || null,
        encryptedMnemonic: mnemonic ? cryptoLib.encrypt(mnemonic) : null,
        encryptedPrivateKey: privKey ? cryptoLib.encrypt(privKey) : null,
        importType: bnb.import_type || (mnemonic ? 'mnemonic' : privKey ? 'privkey' : null),
      });
      walletsImported++;
    }
  }

  console.log(`✅ Imported ${imported} users, ${walletsImported} wallets.`);
  await pool.end();
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/import-legacy-data.js /path/to/bot_full_export.json');
  process.exit(1);
}

importAll(path.resolve(filePath)).catch((err) => {
  console.error('❌ Import failed:', err);
  process.exit(1);
});
