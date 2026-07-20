const { em } = require('../lib/emoji');
const gateway = require('../lib/gateway');
const store = require('../db/store');
const config = require('../config');
const { editOrSend } = require('../lib/ui');
const { rateLimited } = require('../lib/rateLimit');

async function apiKey(ctx) {
  const isCallback = !!ctx.callbackQuery;
  const u = ctx.from.id;
  if (isCallback) await ctx.answerCbQuery().catch(() => {});
  const chatId = ctx.chat.id;
  const msgId = isCallback ? ctx.callbackQuery.message.message_id : null;

  const ctxData = await store.getUserWithWallets(u);
  const key = ctxData?.user?.api_key || 'Not generated';
  const tonWallet = ctxData?.tonWallet;
  const bnbWallet = ctxData?.bscWallet;
  const tonAddr = tonWallet?.address || 'Not set';
  const bnbAddr = bnbWallet?.address || 'Not set';

  const text =
    `${em('5330115548900501467', '🔑')} <b>API Documentation</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${em('5427168083074628963', '💎')} <b>TON Gateway</b>\n` +
    `TON URL: <code>${config.tonApiUrl}</code>\n` +
    `BSC URL: <code>${config.bscApiUrl}</code>\n` +
    `Key: <tg-spoiler><code>${key}</code></tg-spoiler>\n` +
    `Wallet: <code>${tonAddr.slice(0, 20)}${tonAddr.length > 20 ? '...' : ''}</code> · ${(tonWallet?.version || '').toUpperCase()}\n\n` +
    `<b>Send TON:</b>\n` +
    `<code>POST ${config.tonApiUrl}/pay/ton\n{ "api_key": "${key}", "to_address": "UQ...", "amount": 1.0, "comment": "Payment" }</code>\n\n` +
    `<b>Send Jetton (by symbol):</b>\n` +
    `<code>POST ${config.tonApiUrl}/pay/jetton\n{ "api_key": "${key}", "to_address": "UQ...", "jetton_symbol": "NOT", "amount": 100, "comment": "Payment" }</code>\n\n` +
    `<b>Supported Symbols:</b>\n<code>NOT, USDT, USDC, STON, DOGS, HMSTR</code>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${em('5278467510604160626', '🟡')} <b>BSC Gateway</b>\n` +
    `URL: <code>${config.bscApiUrl}</code>\n` +
    `Key: <tg-spoiler><code>${key}</code></tg-spoiler>\n` +
    `Wallet: <code>${bnbAddr.slice(0, 20)}${bnbAddr.length > 20 ? '...' : ''}</code>\n\n` +
    `<b>Send BNB:</b>\n` +
    `<code>POST ${config.bscApiUrl}/pay/bnb\n{ "api_key": "${key}", "to_address": "0x...", "amount": 0.05 }</code>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${em('5420323339723881652', '⚠️')} <b>Never share your mnemonic or private key.</b>\n` +
    `<i>Your API key is used to authorize payments.</i>`;

  const keyboard = {
    inline_keyboard: [
      [{ text: 'Regenerate Key', callback_data: '/regenerate_key' }],
      [{ text: 'Find Token Address', callback_data: '/find_token' }],
      [{ text: 'Back', callback_data: '/dashboard' }],
    ],
  };

  if (msgId) return editOrSend(ctx, chatId, msgId, text, keyboard);
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

async function regenerateKey(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  const u = ctx.from.id;
  const chatId = ctx.chat.id;
  const msgId = ctx.callbackQuery.message.message_id;

  if (await rateLimited(ctx, 'regenerate_key', 300)) return;

  const oldKey = await store.getApiKey(u);
  const data = await gateway.regenerateApiKey(u, oldKey);
  const key = data.api_key || '';
  if (key) await store.setApiKey(u, key);

  const text = key
    ? `${em('5427009714745517609', '✅')} <b>New API Key Generated!!</b>\n\n<tg-spoiler><code>${key}</code></tg-spoiler>\n\n${em('5420323339723881652', '⚠️')} <i>Your old key no longer works.</i>`
    : `${em('5210952531676504517', '❌')} ${data.message || 'Failed to generate a new key. Try again shortly.'}`;

  return editOrSend(ctx, chatId, msgId, text, { inline_keyboard: [[{ text: 'Back', callback_data: '/api_key' }]] });
}

// /get - shows or creates the API key (mirrors TPY's /get, which was labeled "get_api_key")
async function getApiKey(ctx) {
  const u = ctx.from.id;
  const existing = await store.getApiKey(u);

  if (existing) {
    return ctx.reply(
      `${em('5231200819986047254', '🔑')} <b>Your API Key</b>\n\n<code>${existing}</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n<i>Keep this key safe. Never share it publicly.</i>\n\n` +
      `Use this cURL to test:\n<code>curl -X POST ${config.tonApiUrl}/pay/ton \\\n` +
      `  -H "x-gateway-key: ${config.gatewayKey}" \\\n  -H "Content-Type: application/json" \\\n` +
      `  -d '{"api_key": "${existing}", "to_address": "UQDB4JTGb-HqbgD8BjK8k3CtcuzcyCiW0w-A-j98ZGKkP5YL", "amount": 0.01, "comment": "Test payment"}'</code>`,
      { parse_mode: 'HTML' }
    );
  }

  const loading = await ctx.reply('⏳ <b>Creating API key...</b>\n\nPlease wait while we connect to PTExchange API.', { parse_mode: 'HTML' });
  const data = await gateway.register(u, ctx.from.username);
  const key = data.api_key || '';

  if (!key) {
    return ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, `${em('5210952531676504517', '❌')} Failed to create API key.`, { parse_mode: 'HTML' });
  }

  await store.setApiKey(u, key);
  await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
  return ctx.reply(
    `${em('5427009714745517609', '✅')} <b>API Key Created!</b>\n\n<code>${key}</code>\n\n━━━━━━━━━━━━━━━━━━━━\n` +
    `${em('5420323339723881652', '⚠️')} <b>Save this key safely.</b>`,
    { parse_mode: 'HTML' }
  );
}

module.exports = { apiKey, regenerateKey, getApiKey };
