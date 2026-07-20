const { em } = require('../lib/emoji');
const gateway = require('../lib/gateway');
const store = require('../db/store');
const { showMenu, editOrSend } = require('../lib/ui');
const { rateLimited } = require('../lib/rateLimit');
const { notifyWithdrawal } = require('../lib/notify');

async function sendMenu(ctx) {
  const text = `${em('5445355530111437729', '📤')} <b>Send</b>\n\nSelect chain:`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '💎 Send TON', callback_data: '/send_ton' }],
      [{ text: '🟡 Send BNB', callback_data: '/send_bnb' }],
      [{ text: 'Cancel', callback_data: '/dashboard' }],
    ],
  };
  return showMenu(ctx, text, keyboard);
}

async function startSend(ctx, chain) {
  const u = ctx.from.id;
  const wallet = await store.getWallet(u, chain);
  if (!wallet?.address) {
    return showMenu(ctx, `${em('5420323339723881652', '⚠️')} No ${chain.toUpperCase()} wallet connected yet.`, {
      inline_keyboard: [[{ text: 'Back', callback_data: '/send' }]],
    });
  }

  await store.setSession(u, 'send_flow', { chain }, 300);
  await showMenu(
    ctx,
    `${em('5445355530111437729', '📤')} <b>Send ${chain.toUpperCase()}</b>\n\nEnter the destination address:`,
    { inline_keyboard: [[{ text: 'Cancel', callback_data: '/dashboard' }]] }
  );
  await store.setNextCommand(u, 'send_address');
}

const startSendTon = (ctx) => startSend(ctx, 'ton');
const startSendBnb = (ctx) => startSend(ctx, 'bsc');

async function sendAddress(ctx) {
  const u = ctx.from.id;
  const address = (ctx.message.text || '').trim();
  const flow = await store.getSession(u, 'send_flow');
  if (!flow) return ctx.reply(`${em('5420323339723881652', '⚠️')} Session expired. Start again with /send.`, { parse_mode: 'HTML' });

  const validTon = flow.chain === 'ton' && (address.startsWith('EQ') || address.startsWith('UQ'));
  const validBsc = flow.chain === 'bsc' && address.startsWith('0x') && address.length === 42;
  if (!validTon && !validBsc) {
    await ctx.reply(`${em('5210952531676504517', '❌')} That doesn't look like a valid ${flow.chain.toUpperCase()} address. Try again:`, { parse_mode: 'HTML' });
    return store.setNextCommand(u, 'send_address');
  }

  await store.setSession(u, 'send_flow', { ...flow, address }, 300);
  await ctx.reply(`${em('5472030678633684592', '💸')} Enter the amount to send:`, { parse_mode: 'HTML' });
  await store.setNextCommand(u, 'send_amount');
}

async function sendAmount(ctx) {
  const u = ctx.from.id;
  const amount = parseFloat((ctx.message.text || '').trim());
  const flow = await store.getSession(u, 'send_flow');
  if (!flow?.address) return ctx.reply(`${em('5420323339723881652', '⚠️')} Session expired. Start again with /send.`, { parse_mode: 'HTML' });

  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply(`${em('5210952531676504517', '❌')} Enter a valid positive number:`, { parse_mode: 'HTML' });
    return store.setNextCommand(u, 'send_amount');
  }

  await store.setSession(u, 'send_flow', { ...flow, amount }, 300);

  const short = flow.address.length > 16 ? flow.address.slice(0, 8) + '...' + flow.address.slice(-8) : flow.address;
  const text =
    `${em('5445355530111437729', '📤')} <b>Confirm Send</b>\n\n` +
    `Chain: <b>${flow.chain.toUpperCase()}</b>\n` +
    `To: <code>${short}</code>\n` +
    `Amount: <b>${amount} ${flow.chain === 'ton' ? 'TON' : 'BNB'}</b>\n\n` +
    `${em('5420323339723881652', '⚠️')} This cannot be undone. Confirm?`;

  return ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Confirm & Send', callback_data: '/send_confirm' }],
        [{ text: '❌ Cancel', callback_data: '/dashboard' }],
      ],
    },
  });
}

async function sendConfirm(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  const u = ctx.from.id;
  const chatId = ctx.chat.id;
  const msgId = ctx.callbackQuery.message.message_id;

  if (await rateLimited(ctx, 'send_money', 15)) return;

  const flow = await store.getSession(u, 'send_flow');
  if (!flow?.amount) {
    return editOrSend(ctx, chatId, msgId, `${em('5420323339723881652', '⚠️')} Session expired. Start again with /send.`);
  }

  const apiKey = await store.getApiKey(u);
  if (!apiKey) {
    return editOrSend(ctx, chatId, msgId, `${em('5210952531676504517', '❌')} No API key found.`);
  }

  await editOrSend(ctx, chatId, msgId, '⏳ <b>Sending...</b>');

  const data = flow.chain === 'ton'
    ? await gateway.payTon(apiKey, flow.address, flow.amount, 'Sent via PTExchange bot')
    : await gateway.payBnb(apiKey, flow.address, flow.amount);

  await store.clearSession(u, 'send_flow');

  if (!data.success) {
    return editOrSend(ctx, chatId, msgId, `${em('5210952531676504517', '❌')} <b>Send failed:</b> ${data.message || 'Unknown error'}`, {
      inline_keyboard: [[{ text: 'Back', callback_data: '/dashboard' }]],
    });
  }

  await store.incrementTxStats(u, flow.amount);

  const chainLabel = flow.chain === 'ton' ? 'TON' : 'BNB';
  const txLink = data.tx_link || (data.tx_hash && flow.chain === 'bsc' ? `https://bscscan.com/tx/${data.tx_hash}` : null);

  await editOrSend(
    ctx, chatId, msgId,
    `${em('5427009714745517609', '✅')} <b>Sent!</b>\n\n${flow.amount} ${chainLabel} sent successfully.` + (txLink ? `\n\n🔗 <a href="${txLink}">View Transaction</a>` : ''),
    { inline_keyboard: [[{ text: 'Back to Dashboard', callback_data: '/dashboard' }]] }
  );

  await notifyWithdrawal(ctx.telegram, u, { amount: flow.amount, toAddress: flow.address, txLink, chain: chainLabel });
}

module.exports = { sendMenu, startSendTon, startSendBnb, sendAddress, sendAmount, sendConfirm };
