const { em } = require('../lib/emoji');
const store = require('../db/store');
const { isAdmin } = require('./admin');
const { showMenu, editOrIgnore } = require('../lib/ui');

async function broadcastStart(ctx) {
  const u = ctx.from.id;
  if (!isAdmin(u)) return ctx.reply(`${em('5210952531676504517', '❌')} Admin only.`, { parse_mode: 'HTML' });

  await showMenu(
    ctx,
    `${em('5443127283898405358', '📢')} <b>Broadcast</b>\n\n` +
      `Send the message you want to broadcast now.\n\n` +
      `Supports HTML formatting, photos, videos, documents - anything you can send in Telegram. It'll be copied to every user exactly as you send it, with no "forwarded from" tag.`,
    { inline_keyboard: [[{ text: 'Cancel', callback_data: '/admin' }]] }
  );
  await store.setSession(u, 'awaiting_broadcast', true, 600);
}

// Called from bot.js's general message middleware (not the text-only
// next-command flow, since a broadcast can be a photo/video/poll/etc, not
// just text).
async function captureBroadcastMessage(ctx) {
  const u = ctx.from.id;
  await store.clearSession(u, 'awaiting_broadcast');

  const fromChatId = ctx.chat.id;
  const messageId = ctx.message.message_id;
  await store.setSession(u, 'pending_broadcast', { fromChatId, messageId }, 600);

  const totalUsers = await store.countUsers();

  await ctx.reply(
    `${em('5427009714745517609', '✅')} <b>Message captured.</b>\n\n` +
      `This will be sent to <b>${totalUsers}</b> users. Preview above ⬆️\n\nConfirm?`,
    {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [{ text: `✅ Send to ${totalUsers} users`, callback_data: '/broadcast_confirm' }],
          [{ text: 'Cancel', callback_data: '/admin' }],
        ],
      },
    }
  );
}

async function broadcastConfirm(ctx) {
  const u = ctx.from.id;
  if (!isAdmin(u)) return ctx.answerCbQuery('❌ Admin only', { show_alert: true });
  await ctx.answerCbQuery().catch(() => {});

  const pending = await store.getSession(u, 'pending_broadcast');
  if (!pending) {
    return ctx.reply(`${em('5420323339723881652', '⚠️')} That broadcast expired. Start again with /broadcast.`, { parse_mode: 'HTML' });
  }
  await store.clearSession(u, 'pending_broadcast');

  const userIds = await store.getAllUserIds();
  const total = userIds.length;

  const statusMsg = await ctx.reply(`${em('5443127283898405358', '📢')} <b>Broadcasting...</b>\n\n0 / ${total} sent`, { parse_mode: 'HTML' });

  let sent = 0;
  let failed = 0;
  const failedReasons = {};

  for (const userId of userIds) {
    try {
      await ctx.telegram.copyMessage(userId, pending.fromChatId, pending.messageId);
      sent++;
    } catch (err) {
      failed++;
      const reason = err.description || err.message || 'unknown';
      failedReasons[reason] = (failedReasons[reason] || 0) + 1;
    }

    // Telegram allows roughly 30 messages/sec to different chats - this
    // keeps us comfortably under that instead of firing all at once.
    await new Promise((r) => setTimeout(r, 35));

    if ((sent + failed) % 20 === 0) {
      await editOrIgnore(
        ctx, ctx.chat.id, statusMsg.message_id,
        `${em('5443127283898405358', '📢')} <b>Broadcasting...</b>\n\n${sent + failed} / ${total} sent`
      );
    }
  }

  const reasonLines = Object.entries(failedReasons)
    .map(([reason, count]) => `  • ${reason}: ${count}`)
    .join('\n');

  await editOrIgnore(
    ctx, ctx.chat.id, statusMsg.message_id,
    `${em('5427009714745517609', '✅')} <b>Broadcast Complete</b>\n\n` +
      `👥 Total: <b>${total}</b>\n${em('5427009714745517609', '✅')} Delivered: <b>${sent}</b>\n${em('5210952531676504517', '❌')} Failed: <b>${failed}</b>` +
      (reasonLines ? `\n\n<i>Failure reasons:</i>\n${reasonLines}` : '')
  );
}

module.exports = { broadcastStart, captureBroadcastMessage, broadcastConfirm };
