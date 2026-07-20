// Centralizes the edit-don't-send preference. Every command handler calls
// showMenu() instead of ctx.reply() directly.
//
// Behavior:
// - Callback query (button tap): try editMessageText on the tapped message.
//   If that fails (e.g. original was a media message), delete + send fresh.
// - Plain "/command" message: delete the user's command message (keeps the
//   chat clean) then send a fresh message, since there's nothing to edit yet.

async function showMenu(ctx, text, keyboard = undefined) {
  const extra = { parse_mode: 'HTML', disable_web_page_preview: true };
  if (keyboard) extra.reply_markup = keyboard;

  if (ctx.callbackQuery) {
    try {
      await ctx.answerCbQuery().catch(() => {});
      return await ctx.editMessageText(text, extra);
    } catch {
      try {
        await ctx.deleteMessage().catch(() => {});
      } catch {}
      return ctx.reply(text, extra);
    }
  }

  // Plain message trigger (e.g. /dashboard typed directly)
  try {
    await ctx.deleteMessage().catch(() => {});
  } catch {}
  return ctx.reply(text, extra);
}

// For cases where TBC always used sendMessage regardless (loading states that
// get deleted right after, or the final "here's your seed phrase" message).
async function sendFresh(ctx, chatId, text, keyboard = undefined) {
  const extra = { parse_mode: 'HTML', disable_web_page_preview: true };
  if (keyboard) extra.reply_markup = keyboard;
  return ctx.telegram.sendMessage(chatId, text, extra);
}

async function editOrSend(ctx, chatId, messageId, text, keyboard = undefined) {
  const extra = { parse_mode: 'HTML', disable_web_page_preview: true };
  if (keyboard) extra.reply_markup = keyboard;
  try {
    return await ctx.telegram.editMessageText(chatId, messageId, undefined, text, extra);
  } catch {
    return ctx.telegram.sendMessage(chatId, text, extra);
  }
}

async function deleteSafe(ctx, chatId, messageId) {
  try {
    await ctx.telegram.deleteMessage(chatId, messageId);
  } catch {}
}

module.exports = { showMenu, sendFresh, editOrSend, deleteSafe };
