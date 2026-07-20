const { em } = require('../lib/emoji');
const store = require('../db/store');

async function notifyDeposit(telegram, userId, { amount, comment, txLink, newBalance, chain = 'TON' }) {
  const prefs = await store.getNotifyPrefs(userId);
  if (!prefs.notify_deposits) return;

  let text =
    `${em('5443127283898405358', '📥')} <b>Deposit Received!</b>\n\n` +
    `${em('5472030678633684592', '💸')} Amount: <b>+${amount} ${chain}</b>\n` +
    `${em('5210956306952758910', '💰')} New Balance: <b>${newBalance} ${chain}</b>\n`;
  if (comment) text += `💬 Comment: <i>${comment}</i>\n`;
  if (txLink) text += `\n🔗 <a href="${txLink}">View Transaction</a>`;

  await telegram.sendMessage(userId, text, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: 'View Dashboard', callback_data: '/dashboard' }],
        [{ text: '🔕 Disable deposit alerts', callback_data: '/toggle_notify_deposits' }],
      ],
    },
  }).catch(() => {});
}

async function notifyWithdrawal(telegram, userId, { amount, toAddress, txLink, chain = 'TON' }) {
  const prefs = await store.getNotifyPrefs(userId);
  if (!prefs.notify_withdrawals) return;

  const short = toAddress.length > 16 ? toAddress.slice(0, 8) + '...' + toAddress.slice(-8) : toAddress;
  let text =
    `${em('5445355530111437729', '📤')} <b>Withdrawal Sent</b>\n\n` +
    `${em('5472030678633684592', '💸')} Amount: <b>-${amount} ${chain}</b>\n` +
    `${em('5264895611517300926', '🏦')} To: <code>${short}</code>\n`;
  if (txLink) text += `\n🔗 <a href="${txLink}">View Transaction</a>`;

  await telegram.sendMessage(userId, text, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: 'View Dashboard', callback_data: '/dashboard' }],
        [{ text: '🔕 Disable withdrawal alerts', callback_data: '/toggle_notify_withdrawals' }],
      ],
    },
  }).catch(() => {});
}

module.exports = { notifyDeposit, notifyWithdrawal };
