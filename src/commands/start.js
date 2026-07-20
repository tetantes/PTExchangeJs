const { em } = require('../lib/emoji');
const gateway = require('../lib/gateway');
const store = require('../db/store');
const dashboard = require('./dashboard');

async function start(ctx) {
  const u = ctx.from.id;
  const firstName = ctx.from.first_name || 'there';

  await store.upsertUser(u, { username: ctx.from.username, firstName });

  const existingKey = await store.getApiKey(u);
  if (existingKey) {
    return dashboard.show(ctx);
  }

  const loading = await ctx.reply('⏳ <b>Setting up your account...</b>\n\nPlease wait while we connect to PTExchange API.', { parse_mode: 'HTML' });

  const data = await gateway.register(u, ctx.from.username);
  if (data.api_key) {
    await store.setApiKey(u, data.api_key);
  }

  await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});

  const text =
    `${em('5427168083074628963', '💎')} <b>Welcome to PTExchange, ${firstName}!</b>\n\n` +
    `Your TON &amp; Jetton Payment Gateway.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${em('5967389567781703494', '💼')} Import or generate a wallet\n` +
    `${em('5330115548900501467', '🔑')} Get your API key\n` +
    `${em('5472030678633684592', '💸')} Process TON &amp; Jetton payments\n` +
    `${em('5231200819986047254', '📊')} Track all transactions\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Get started below 👇`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: 'Generate Wallet', callback_data: '/generate_wallet' },
        { text: 'Import Wallet', callback_data: '/import_wallet' },
      ],
      [{ text: 'My Dashboard', callback_data: '/dashboard' }],
    ],
  };

  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

module.exports = { start };
