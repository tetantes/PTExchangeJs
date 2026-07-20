const { em } = require('../lib/emoji');
const store = require('../db/store');

// Called right after a seed phrase is shown (generation or import). Picks 2
// random word positions and asks the user to type them back, so "I'll save
// it later" mistakes get caught immediately instead of discovered when it's
// too late.
async function startBackupConfirm(ctx, chatId, chain, mnemonic) {
  const words = mnemonic.split(' ');
  const u = ctx.from.id;

  const idx1 = Math.floor(Math.random() * words.length);
  let idx2 = Math.floor(Math.random() * words.length);
  while (idx2 === idx1) idx2 = Math.floor(Math.random() * words.length);
  const [a, b] = [idx1, idx2].sort((x, y) => x - y);

  await store.setSession(u, 'backup_confirm', { chain, a, b, wordA: words[a], wordB: words[b] }, 600);
  await store.setNextCommand(u, 'verify_backup');

  return ctx.telegram.sendMessage(
    chatId,
    `${em('5420323339723881652', '⚠️')} <b>Confirm You Saved It</b>\n\n` +
      `Before you continue, prove you saved the seed phrase.\n\n` +
      `Send word <b>#${a + 1}</b> and word <b>#${b + 1}</b>, separated by a space.\n\n` +
      `<i>Example: word${a + 1} word${b + 1}</i>`,
    { parse_mode: 'HTML' }
  );
}

async function verifyBackup(ctx) {
  const u = ctx.from.id;
  const input = (ctx.message.text || '').trim().toLowerCase().split(/\s+/);
  const pending = await store.getSession(u, 'backup_confirm');

  if (!pending) {
    return ctx.reply(`${em('5420323339723881652', '⚠️')} That confirmation expired. You can re-check your seed phrase anytime in Settings → Export Seed Phrase.`, { parse_mode: 'HTML' });
  }

  const [w1, w2] = input;
  const correct = w1 === pending.wordA.toLowerCase() && w2 === pending.wordB.toLowerCase();

  if (!correct) {
    await store.setNextCommand(u, 'verify_backup');
    return ctx.reply(`${em('5210952531676504517', '❌')} That doesn't match. Check your saved copy and try again:\n\nword #${pending.a + 1} word #${pending.b + 1}`, { parse_mode: 'HTML' });
  }

  await Promise.all([
    store.setBackupConfirmed(u, pending.chain, true),
    store.clearSession(u, 'backup_confirm'),
  ]);

  return ctx.reply(`${em('5427009714745517609', '✅')} Backup confirmed. Your wallet is ready to use.`, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'Go to Dashboard', callback_data: '/dashboard' }]] },
  });
}

module.exports = { startBackupConfirm, verifyBackup };
