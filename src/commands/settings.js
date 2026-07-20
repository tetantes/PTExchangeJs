const { em } = require('../lib/emoji');
const store = require('../db/store');
const crypto = require('../lib/crypto');
const { editOrSend, deleteSafe, showMenu } = require('../lib/ui');
const pin = require('./pin');

async function settings(ctx) {
  const isCallback = !!ctx.callbackQuery;
  const u = ctx.from.id;
  if (isCallback) await ctx.answerCbQuery().catch(() => {});
  const chatId = ctx.chat.id;
  const msgId = isCallback ? ctx.callbackQuery.message.message_id : null;

  const ctxData = await store.getUserWithWallets(u);
  const tonWallet = ctxData?.tonWallet;
  const bnbWallet = ctxData?.bscWallet;
  const apiKey = ctxData?.user?.api_key || 'Not set';
  const hasPin = !!ctxData?.user?.pin_hash;

  const tonAddr = tonWallet?.address || 'Not set';
  const bnbAddr = bnbWallet?.address || 'Not set';

  const text =
    `${em('5197288647275071607', '🔐')} <b>Settings</b>\n\n━━━━━━━━━━━━━━━━━━━━\n` +
    `${em('5427168083074628963', '💎')} <b>TON:</b> ${(tonWallet?.version || '').toUpperCase()}\n` +
    `<code>${tonAddr.slice(0, 20)}${tonAddr.length > 20 ? '...' : ''}</code>\n\n` +
    `${em('5278467510604160626', '🟡')} <b>BSC:</b>\n<code>${bnbAddr.slice(0, 20)}${bnbAddr.length > 20 ? '...' : ''}</code>\n\n` +
    `${em('5330115548900501467', '🔑')} <b>API Key:</b>\n<tg-spoiler><code>${apiKey.slice(0, 30)}${apiKey.length > 30 ? '...' : ''}</code></tg-spoiler>\n\n` +
    `${em('5197288647275071607', '🔐')} <b>PIN:</b> ${hasPin ? 'Set ✅' : 'Not set'}\n` +
    `━━━━━━━━━━━━━━━━━━━━`;

  const keyboard = {
    inline_keyboard: [
      [{ text: 'Export Seed Phrase', callback_data: '/export_seed' }],
      [{ text: 'View BSC Private Key', callback_data: '/view_bsc_key' }],
      [{ text: hasPin ? 'Change PIN' : 'Set PIN', callback_data: '/set_pin' }],
      [{ text: 'Notifications', callback_data: '/notifications' }],
      [{ text: 'Change TON Wallet', callback_data: '/import_ton_wallet' }],
      [{ text: 'Change BSC Wallet', callback_data: '/import_bnb_wallet' }],
      [{ text: 'Regenerate API Key', callback_data: '/regenerate_key' }],
      [{ text: 'Back', callback_data: '/dashboard' }],
    ],
  };

  if (msgId) return editOrSend(ctx, chatId, msgId, text, keyboard);
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

async function exportSeed(ctx) {
  const u = ctx.from.id;
  const chatId = ctx.chat.id;

  const wallet = await store.getWallet(u, 'ton');
  if (!wallet) {
    return ctx.telegram.sendMessage(chatId, `${em('5420323339723881652', '⚠️')} No wallet found. Create or import one first.`, { parse_mode: 'HTML' });
  }
  if (!wallet.encrypted_mnemonic) {
    return ctx.telegram.sendMessage(chatId, `${em('5210952531676504517', '❌')} No seed phrase found for this wallet.`, { parse_mode: 'HTML' });
  }

  const mnemonic = crypto.decrypt(wallet.encrypted_mnemonic);
  const words = mnemonic.split(' ');
  let formatted = '';
  for (let i = 0; i < words.length; i += 6) formatted += words.slice(i, i + 6).join(' ') + '\n';

  const text =
    `${em('5956561916573782596', '📜')} <b>Your Seed Phrase</b>\n\n` +
    `${em('5967389567781703494', '💼')} Wallet · ${(wallet.version || 'v4').toUpperCase()}\n` +
    `${em('5264895611517300926', '🏦')} <code>${wallet.address.slice(0, 20)}...${wallet.address.slice(-10)}</code>\n\n` +
    `<tg-spoiler>${formatted.trim()}</tg-spoiler>\n\n` +
    `${em('5420323339723881652', '⚠️')} <b>IMPORTANT:</b>\n` +
    `• Write this down on paper\n• Never share it with anyone\n` +
    `• Anyone with this phrase can steal your funds\n• We cannot recover it if you lose it`;

  return ctx.telegram.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'Back to Settings', callback_data: '/settings' }]] },
  });
}

async function viewBscKey(ctx) {
  const u = ctx.from.id;
  const chatId = ctx.chat.id;

  const wallet = await store.getWallet(u, 'bsc');
  if (!wallet) {
    return ctx.telegram.sendMessage(chatId, `${em('5420323339723881652', '⚠️')} No BSC wallet found.`, { parse_mode: 'HTML' });
  }
  if (!wallet.encrypted_private_key) {
    return ctx.telegram.sendMessage(chatId, `${em('5210952531676504517', '❌')} No private key stored for this wallet.`, { parse_mode: 'HTML' });
  }

  const privKey = crypto.decrypt(wallet.encrypted_private_key);
  const text =
    `${em('5956561916573782596', '🔑')} <b>BSC Private Key</b>\n\n` +
    `${em('5264895611517300926', '🏦')} <code>${wallet.address}</code>\n\n` +
    `<tg-spoiler><code>${privKey}</code></tg-spoiler>\n\n` +
    `${em('5420323339723881652', '⚠️')} <b>Never share your private key with anyone.</b>`;

  return ctx.telegram.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'Back to Settings', callback_data: '/settings' }]] },
  });
}

async function notifications(ctx) {
  const u = ctx.from.id;
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

  const prefs = await store.getNotifyPrefs(u);
  const text =
    `${em('5443127283898405358', '🔔')} <b>Notification Preferences</b>\n\n` +
    `Deposits: ${prefs.notify_deposits ? 'On ✅' : 'Off 🔕'}\n` +
    `Withdrawals: ${prefs.notify_withdrawals ? 'On ✅' : 'Off 🔕'}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: prefs.notify_deposits ? 'Turn Off Deposit Alerts' : 'Turn On Deposit Alerts', callback_data: '/toggle_notify_deposits' }],
      [{ text: prefs.notify_withdrawals ? 'Turn Off Withdrawal Alerts' : 'Turn On Withdrawal Alerts', callback_data: '/toggle_notify_withdrawals' }],
      [{ text: 'Back to Settings', callback_data: '/settings' }],
    ],
  };

  return showMenu(ctx, text, keyboard);
}

async function toggleNotifyDeposits(ctx) {
  const u = ctx.from.id;
  const prefs = await store.getNotifyPrefs(u);
  await store.setNotifyPref(u, 'deposits', !prefs.notify_deposits);
  return notifications(ctx);
}

async function toggleNotifyWithdrawals(ctx) {
  const u = ctx.from.id;
  const prefs = await store.getNotifyPrefs(u);
  await store.setNotifyPref(u, 'withdrawals', !prefs.notify_withdrawals);
  return notifications(ctx);
}

// PIN-gated actions - dispatched through pin.requirePin() from bot.js, not
// called directly, so a correct PIN is always required first.
pin.registerGatedAction('export_seed', exportSeed);
pin.registerGatedAction('view_bsc_key', viewBscKey);

module.exports = {
  settings,
  exportSeed,
  viewBscKey,
  notifications,
  toggleNotifyDeposits,
  toggleNotifyWithdrawals,
};
