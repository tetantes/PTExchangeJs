const { em } = require('../lib/emoji');
const gateway = require('../lib/gateway');
const store = require('../db/store');
const { editOrSend } = require('../lib/ui');

async function tonMenu(ctx) {
  const isCallback = !!ctx.callbackQuery;
  const u = ctx.from.id;
  if (isCallback) await ctx.answerCbQuery().catch(() => {});
  const chatId = ctx.chat.id;
  const msgId = isCallback ? ctx.callbackQuery.message.message_id : null;

  const wallet = await store.getWallet(u, 'ton');
  let text = `${em('5427168083074628963', '💎')} <b>TON Wallet</b>\n\n`;

  if (wallet?.address) {
    const bal = await gateway.tonBalance(wallet.address);
    const balance = bal.ton_balance ?? 'N/A';
    const jettons = bal.jettons || [];

    text +=
      `${em('5264895611517300926', '🏦')} <b>Address:</b>\n<tg-spoiler><code>${wallet.address}</code></tg-spoiler>\n` +
      `${em('5427168083074628963', '💎')} Version: <b>${(wallet.version || '').toUpperCase()}</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n${em('5472030678633684592', '💸')} TON: <b>${balance}</b>\n`;

    if (jettons.length) {
      text += `\n${em('5231200819986047254', '📊')} <b>Tokens:</b>\n`;
      for (const j of jettons.slice(0, 5)) text += `  • <b>${j.balance || 0} ${j.symbol || '???'}</b>\n`;
      if (jettons.length > 5) text += `  <i>+${jettons.length - 5} more</i>\n`;
    }
    text += '━━━━━━━━━━━━━━━━━━━━';
  } else {
    text += '<i>No TON wallet connected yet.</i>';
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: 'Generate Wallet', callback_data: '/generate_wallet' },
        { text: 'Import Wallet', callback_data: '/import_wallet' },
      ],
      [{ text: 'TON Transactions', callback_data: '/ton_transactions' }],
      [{ text: 'Back', callback_data: '/dashboard' }],
    ],
  };

  if (msgId) return editOrSend(ctx, chatId, msgId, text, keyboard);
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

async function tonTransactions(ctx) {
  const isCallback = !!ctx.callbackQuery;
  const u = ctx.from.id;
  const chatId = ctx.chat.id;

  // Previously this always edited/sent a "Loading..." message, then fetched,
  // then edited again - 2 Telegram API calls before the user saw real data.
  // answerCbQuery alone clears the button's spinner immediately; for the
  // callback path we now go straight from tap to final content in one edit.
  let msgId;
  if (isCallback) {
    await ctx.answerCbQuery().catch(() => {});
    msgId = ctx.callbackQuery.message.message_id;
  } else {
    // No existing message to edit when triggered by typing /command directly -
    // this path still needs one placeholder, but that's the less common route.
    const placeholder = await ctx.reply('⏳ <b>Loading TON transactions...</b>', { parse_mode: 'HTML' });
    msgId = placeholder.message_id;
  }

  const wallet = await store.getWallet(u, 'ton');
  if (!wallet?.address) {
    return editOrSend(ctx, chatId, msgId, `${em('5420323339723881652', '⚠️')} No TON wallet connected.`, {
      inline_keyboard: [[{ text: 'Back', callback_data: '/transactions_menu' }]],
    });
  }

  const data = await gateway.tonTransactions(wallet.address, 10);
  const txs = data.transactions || [];

  const header = `${em('5427168083074628963', '💎')} <b>TON Transactions</b>\n━━━━━━━━━━━━━━━━━━━━`;
  let text;
  if (!txs.length) {
    text = header + '\n\n<i>No transactions yet.</i>';
  } else {
    const lines = txs.map((tx) => {
      const isIncoming = tx.type === 'incoming';
      const amount = tx.amount || 0;
      const peer = isIncoming ? tx.from || '' : tx.to || '';
      const icon = isIncoming ? em('5443127283898405358', '📥') : em('5445355530111437729', '📤');
      const sign = isIncoming ? '+' : '-';
      const short = peer.length > 12 ? peer.slice(0, 6) + '...' + peer.slice(-6) : peer;
      let amtStr;
      try { amtStr = parseFloat(amount).toFixed(6).replace(/\.?0+$/, ''); } catch { amtStr = String(amount); }

      let line = `${icon} <b>${sign}${amtStr} TON</b>\n${isIncoming ? 'From' : 'To'}: <code>${short}</code>\n`;
      if (tx.comment) line += `💬 <i>${tx.comment}</i>\n`;
      if (tx.tx_link) line += `<a href="${tx.tx_link}">View on TonScan</a>`;
      return line;
    });
    text = header + '\n\n' + lines.join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n');
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: 'BSC Transactions', callback_data: '/bsc_transactions' }],
      [{ text: 'Back', callback_data: '/transactions_menu' }],
    ],
  };

  return editOrSend(ctx, chatId, msgId, text, keyboard);
}

module.exports = { tonMenu, tonTransactions };
