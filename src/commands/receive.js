const { em } = require('../lib/emoji');
const store = require('../db/store');
const { generateQrBuffer } = require('../lib/qr');
const { showMenu } = require('../lib/ui');

async function receiveMenu(ctx) {
  const text = `${em('5443127283898405358', '📥')} <b>Receive</b>\n\nSelect chain:`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '💎 Receive TON', callback_data: '/receive_ton' }],
      [{ text: '🟡 Receive BNB', callback_data: '/receive_bnb' }],
      [{ text: 'Cancel', callback_data: '/dashboard' }],
    ],
  };
  return showMenu(ctx, text, keyboard);
}

async function showReceive(ctx, chain) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const u = ctx.from.id;
  const chatId = ctx.chat.id;

  const wallet = await store.getWallet(u, chain);
  if (!wallet?.address) {
    return ctx.reply(`${em('5420323339723881652', '⚠️')} No ${chain.toUpperCase()} wallet connected yet.`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Back', callback_data: '/receive' }]] },
    });
  }

  const caption =
    `${em('5264895611517300926', '🏦')} <b>Your ${chain.toUpperCase()} Address</b>\n\n<code>${wallet.address}</code>\n\n` +
    `<i>Scan the QR code or copy the address above to receive funds.</i>`;

  // QR generation is the one part of this that can genuinely fail (bad
  // buffer, library edge case) - isolate it so a failure there still gets
  // the user their address as text instead of nothing at all.
  try {
    const qrBuffer = await generateQrBuffer(wallet.address);
    return await ctx.telegram.sendPhoto(
      chatId,
      { source: qrBuffer, filename: 'wallet-qr.png' },
      {
        caption,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'Back to Dashboard', callback_data: '/dashboard' }]] },
      }
    );
  } catch (err) {
    console.error('QR generation/send failed:', err.message);
    return ctx.telegram.sendMessage(chatId, caption + `\n\n<i>(QR image couldn't be generated - use the address above.)</i>`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Back to Dashboard', callback_data: '/dashboard' }]] },
    });
  }
}

const receiveTon = (ctx) => showReceive(ctx, 'ton');
const receiveBnb = (ctx) => showReceive(ctx, 'bsc');

module.exports = { receiveMenu, receiveTon, receiveBnb };
