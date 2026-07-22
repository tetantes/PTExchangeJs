// Run once (and safe to re-run anytime to pick up anyone missed):
//   node scripts/setup-tonapi-webhook.js
//
// Requires TONAPI_KEY, TONAPI_WEBHOOK_TOKEN, and WEBHOOK_URL in your local
// .env (same values as Render).

require('dotenv').config();
const pool = require('../src/db/pool');
const store = require('../src/db/store');
const tonapi = require('../src/lib/tonapi');
const { friendlyToRaw } = require('../src/lib/tonAddress');
const config = require('../src/config');

async function main() {
  if (!config.tonapiKey) throw new Error('TONAPI_KEY is not set');
  if (!config.tonapiWebhookToken) throw new Error('TONAPI_WEBHOOK_TOKEN is not set');

  const endpoint = `${config.webhookUrl}/webhook/tonapi/${config.tonapiWebhookToken}`;

  // Reuse an existing webhook pointed at this exact endpoint instead of
  // creating a duplicate every time this script runs.
  let webhookId = await store.getConfig('tonapi_webhook_id', null);
  if (webhookId) {
    const existing = await tonapi.listWebhooks();
    const stillValid = existing.some((w) => w.id === webhookId && w.endpoint === endpoint);
    if (!stillValid) webhookId = null;
  }

  if (!webhookId) {
    webhookId = await tonapi.createWebhook(endpoint);
    await store.setConfig('tonapi_webhook_id', webhookId);
    console.log(`✅ Created webhook ${webhookId} -> ${endpoint}`);
  } else {
    console.log(`✅ Reusing existing webhook ${webhookId} -> ${endpoint}`);
  }

  const wallets = await store.getAllTonWallets();
  console.log(`Found ${wallets.length} TON wallets to subscribe.`);

  const rawAddresses = [];
  for (const w of wallets) {
    let raw = w.raw_address;
    if (!raw) {
      try {
        raw = friendlyToRaw(w.address);
        await pool.query('UPDATE wallets SET raw_address = $1 WHERE user_id = $2 AND chain = $3', [raw, w.user_id, 'ton']);
      } catch (err) {
        console.error(`Skipping user ${w.user_id} - bad address ${w.address}: ${err.message}`);
        continue;
      }
    }
    rawAddresses.push(raw);
  }

  // TonAPI's subscribe endpoint takes a batch - send in chunks of 100 to
  // keep individual requests reasonable.
  const CHUNK = 100;
  for (let i = 0; i < rawAddresses.length; i += CHUNK) {
    const chunk = rawAddresses.slice(i, i + CHUNK);
    await tonapi.subscribeAccounts(webhookId, chunk);
    console.log(`Subscribed ${Math.min(i + CHUNK, rawAddresses.length)}/${rawAddresses.length}`);
  }

  console.log('✅ Done. All existing TON wallets are now subscribed for deposit notifications.');
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Setup failed:', err.response?.data || err.message);
  process.exit(1);
});
