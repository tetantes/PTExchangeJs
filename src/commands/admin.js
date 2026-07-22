const { em } = require('../lib/emoji');
const store = require('../db/store');
const { editOrSend } = require('../lib/ui');
const config = require('../config');
const gate = require('../middleware/gate');

function isAdmin(userId) {
  return String(userId) === String(config.botAdminId);
}

async function admin(ctx) {
  const isCallback = !!ctx.callbackQuery;
  const u = ctx.from.id;
  if (!isAdmin(u)) return ctx.reply(`${em('5210952531676504517', '❌')} Admin only.`, { parse_mode: 'HTML' });

  if (isCallback) await ctx.answerCbQuery().catch(() => {});
  const chatId = ctx.chat.id;
  const msgId = isCallback ? ctx.callbackQuery.message.message_id : null;

  const [totalUsers, feePct, feeWallet, maintenance] = await Promise.all([
    store.countUsers(),
    store.getConfig('fee_percent', '0'),
    store.getConfig('fee_address', 'Not set'),
    store.getConfig('maintenance', 'off'),
  ]);

  const text =
    `${em('5427168083074628963', '💎')} <b>PTExchange Admin</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👥 Total Users: <b>${totalUsers}</b>\n` +
    `${em('5472030678633684592', '💸')} Fee: <b>${feePct}%</b>\n` +
    `${em('5264895611517300926', '🏦')} Fee Wallet: <code>${feeWallet.length > 20 ? feeWallet.slice(0, 20) + '...' : feeWallet}</code>\n` +
    `🔧 Maintenance: <b>${maintenance}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━`;

  const keyboard = {
    inline_keyboard: [
      [{ text: 'Set Fee %', callback_data: '/set_fee' }],
      [{ text: 'Set Fee Wallet', callback_data: '/set_fee_wallet' }],
      [{ text: 'Toggle Maintenance', callback_data: '/toggle_maintenance' }],
      [{ text: '📢 Broadcast', callback_data: '/broadcast' }],
      [{ text: 'View Users', callback_data: '/users' }],
    ],
  };

  if (msgId) return editOrSend(ctx, chatId, msgId, text, keyboard);
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

const PAGE_SIZE = 20;

function renderUserPage(users, page, totalUsers) {
  const totalPages = Math.max(1, Math.ceil(totalUsers / PAGE_SIZE));
  let text = `${em('5811989245761426317', '👥')} <b>Registered Users</b>\n\n`;
  text += `📊 Total: <b>${totalUsers}</b> users\n`;
  text += `📄 Page ${page + 1}/${totalPages}\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  users.forEach((user, i) => {
    const displayName = user.username ? `@${user.username}` : user.first_name || 'Unknown';
    const link = user.username ? `https://t.me/${user.username}` : `tg://user?id=${user.id}`;
    text += `${page * PAGE_SIZE + i + 1}. ${displayName}\n`;
    text += `   🆔 <code>${user.id}</code>\n`;
    text += `   💼 Wallet: ${user.has_wallet ? '✅' : '❌'}\n`;
    text += `   🔗 <a href="${link}">Profile Link</a>\n\n`;
  });

  const navButtons = [];
  if (page > 0) navButtons.push({ text: '◀️ Previous', callback_data: `/users_page ${page - 1}` });
  if (page < totalPages - 1) navButtons.push({ text: 'Next ▶️', callback_data: `/users_page ${page + 1}` });

  const keyboard = { inline_keyboard: [] };
  if (navButtons.length) keyboard.inline_keyboard.push(navButtons);
  keyboard.inline_keyboard.push([{ text: '🔙 Back to Admin', callback_data: '/admin' }]);

  return { text, keyboard };
}

async function users(ctx) {
  const u = ctx.from.id;
  if (!isAdmin(u)) return ctx.reply(`${em('5210952531676504517', '❌')} Admin only.`, { parse_mode: 'HTML' });

  const { rows: pageUsers, total: totalUsers } = await store.getUsersPageWithCount(0, PAGE_SIZE);
  if (!totalUsers) return ctx.reply('📭 No users found.');

  const { text, keyboard } = renderUserPage(pageUsers, 0, totalUsers);
  return ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard });
}

async function usersPage(ctx) {
  const u = ctx.from.id;
  if (!isAdmin(u)) return ctx.answerCbQuery('❌ Admin only', { show_alert: true });

  await ctx.answerCbQuery().catch(() => {});
  const page = parseInt((ctx.callbackQuery.data || '').split(' ')[1] || '0', 10);

  const { rows: pageUsers, total: totalUsers } = await store.getUsersPageWithCount(page * PAGE_SIZE, PAGE_SIZE);
  const { text, keyboard } = renderUserPage(pageUsers, page, totalUsers);

  return editOrSend(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id, text, keyboard);
}

async function toggleMaintenance(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  const current = await store.getConfig('maintenance', 'off');
  const next = current === 'on' ? 'off' : 'on';
  await store.setConfig('maintenance', next);
  gate.invalidateMaintenanceCache();
  await ctx.answerCbQuery(`Maintenance ${next}`, { show_alert: true }).catch(() => {});
  return admin(ctx);
}

async function fix(ctx) {
  await store.setConfig('maintenance', 'off');
  return ctx.reply('✅ <b>Maintenance mode turned OFF.</b>', { parse_mode: 'HTML' });
}

async function setFee(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    `${em('5472030678633684592', '💸')} <b>Set Fee Percentage</b>\n\nSend the % fee per transaction.\n\n<i>Example: 2 (for 2%)</i>`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Cancel', callback_data: '/admin' }]] } }
  );
  await store.setNextCommand(ctx.from.id, 'save_fee');
}

async function saveFee(ctx) {
  const val = parseFloat((ctx.message.text || '').trim());
  if (Number.isNaN(val)) return ctx.reply('❌ Invalid. Send a number like 2');
  await store.setConfig('fee_percent', val);
  return ctx.reply(`✅ Fee set to <b>${val}%</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Back', callback_data: '/admin' }]] } });
}

async function setFeeWallet(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    `${em('5264895611517300926', '🏦')} <b>Set Fee Wallet</b>\n\nSend your TON wallet address:`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Cancel', callback_data: '/admin' }]] } }
  );
  await store.setNextCommand(ctx.from.id, 'save_fee_wallet');
}

async function saveFeeWallet(ctx) {
  const wallet = (ctx.message.text || '').trim();
  if (!wallet.startsWith('EQ') && !wallet.startsWith('UQ')) return ctx.reply('❌ Invalid TON address.');
  await store.setConfig('fee_address', wallet);
  return ctx.reply(`✅ Fee wallet set to <code>${wallet}</code>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Back', callback_data: '/admin' }]] } });
}

module.exports = { admin, users, usersPage, toggleMaintenance, fix, setFee, saveFee, setFeeWallet, saveFeeWallet, isAdmin };
