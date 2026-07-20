const { em } = require('../lib/emoji');
const gateway = require('../lib/gateway');
const store = require('../db/store');
const { editOrSend } = require('../lib/ui');

async function bscMenu(ctx) {
  const isCallback = !!ctx.callbackQuery;
  const u = ctx.from.id;
  if (isCallback) await ctx.answerCbQuery().catch(() => {});
  const chatId = ctx.chat.id;
  const msgId = isCallback ? ctx.callbackQuery.message.message_id : null;

  // wallet + apiKey are on the same users/wallets rows but different tables;
  // fire both queries at once instead of one after the other.
  const [wallet, apiKey] = await Promise.all([
    store.getWallet(u, 'bsc'),
    store.getApiKey(u),
  ]);
  let text = `${em('5278467510604160626', '🟡')} <b>BSC Wallet</b>\n\n`;

  if (wallet?.address) {
    const bal = apiKey ? await gateway.bscBalance({ apiKey }) : await gateway.bscBalance({ address: wallet.address });
    const balance = bal.bnb_balance ?? 'N/A';
    const tokens = bal.tokens || [];

    text +=
      `${em('5264895611517300926', '🏦')} <b>Address:</b>\n<tg-spoiler><code>${wallet.address}</code></tg-spoiler>\n` +
      `${em('5278467510604160626', '🔗')} Network: <b>BSC (BEP20)</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n${em('5472030678633684592', '💸')} BNB: <b>${balance}</b>\n`;

    if (tokens.length) {
      text += `\n${em('5231200819986047254', '📊')} <b>Tokens:</b>\n`;
      for (const t of tokens.slice(0, 5)) text += `  • <b>${t.balance || 0} ${t.symbol || '???'}</b>\n`;
      if (tokens.length > 5) text += `  <i>+${tokens.length - 5} more</i>\n`;
    }
    text += '━━━━━━━━━━━━━━━━━━━━';
  } else {
    text += '<i>No BSC wallet connected yet.</i>';
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: 'Generate Wallet', callback_data: '/generate_bnb_wallet_exec' },
        { text: 'Import Wallet', callback_data: '/import_bnb_wallet_ask' },
      ],
      [{ text: 'BSC Transactions', callback_data: '/bsc_transactions' }],
      [{ text: 'Back', callback_data: '/dashboard' }],
    ],
  };

  if (msgId) return editOrSend(ctx, chatId, msgId, text, keyboard);
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

async function bscTransactions(ctx) {
  const isCallback = !!ctx.callbackQuery;
  const u = ctx.from.id;
  const chatId = ctx.chat.id;

  // Same fix as ton_transactions: skip the extra "Loading..." edit on the
  // callback path, since answerCbQuery already clears the button spinner.
  let msgId;
  if (isCallback) {
    await ctx.answerCbQuery().catch(() => {});
    msgId = ctx.callbackQuery.message.message_id;
  } else {
    const placeholder = await ctx.reply('⏳ <b>Loading BSC transactions...</b>', { parse_mode: 'HTML' });
    msgId = placeholder.message_id;
  }

  const apiKey = await store.getApiKey(u);
  if (!apiKey) {
    return editOrSend(ctx, chatId, msgId, `${em('5420323339723881652', '⚠️')} No account found. Please use /start to register.`, {
      inline_keyboard: [[{ text: 'Back', callback_data: '/transactions_menu' }]],
    });
  }

  const data = await gateway.bscTransactions(apiKey, 10);
  const txs = data.transactions || [];

  const header = `${em('5278467510604160626', '🔶')} <b>BSC Transactions</b>\n━━━━━━━━━━━━━━━━━━━━`;
  let text;
  if (!txs.length) {
    text = header + '\n\n<i>No transactions yet.</i>';
  } else {
    const lines = txs.map((tx) => {
      const token = tx.token || 'BNB';
      const amount = tx.amount || 0;
      const toAddr = tx.to_address || '';
      const status = tx.status || 'unknown';
      const txHash = tx.tx_hash || '';
      const netFee = tx.network_fee || 0;
      const short = toAddr.length > 12 ? toAddr.slice(0, 6) + '...' + toAddr.slice(-6) : toAddr;
      let amtStr;
      try { amtStr = parseFloat(amount).toFixed(6).replace(/\.?0+$/, ''); } catch { amtStr = String(amount); }
      const statusIcon = status === 'completed' ? em('5427009714745517609', '✅') : em('5210952531676504517', '❌');

      let line = `${em('5445355530111437729', '📤')} <b>-${amtStr} ${token}</b> ${statusIcon}\n`;
      line += `To: <code>${short}</code>\nFee: <code>${Number(netFee).toFixed(6)} BNB</code>\n`;
      if (txHash) line += `<a href="https://bscscan.com/tx/${txHash}">View on BscScan</a>`;
      return line;
    });
    text = header + '\n\n' + lines.join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n');
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: 'TON Transactions', callback_data: '/ton_transactions' }],
      [{ text: 'Back', callback_data: '/transactions_menu' }],
    ],
  };

  return editOrSend(ctx, chatId, msgId, text, keyboard);
}

module.exports = { bscMenu, bscTransactions };
