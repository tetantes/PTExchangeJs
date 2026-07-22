const { Telegraf } = require('telegraf');
const config = require('./config');
const gate = require('./middleware/gate');
const store = require('./db/store');

const start = require('./commands/start');
const dashboard = require('./commands/dashboard');
const admin = require('./commands/admin');
const apiKey = require('./commands/apiKey');
const settings = require('./commands/settings');
const findToken = require('./commands/findToken');
const ton = require('./commands/ton');
const bsc = require('./commands/bsc');
const transactions = require('./commands/transactions');
const generateWallet = require('./commands/generateWallet');
const importWallet = require('./commands/importWallet');
const test = require('./commands/test');
const pin = require('./commands/pin');
const send = require('./commands/send');
const receive = require('./commands/receive');
const backupConfirm = require('./lib/backupConfirm');
const broadcast = require('./commands/broadcast');

const bot = new Telegraf(config.botToken);

bot.use(gate);

// ── Slash commands (typed directly) ──
bot.command('start', start.start);
bot.command('dashboard', dashboard.show);
bot.command('admin', admin.admin);
bot.command('users', admin.users);
bot.command('fix', admin.fix);
bot.command('api_key', apiKey.apiKey);
bot.command('get', apiKey.getApiKey);
bot.command('settings', settings.settings);
bot.command('find_token', findToken.findToken);
bot.command('ton_menu', ton.tonMenu);
bot.command('bsc_menu', bsc.bscMenu);
bot.command('transactions_menu', transactions.transactionsMenu);
bot.command('transactions', transactions.transactions);
bot.command('generate_wallet', generateWallet.generateWallet);
bot.command('import_wallet', importWallet.importWallet);
bot.command('test', test.test);
bot.command('send', send.sendMenu);
bot.command('receive', receive.receiveMenu);
bot.command('broadcast', broadcast.broadcastStart);

// ── Callback query actions (button taps) ──
const actionMap = new Map(Object.entries({
  '/start': start.start,
  '/dashboard': dashboard.show,
  '/admin': admin.admin,
  '/users': admin.users,
  '/toggle_maintenance': admin.toggleMaintenance,
  '/set_fee': admin.setFee,
  '/set_fee_wallet': admin.setFeeWallet,
  '/api_key': apiKey.apiKey,
  '/regenerate_key': apiKey.regenerateKey,
  '/settings': settings.settings,
  // PIN-gated: these no longer call the reveal directly. requirePin() checks
  // whether a PIN is set, asks for it (every time, per your call), then
  // dispatches to the real handler only on a correct entry.
  '/export_seed': (ctx) => pin.requirePin(ctx, 'export_seed'),
  '/view_bsc_key': (ctx) => pin.requirePin(ctx, 'view_bsc_key'),
  '/set_pin': pin.setPinAsk,
  '/notifications': settings.notifications,
  '/toggle_notify_deposits': settings.toggleNotifyDeposits,
  '/toggle_notify_withdrawals': settings.toggleNotifyWithdrawals,
  '/find_token': findToken.findToken,
  '/ton_menu': ton.tonMenu,
  '/ton_transactions': ton.tonTransactions,
  '/bsc_menu': bsc.bscMenu,
  '/bsc_transactions': bsc.bscTransactions,
  '/transactions_menu': transactions.transactionsMenu,
  '/generate_wallet': generateWallet.generateWallet,
  '/generate_ton_wallet': generateWallet.generateTonWallet,
  '/generate_wallet_v4': generateWallet.generateWalletV4,
  '/generate_wallet_v5': generateWallet.generateWalletV5,
  '/confirm_generate_v4': generateWallet.confirmGenerateV4,
  '/confirm_generate_v5': generateWallet.confirmGenerateV5,
  '/generate_bnb_wallet': generateWallet.generateBnbWallet,
  '/generate_bnb_wallet_exec': generateWallet.generateBnbWalletExec,
  '/import_wallet': importWallet.importWallet,
  '/import_ton_wallet': importWallet.importTonWallet,
  '/import_wallet_v4': importWallet.importWalletV4,
  '/import_wallet_v5': importWallet.importWalletV5,
  '/confirm_import_v4': importWallet.confirmImportV4,
  '/confirm_import_v5': importWallet.confirmImportV5,
  '/import_bnb_wallet': importWallet.importBnbWallet,
  '/import_bnb_wallet_ask': importWallet.importBnbWalletAsk,
  '/import_bnb_wallet_save': importWallet.importBnbWalletSave,
  '/send': send.sendMenu,
  '/send_ton': send.startSendTon,
  '/send_bnb': send.startSendBnb,
  '/send_confirm': send.sendConfirm,
  '/receive': receive.receiveMenu,
  '/receive_ton': receive.receiveTon,
  '/receive_bnb': receive.receiveBnb,
  '/broadcast_confirm': broadcast.broadcastConfirm,
  '/broadcast': broadcast.broadcastStart,
}));

const usersPageRe = /^\/users_page( \d+)?$/;

bot.on('callback_query', (ctx, next) => {
  const data = ctx.callbackQuery?.data;
  if (!data) return next();

  const handler = actionMap.get(data);
  if (handler) return handler(ctx);

  if (usersPageRe.test(data)) return admin.usersPage(ctx);

  return next();
});

// ── Broadcast capture ──
// Needs to catch ANY message type (photo, video, poll, plain text...), not
// just text, so this runs as its own general 'message' handler ahead of the
// text-only next-command flow below.
bot.on('message', async (ctx, next) => {
  const u = ctx.from.id;
  if (!admin.isAdmin(u)) return next();
  const awaiting = await store.getSession(u, 'awaiting_broadcast');
  if (!awaiting) return next();
  return broadcast.captureBroadcastMessage(ctx);
});

// ── Plain-text "next command" flow (replaces Bot.handleNextCommand) ──
const nextCommandHandlers = {
  save_fee: admin.saveFee,
  save_fee_wallet: admin.saveFeeWallet,
  find_token_search: findToken.findTokenSearch,
  import_wallet_save: importWallet.importWalletSave,
  import_bnb_wallet_preview: importWallet.importBnbWalletPreview,
  set_pin_save: pin.setPinSave,
  verify_pin: pin.verifyPin,
  verify_backup: backupConfirm.verifyBackup,
  send_address: send.sendAddress,
  send_amount: send.sendAmount,
};

bot.on('text', async (ctx, next) => {
  if (ctx.message.text.startsWith('/')) return next(); // real commands handled above
  const u = ctx.from.id;
  const pending = await store.popNextCommand(u);
  if (pending && nextCommandHandlers[pending]) {
    return nextCommandHandlers[pending](ctx);
  }
  return next();
});

// Without this, an error thrown inside ANY handler (a bad API response, a
// malformed buffer, anything) becomes an unhandled promise rejection - which
// crashes the entire Node process and takes down the bot for every user, not
// just the one who triggered it. Render then restarts the whole service.
// This catches it, logs it, and tries to tell the affected user something
// went wrong instead of silently going down.
bot.catch((err, ctx) => {
  console.error(`Bot error for update ${ctx.updateType}:`, err);
  const chatId = ctx.chat?.id;
  if (chatId) {
    ctx.telegram.sendMessage(chatId, '⚠️ Something went wrong processing that. Please try again.').catch(() => {});
  }
});

module.exports = bot;
