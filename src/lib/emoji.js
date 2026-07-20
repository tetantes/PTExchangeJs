// Direct port of TPY's em() helper. Requires the bot owner's Telegram account
// to have Premium for custom emoji to render (falls back to the plain emoji
// character for everyone else automatically - no extra handling needed).
function em(emojiId, fallback) {
  return `<tg-emoji emoji-id="${emojiId}">${fallback}</tg-emoji>`;
}

module.exports = { em };
