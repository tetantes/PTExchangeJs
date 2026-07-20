const { em } = require('../lib/emoji');
const gateway = require('../lib/gateway');
const store = require('../db/store');
const { showMenu, editOrSend } = require('../lib/ui');

async function transactionsMenu(ctx) {
  const text = `${em('5956561916573782596', '📜')} <b>Transactions</b>\n\nSelect chain:`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '💎 TON Transactions', callback_data: '/ton_transactions' }],
      [{ text: '🟡 BSC Transactions', callback_data: '/bsc_transactions' }],
      [{ text: 'Back', callback_data: '/dashboard' }],
    ],
  };
  return showMenu(ctx, text, keyboard);
}

// Legacy /transactions - kept for parity with the TPY export (superseded by
// /ton_transactions in normal flow, but /transactions_menu and dashboard don't
// route here directly anymore).
async function transactions(ctx) {
  const isCallback = !!ctx.callbackQuery;
  const u = ctx.from.id;
  if (isCallback) await ctx.answerCbQuery().catch(() => {});
  const chatId = ctx.chat.id;
  const msgId = isCallback ? ctx.callbackQuery.message.message_id : null;

  const wallet = await store.getWallet(u, 'ton');
  if (!wallet?.address) {
    const text = `${em('5420323339723881652', '⚠️')} No wallet connected.`;
    const kb = { inline_keyboard: [[{ text: 'Back', callback_data: '/dashboard' }]] };
    if (msgId) return editOrSend(ctx, chatId, msgId, text, kb);
    return ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }

  const data = await gateway.tonTransactions(wallet.address, 10);
  const txs = data.transactions || [];

  const header = `${em('5956561916573782596', '📜')} <b>Latest Transactions</b>\n━━━━━━━━━━━━━━━━━━━━`;
  let text;
  if (!txs.length) {
    text = header + '\n\n<i>No transactions yet.</i>';
  } else {
    const lines = txs.map((tx) => {
      const isIncoming = tx.type === 'incoming';
      const peer = isIncoming ? tx.from || '' : tx.to || '';
      const icon = isIncoming ? em('5443127283898405358', '📥') : em('5445355530111437729', '📤');
      const sign = isIncoming ? '+' : '-';
      const short = peer.length > 12 ? peer.slice(0, 6) + '...' + peer.slice(-6) : peer;
      let amtStr;
      try { amtStr = parseFloat(tx.amount || 0).toFixed(6).replace(/\.?0+$/, ''); } catch { amtStr = String(tx.amount); }
      let line = `${icon} <b>${sign}${amtStr} TON</b>\n${isIncoming ? 'From' : 'To'}: <code>${short}</code>\n`;
      if (tx.comment) line += `💬 <i>${tx.comment}</i>\n`;
      if (tx.tx_link) line += `<a href="${tx.tx_link}">View on TonScan</a>`;
      return line;
    });
    text = header + '\n\n' + lines.join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n');
  }

  const kb = { inline_keyboard: [[{ text: 'Back', callback_data: '/dashboard' }]] };
  if (msgId) return editOrSend(ctx, chatId, msgId, text, kb);
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

module.exports = { transactionsMenu, transactions };
