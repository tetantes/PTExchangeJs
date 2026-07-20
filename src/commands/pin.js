const { em } = require('../lib/emoji');
const store = require('../db/store');
const pinLib = require('../lib/pin');
const { showMenu, deleteSafe } = require('../lib/ui');

// Actions that require a PIN, and what to call after a correct entry.
// Registered by whichever command file owns that action, to avoid a
// require() cycle (pin.js would otherwise have to require settings.js and
// vice versa).
const gatedActions = {};
function registerGatedAction(name, handler) {
  gatedActions[name] = handler;
}

async function setPinAsk(ctx) {
  await showMenu(
    ctx,
    `${em('5197288647275071607', '🔐')} <b>Set a PIN</b>\n\nChoose a 4-digit PIN. You'll need to enter it every time you view a seed phrase or private key.\n\nSend it now:`,
    { inline_keyboard: [[{ text: 'Cancel', callback_data: '/settings' }]] }
  );
  await store.setNextCommand(ctx.from.id, 'set_pin_save');
}

async function setPinSave(ctx) {
  const u = ctx.from.id;
  const chatId = ctx.chat.id;
  const pin = (ctx.message.text || '').trim();
  await deleteSafe(ctx, chatId, ctx.message.message_id);

  if (!/^\d{4}$/.test(pin)) {
    await ctx.reply(`${em('5210952531676504517', '❌')} PIN must be exactly 4 digits.`, { parse_mode: 'HTML' });
    await store.setNextCommand(u, 'set_pin_save');
    return;
  }

  const { hash, salt } = pinLib.hashPin(pin);
  await store.setPin(u, hash, salt);

  return ctx.reply(`${em('5427009714745517609', '✅')} PIN set. You'll be asked for it before viewing any seed phrase or private key.`, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'Back to Settings', callback_data: '/settings' }]] },
  });
}

// Call this from any command that reveals sensitive data instead of running
// directly - e.g. bot.action('/export_seed', (ctx) => requirePin(ctx, 'export_seed'))
async function requirePin(ctx, actionName) {
  const u = ctx.from.id;
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

  const pinRow = await store.getPin(u);
  if (!pinRow?.pin_hash) {
    return showMenu(
      ctx,
      `${em('5420323339723881652', '⚠️')} <b>Set a PIN first</b>\n\nTo protect your seed phrases and private keys, set a 4-digit PIN before viewing them.`,
      { inline_keyboard: [[{ text: 'Set PIN Now', callback_data: '/set_pin' }], [{ text: 'Cancel', callback_data: '/settings' }]] }
    );
  }

  await store.setSession(u, 'pending_pin_action', actionName, 120);
  await showMenu(
    ctx,
    `${em('5197288647275071607', '🔐')} Enter your 4-digit PIN to continue:`,
    { inline_keyboard: [[{ text: 'Cancel', callback_data: '/settings' }]] }
  );
  await store.setNextCommand(u, 'verify_pin');
}

async function verifyPin(ctx) {
  const u = ctx.from.id;
  const chatId = ctx.chat.id;
  const pin = (ctx.message.text || '').trim();
  await deleteSafe(ctx, chatId, ctx.message.message_id);

  const [pinRow, actionName] = await Promise.all([
    store.getPin(u),
    store.getSession(u, 'pending_pin_action'),
  ]);

  if (!actionName) {
    return ctx.reply(`${em('5420323339723881652', '⚠️')} That request expired. Please try again.`, { parse_mode: 'HTML' });
  }

  const correct = pinRow?.pin_hash && pinLib.verifyPin(pin, pinRow.pin_hash, pinRow.pin_salt);
  if (!correct) {
    await store.setNextCommand(u, 'verify_pin'); // let them retry immediately
    return ctx.reply(`${em('5210952531676504517', '❌')} Incorrect PIN. Try again:`, { parse_mode: 'HTML' });
  }

  await store.clearSession(u, 'pending_pin_action');
  const handler = gatedActions[actionName];
  if (!handler) return ctx.reply(`${em('5210952531676504517', '❌')} Unknown action.`, { parse_mode: 'HTML' });
  return handler(ctx);
}

module.exports = { setPinAsk, setPinSave, requirePin, verifyPin, registerGatedAction };
