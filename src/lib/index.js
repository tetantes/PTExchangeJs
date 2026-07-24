const express = require('express');
const config = require('./config');
const bot = require('./bot');
const store = require('./db/store');
const tonapi = require('./lib/tonapi');
const { notifyDeposit } = require('./lib/notify');

// Same rationale as bot.catch() in bot.js, but for anything OUTSIDE Telegraf's
// own error handling - the webhook route, the cron job, etc. Log it and keep
// running instead of letting the whole Render service go down and restart.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

const app = express();
app.use(express.json());

const webhookPath = `/telegram/webhook/${config.webhookSecret}`;

app.use(bot.webhookCallback(webhookPath));

// ── TonAPI deposit webhook ──
// Replaces the old Vercel-based /webhook/deposit (disabled - no longer
// registered as a route). TonAPI watches the TON blockchain directly and
// POSTs here the moment a tracked address has a new transaction - your
// Vercel gateway is never involved in deposit detection anymore.
//
// TonAPI's webhook contract has no shared-secret header, so the random token
// in the URL path IS the auth (same idea as the Telegram webhook path above -
// only someone who knows this exact URL can hit it).
app.post(`/webhook/tonapi/${config.tonapiWebhookToken}`, async (req, res) => {
  // ALWAYS respond 200 immediately, no matter what's in the body - TonAPI
  // suspends webhooks after failed deliveries, so a 400/500 here (even for a
  // payload shape we don't recognize) risks getting suspended again. Any
  // real problem gets logged instead of reflected back as an error status.
  res.status(200).json({ ok: true });

  try {
    const { account_id, tx_hash } = req.body || {};
    if (!account_id || !tx_hash) {
      console.warn('TonAPI webhook: missing account_id or tx_hash in payload:', JSON.stringify(req.body));
      return;
    }

    // Dedup: TonAPI can retry a webhook delivery. tx_hash is unique per
    // transaction, so use it as an idempotency key with a short TTL.
    const isFirstTime = await store.markIfFirstTime(`tonapi_tx_${tx_hash}`, 300);
    if (!isFirstTime) return; // already processed this tx recently

    const owner = await store.getUserByRawAddress(account_id);
    if (!owner) return; // not one of our wallets (or not subscribed yet)

    // The webhook payload only tells us THAT something happened, not what -
    // fetch the actual transaction to get the amount/sender/comment.
    // NOTE: field paths here are based on TonAPI's documented v2 schema and
    // haven't been verified against a live response yet - worth checking
    // once this is running with a real API key, in case field names differ.
    const tx = await tonapi.getTransaction(tx_hash);
    const inMsg = tx?.in_msg;
    if (!inMsg || !inMsg.source || !inMsg.value) return; // not an incoming deposit (e.g. this account's own outgoing tx)

    const amountTon = Number(inMsg.value) / 1e9; // nanotons -> TON
    if (!(amountTon > 0)) return;

    const comment = inMsg.decoded_body?.text || inMsg.decoded_body?.comment || null;

    // Update our internal running total for other features (dashboard tx
    // count, etc.) but for the notification, show the REAL balance - straight
    // from TonAPI using the account_id we already have from the webhook
    // payload itself, NOT a call to your Vercel gateway (that was the earlier
    // version's bug: it added a Vercel dependency you specifically didn't
    // want, and if that call was slow/failing, it could break the whole
    // notification instead of just showing an approximate balance).
    const [, realBalance] = await Promise.all([
      Promise.all([
        store.addBalance(owner.user_id, amountTon),
        store.incrementTxStats(owner.user_id, 0),
      ]),
      tonapi.getAccountBalance(account_id).catch((e) => {
        console.error('TonAPI balance lookup failed:', e.message);
        return null;
      }),
    ]);
    const newBalance = realBalance ?? amountTon;

    await notifyDeposit(bot.telegram, owner.user_id, {
      amount: amountTon,
      comment,
      txLink: `https://tonscan.org/tx/${tx_hash}`,
      newBalance,
      chain: 'TON',
    });
  } catch (err) {
    console.error('TonAPI webhook error:', err.message);
  }
});

// Hit by Render's external keep-alive cron (and useful for manual checks).
app.get('/health', (req, res) => res.status(200).json({ ok: true, time: new Date().toISOString() }));
app.get('/', (req, res) => res.status(200).send('PTExchange bot is running.'));

async function main() {
  await bot.telegram.setWebhook(`${config.webhookUrl}${webhookPath}`);
  console.log(`✅ Webhook set to ${config.webhookUrl}${webhookPath}`);

  // Deposit polling cron is disabled - TonAPI's webhook is now the only
  // deposit-detection path, so the bot makes zero recurring calls to your
  // Vercel gateway. Re-enable via cron/depositMonitor.js if you ever want a
  // fallback safety net again.

  app.listen(config.port, () => {
    console.log(`✅ Server listening on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('❌ Failed to start:', err);
  process.exit(1);
});
