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

// For progressive/incremental renders (dashboard's staged loading, etc.)
// where the same message gets edited multiple times in quick succession.
// Telegram throws "message is not modified" if the new text is identical to
// what's already there (e.g. two data sources resolve to the same rendered
// text) - that's not a real failure and should just be ignored, NOT trigger
// a fallback to sending a brand new duplicate message like editOrSend does.
async function editOrIgnore(ctx, chatId, messageId, text, keyboard = undefined) {
  const extra = { parse_mode: 'HTML', disable_web_page_preview: true };
  if (keyboard) extra.reply_markup = keyboard;
  try {
    return await ctx.telegram.editMessageText(chatId, messageId, undefined, text, extra);
  } catch (err) {
    if (err.description?.includes('message is not modified')) return null;
    console.error('editOrIgnore failed:', err.description || err.message);
    return null;
  }
}

async function deleteSafe(ctx, chatId, messageId) {
  try {
    await ctx.telegram.deleteMessage(chatId, messageId);
  } catch {}
}

module.exports = { showMenu, sendFresh, editOrSend, editOrIgnore, deleteSafe };
