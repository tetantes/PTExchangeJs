const { em } = require('../lib/emoji');
const gateway = require('../lib/gateway');
const store = require('../db/store');
const { deleteSafe } = require('../lib/ui');

async function test(ctx) {
  const u = ctx.from.id;
  const chatId = ctx.chat.id;

  const apiKey = await store.getApiKey(u);
  if (!apiKey) {
    return ctx.reply(`${em('5210952531676504517', '❌')} No API key found. Please use /start to register first.`, { parse_mode: 'HTML' });
  }

  const loading = await ctx.reply('⏳ <b>Sending test payment...</b>\n\nPlease wait while we connect to PTExchange API.', { parse_mode: 'HTML' });

  const data = await gateway.payTon(apiKey, 'UQDB4JTGb-HqbgD8BjK8k3CtcuzcyCiW0w-A-j98ZGKkP5YL', 19292, 'PTExchange test');
  await deleteSafe(ctx, chatId, loading.message_id);

  const text = data.success
    ? `${em('5427009714745517609', '✅')} <b>Payment Successful!</b>\n\n` +
      `💸 <b>Amount Sent:</b> ${data.amount_sent} TON\n⚡ <b>Network Fee:</b> ${data.network_fee} TON\n` +
      `🏦 <b>Platform Fee:</b> ${data.platform_fee} TON\n🔗 <b>Tx Hash:</b> <code>${data.tx_hash}</code>\n` +
      `🔍 <b>View:</b> <a href="${data.tx_link}">Tonscan</a>`
    : `${em('5210952531676504517', '❌')} <b>Payment Failed</b>\n\n${data.message || 'Unknown error'}`;

  return ctx.reply(text, { parse_mode: 'HTML' });
}

module.exports = { test };
