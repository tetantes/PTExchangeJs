const { em } = require('../lib/emoji');
const gateway = require('../lib/gateway');
const store = require('../db/store');
const { editOrSend } = require('../lib/ui');
const price = require('../lib/price');

async function show(ctx) {
  const isCallback = !!ctx.callbackQuery;
  const u = ctx.from.id;
  const chatId = ctx.chat.id;

  // answerCbQuery is cheap (just a toast ack) and satisfies Telegram's timeout
  // immediately, so the button stops "spinning" right away even though the
  // real content isn't ready yet - no need for a separate "Loading..." edit
  // before the real one (that was a second full editMessageText round trip).
  if (isCallback) await ctx.answerCbQuery().catch(() => {});

  const msgId = isCallback ? ctx.callbackQuery.message.message_id : null;

  const ctxData = await store.getUserWithWallets(u);
  const user = ctxData?.user;
  const tonWallet = ctxData?.tonWallet;
  const bnbWallet = ctxData?.bscWallet;
  const apiKey = user?.api_key;

  // Balances and prices are all independent reads - fire everything at once.
  const [tonBal, bnbBal, prices] = await Promise.all([
    tonWallet?.address ? gateway.tonBalance(tonWallet.address) : Promise.resolve(null),
    bnbWallet?.address
      ? (apiKey ? gateway.bscBalance({ apiKey }) : gateway.bscBalance({ address: bnbWallet.address }))
      : Promise.resolve(null),
    price.getPrices(),
  ]);

  let tonSection = `\n${em('5427168083074628963', '💎')} <b>TON Wallet</b>\n`;
  if (tonWallet?.address) {
    const short = tonWallet.address.slice(0, 6) + '...' + tonWallet.address.slice(-6);
    const tonBalance = tonBal?.ton_balance ?? 0;
    const tonJettons = tonBal?.jettons || [];
    tonSection += `${em('5264895611517300926', '🏦')} <code>${short}</code> · ${(tonWallet.version || '').toUpperCase()}\n`;
    tonSection += `${em('5472030678633684592', '💸')} TON: <b>${tonBalance}</b>${price.formatUsd(tonBalance, prices.ton)}\n`;
    for (const j of tonJettons.slice(0, 3)) tonSection += `  • <b>${j.balance || 0} ${j.symbol || '???'}</b>\n`;
    if (tonJettons.length > 3) tonSection += `  <i>+${tonJettons.length - 3} more</i>\n`;
  } else {
    tonSection += `<i>No wallet connected</i>\n`;
  }

  let bscSection = `\n${em('5278467510604160626', '🟡')} <b>BSC Wallet</b>\n`;
  if (bnbWallet?.address) {
    const short = bnbWallet.address.slice(0, 6) + '...' + bnbWallet.address.slice(-6);
    const bnbBalance = bnbBal?.bnb_balance ?? 0;
    const bnbTokens = bnbBal?.tokens || [];
    bscSection += `${em('5264895611517300926', '🏦')} <code>${short}</code>\n`;
    bscSection += `${em('5472030678633684592', '💸')} BNB: <b>${bnbBalance}</b>${price.formatUsd(bnbBalance, prices.bnb)}\n`;
    for (const t of bnbTokens) bscSection += `  • <b>${t.balance || 0} ${t.symbol || '???'}</b>\n`;
  } else {
    bscSection += `<i>No wallet connected</i>\n`;
  }

  const totalTx = user?.total_tx || 0;

  const text =
    `${em('5427168083074628963', '💎')} <b>PTExchange Dashboard</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━` + tonSection +
    `━━━━━━━━━━━━━━━━━━━━` + bscSection +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${em('5956561916573782596', '📜')} Transactions: <b>${totalTx}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: 'TON Wallet', callback_data: '/ton_menu' },
        { text: 'BSC Wallet', callback_data: '/bsc_menu' },
      ],
      [
        { text: '📤 Send', callback_data: '/send' },
        { text: '📥 Receive', callback_data: '/receive' },
      ],
      [
        { text: 'My API Key', callback_data: '/api_key' },
        { text: 'Transactions', callback_data: '/transactions_menu' },
      ],
      [{ text: 'Settings', callback_data: '/settings' }],
    ],
  };

  if (msgId) return editOrSend(ctx, chatId, msgId, text, keyboard);
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

module.exports = { show };
