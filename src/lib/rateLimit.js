const store = require('../db/store');
const { em } = require('./emoji');

// Wraps store.checkRateLimit with a ready-to-send message, so call sites just
// do: const blocked = await rateLimited(ctx, 'regenerate_key', 300); if (blocked) return;
async function rateLimited(ctx, action, cooldownSeconds) {
  const { allowed, retryAfterSeconds } = await store.checkRateLimit(ctx.from.id, action, cooldownSeconds);
  if (allowed) return false;

  const msg = `${em('5420323339723881652', '⚠️')} Please wait ${retryAfterSeconds}s before trying that again.`;
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery(msg, { show_alert: true }).catch(() => {});
  } else {
    await ctx.reply(msg, { parse_mode: 'HTML' });
  }
  return true;
}

module.exports = { rateLimited };
