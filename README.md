# PTExchange Bot — Node.js (Render + Neon)

Node.js/Telegraf rewrite of the PTExchange Telegram bot, previously built on
Telebot Creator (TPY). All 46 commands from the export are covered.

## 1. Neon (Postgres) setup

1. Create a project at neon.tech, copy the pooled connection string.
2. Put it in `DATABASE_URL` in your `.env` (see `.env.example`).
3. Run the migration once:
   ```
   npm install
   npm run migrate
   ```
   This creates `users`, `wallets`, `bot_config`, and `sessions` tables from `src/db/schema.sql`.

## 2. Environment variables

Copy `.env.example` to `.env` and fill in:

- `BOT_TOKEN` — from @BotFather
- `WEBHOOK_URL` — your Render service URL (fill this in *after* first deploy, e.g. `https://ptexchange-bot.onrender.com`)
- `DATABASE_URL` — Neon connection string
- `GATEWAY_KEY` / `TONCENTER_API_KEY` — **rotate both**, they were exposed in plaintext in the TPY export you shared
- `ENCRYPTION_KEY` — generate with:
  ```
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  Back this up somewhere safe outside git/Render — losing it makes every stored seed phrase unrecoverable.
- `BOT_ADMIN_ID` — your Telegram user id (admin-only commands check this)

## 3. Deploying to Render (free tier)

1. Push this repo to GitHub.
2. Render → New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add all env vars from `.env` in Render's dashboard (Environment tab).
5. Deploy once, copy the resulting `https://xxxx.onrender.com` URL into `WEBHOOK_URL`, redeploy.
6. Set up your external keep-alive cron (cron-job.org, UptimeRobot, etc.) to `GET https://xxxx.onrender.com/health` every ~10 minutes, so the free-tier instance doesn't spin down.

The bot runs in **webhook mode**, not polling — this is what makes it work reliably with Render's spin-down/wake-up cycle. The internal deposit-monitor cron (`node-cron`, every 60s) runs inside the same process, so as long as the keep-alive cron is pinging `/health`, deposit checks keep running too.

## 4. Telegram Premium custom emoji

The `<tg-emoji emoji-id="...">` tags carried over unchanged from the TPY export. The only requirement: **the bot owner's own Telegram account needs Premium** for these to render as custom emoji (they fall back to the plain emoji character for everyone else automatically — no extra code needed).

## 5. What changed from the TPY version (gaps filled)

- **Real encryption.** Wallet seed phrases/private keys are now AES-256-GCM encrypted (`src/lib/crypto.js`) instead of the original `obfuscate()`, which just split text on `|` and stripped one character per word — trivially reversible by anyone with read access to the data.
- **TON import now stores an encrypted mnemonic.** In the original TPY code, `/import_wallet_save` never saved the mnemonic at all, so `/export_seed` silently returned "no seed phrase found" for any wallet you imported (only generated wallets worked). Fixed in `importWallet.js`.
- **Hardcoded secrets removed.** `PTEX_KEY = "xunlock"` and the Toncenter API key were both in plaintext in the exported command scripts. They're now environment variables — **rotate both** before going live, since they were exposed to whatever tools/people saw that export.
- **Live user pagination.** `/users` and `/users_page` originally cached the full user list in a single `Bot.getData` blob that expired between page views. Now queries Postgres directly per page — no expiry issue.
- **Deposit monitor as a real cron job**, not a self-rescheduling command chain (`Bot.runCommandAfter`), which would not survive a Render restart or spin-down.

## 6. Project structure

```
src/
  index.js          Express server, webhook + health endpoint
  bot.js             Telegraf setup, command/action routing
  config.js          Env var loader
  db/
    schema.sql       Postgres schema
    migrate.js        One-time migration runner
    pool.js, store.js Connection pool + data access layer
  lib/
    emoji.js          Custom emoji helper
    crypto.js          AES-256-GCM encrypt/decrypt
    gateway.js         HTTP client for the two PTExchange APIs + Toncenter
    ui.js              Edit/delete-first message helper
  commands/            One file per command group (mirrors the TPY export)
  middleware/gate.js   Maintenance check + user tracking (was TPY's "@")
  cron/depositMonitor.js
```
