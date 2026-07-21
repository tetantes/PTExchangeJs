const express = require('express');
const config = require('./config');
const bot = require('./bot');
const store = require('./db/store');
const { startDepositMonitor } = require('./cron/depositMonitor');
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

// ── Deposit webhook - called by your Vercel gateway the moment a deposit ──
// lands, instead of the bot polling for it. See DEPLOY.md for the exact
// contract this expects your Vercel side to send.
app.post('/webhook/deposit', async (req, res) => {
  try {
    if (!config.depositWebhookSecret || req.headers['x-webhook-secret'] !== config.depositWebhookSecret) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const { user_id, amount, chain, comment, tx_link, tx_time } = req.body || {};
    if (!user_id || !amount) {
      return res.status(400).json({ ok: false, error: 'user_id and amount are required' });
    }

    const userId = Number(user_id);
    const [newBalance] = await Promise.all([
      store.addBalance(userId, Number(amount)),
      store.incrementTxStats(userId, 0),
    ]);
    if (tx_time) await store.updateLastTxTime(userId, Number(tx_time));

    // Respond to Vercel immediately - don't make it wait on the Telegram
    // send, which is a separate concern from "did we record the deposit".
    res.status(200).json({ ok: true });

    await notifyDeposit(bot.telegram, userId, {
      amount, comment, txLink: tx_link, newBalance, chain: (chain || 'TON').toUpperCase(),
    });
  } catch (err) {
    console.error('Deposit webhook error:', err.message);
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'internal error' });
  }
});

// Hit by Render's external keep-alive cron (and useful for manual checks).
app.get('/health', (req, res) => res.status(200).json({ ok: true, time: new Date().toISOString() }));
app.get('/', (req, res) => res.status(200).send('PTExchange bot is running.'));

async function main() {
  await bot.telegram.setWebhook(`${config.webhookUrl}${webhookPath}`);
  console.log(`✅ Webhook set to ${config.webhookUrl}${webhookPath}`);

  startDepositMonitor(bot);

  app.listen(config.port, () => {
    console.log(`✅ Server listening on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('❌ Failed to start:', err);
  process.exit(1);
});
