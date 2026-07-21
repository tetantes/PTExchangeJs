const { em } = require('../lib/emoji');
const gateway = require('../lib/gateway');
const store = require('../db/store');
const { editOrSend, editOrIgnore } = require('../lib/ui');
const price = require('../lib/price');

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

// Renders the dashboard text from whatever's known SO FAR. Any balance/price
// not yet loaded shows "Loading..." instead of blocking the whole message -
// this is what gets called repeatedly as each async source comes in, not
// just once at the end.
function render(state) {
  const { user, tonWallet, bnbWallet, tonBal, bnbBal, prices } = state;

  let tonSection = `\n${em('5427168083074628963', '💎')} <b>TON Wallet</b>\n`;
  if (tonWallet?.address) {
    const short = tonWallet.address.slice(0, 6) + '...' + tonWallet.address.slice(-6);
    tonSection += `${em('5264895611517300926', '🏦')} <code>${short}</code> · ${(tonWallet.version || '').toUpperCase()}\n`;
    if (tonBal === undefined) {
      tonSection += `${em('5472030678633684592', '💸')} TON: <i>Loading...</i>\n`;
    } else {
      const tonBalance = tonBal?.ton_balance ?? 0;
      const tonJettons = tonBal?.jettons || [];
      const usd = prices ? price.formatUsd(tonBalance, prices.ton) : '';
      tonSection += `${em('5472030678633684592', '💸')} TON: <b>${tonBalance}</b>${usd}\n`;
      for (const j of tonJettons.slice(0, 3)) tonSection += `  • <b>${j.balance || 0} ${j.symbol || '???'}</b>\n`;
      if (tonJettons.length > 3) tonSection += `  <i>+${tonJettons.length - 3} more</i>\n`;
    }
  } else {
    tonSection += `<i>No wallet connected</i>\n`;
  }

  let bscSection = `\n${em('5278467510604160626', '🟡')} <b>BSC Wallet</b>\n`;
  if (bnbWallet?.address) {
    const short = bnbWallet.address.slice(0, 6) + '...' + bnbWallet.address.slice(-6);
    bscSection += `${em('5264895611517300926', '🏦')} <code>${short}</code>\n`;
    if (bnbBal === undefined) {
      bscSection += `${em('5472030678633684592', '💸')} BNB: <i>Loading...</i>\n`;
    } else {
      const bnbBalance = bnbBal?.bnb_balance ?? 0;
      const bnbTokens = bnbBal?.tokens || [];
      const usd = prices ? price.formatUsd(bnbBalance, prices.bnb) : '';
      bscSection += `${em('5472030678633684592', '💸')} BNB: <b>${bnbBalance}</b>${usd}\n`;
      for (const t of bnbTokens) bscSection += `  • <b>${t.balance || 0} ${t.symbol || '???'}</b>\n`;
    }
  } else {
    bscSection += `<i>No wallet connected</i>\n`;
  }

  const totalTx = user?.total_tx || 0;

  return (
    `${em('5427168083074628963', '💎')} <b>PTExchange Dashboard</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━` + tonSection +
    `━━━━━━━━━━━━━━━━━━━━` + bscSection +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${em('5956561916573782596', '📜')} Transactions: <b>${totalTx}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━`
  );
}

async function show(ctx) {
  const isCallback = !!ctx.callbackQuery;
  const u = ctx.from.id;
  const chatId = ctx.chat.id;

  if (isCallback) await ctx.answerCbQuery().catch(() => {});

  // Step 1: the one DB query is fast - get it and paint the first real
  // message immediately (addresses, wallet versions, tx count), with
  // "Loading..." only where we're still waiting on your external gateway.
  const ctxData = await store.getUserWithWallets(u);
  const state = {
    user: ctxData?.user,
    tonWallet: ctxData?.tonWallet,
    bnbWallet: ctxData?.bscWallet,
    tonBal: undefined,
    bnbBal: undefined,
    prices: undefined,
  };

  let msgId = isCallback ? ctx.callbackQuery.message.message_id : null;
  if (msgId) {
    await editOrSend(ctx, chatId, msgId, render(state), keyboard);
  } else {
    const sent = await ctx.reply(render(state), { parse_mode: 'HTML', reply_markup: keyboard });
    msgId = sent.message_id;
  }

  const apiKey = state.user?.api_key;

  // Step 2: kick off the slow external calls WITHOUT waiting for each other -
  // each one edits the message with everything known so far the moment IT
  // personally resolves, rather than all three blocking the first paint.
  const tonPromise = state.tonWallet?.address
    ? gateway.tonBalance(state.tonWallet.address)
    : Promise.resolve(null);
  const bnbPromise = state.bnbWallet?.address
    ? (apiKey ? gateway.bscBalance({ apiKey }) : gateway.bscBalance({ address: state.bnbWallet.address }))
    : Promise.resolve(null);
  const pricePromise = price.getPrices();

  const applyUpdate = async (key, promise) => {
    state[key] = await promise;
    await editOrIgnore(ctx, chatId, msgId, render(state), keyboard);
  };

  await Promise.allSettled([
    applyUpdate('tonBal', tonPromise),
    applyUpdate('bnbBal', bnbPromise),
    applyUpdate('prices', pricePromise),
  ]);
}

module.exports = { show };
