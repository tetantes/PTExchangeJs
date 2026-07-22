const { em } = require('../lib/emoji');
const gateway = require('../lib/gateway');
const store = require('../db/store');
const cryptoLib = require('../lib/crypto');
const { showMenu, editOrSend, deleteSafe } = require('../lib/ui');
const { startBackupConfirm } = require('../lib/backupConfirm');
const { syncTonSubscription } = require('../lib/tonapiSubscribe');
const { friendlyToRaw } = require('../lib/tonAddress');

async function generateWallet(ctx) {
  const text = `${em('5397916757333654639', '➕')} <b>Generate Wallet</b>\n\nSelect chain:`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '💎 TON Wallet', callback_data: '/generate_ton_wallet' }],
      [{ text: '🟡 BNB / BSC Wallet', callback_data: '/generate_bnb_wallet' }],
      [{ text: 'Cancel', callback_data: '/dashboard' }],
    ],
  };
  return showMenu(ctx, text, keyboard);
}

async function generateTonWallet(ctx) {
  const text = `${em('5427168083074628963', '💎')} <b>Generate TON Wallet</b>\n\nSelect the wallet version you want to create:`;
  const keyboard = {
    inline_keyboard: [
      [
        { text: 'V4 (Standard)', callback_data: '/generate_wallet_v4' },
        { text: 'V5 (W5)', callback_data: '/generate_wallet_v5' },
      ],
      [{ text: 'Cancel', callback_data: '/dashboard' }],
    ],
  };
  return showMenu(ctx, text, keyboard);
}

async function warnOrProceed(ctx, version, confirmCallback) {
  const u = ctx.from.id;
  const chatId = ctx.chat.id;

  if (ctx.callbackQuery) {
    await Promise.all([

      ctx.answerCbQuery().catch(() => {}),

      deleteSafe(ctx, chatId, ctx.callbackQuery.message.message_id),

    ]);
  }

  const existing = await store.getWallet(u, 'ton');
  if (existing?.address) {
    const text =
      `${em('5420323339723881652', '⚠️')} <b>WARNING: You already have a wallet!</b>\n\n` +
      `Generating a new wallet will <b>REPLACE</b> your current wallet.\n\n` +
      `<b>Current wallet:</b>\n<code>${existing.address.slice(0, 30)}...</code>\n\n` +
      `<b>You will lose access to your current wallet unless you have saved its seed phrase.</b>\n\n` +
      `Are you sure you want to continue?`;
    return ctx.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Yes, Generate New Wallet', callback_data: confirmCallback }],
          [{ text: '❌ No, Cancel', callback_data: '/dashboard' }],
        ],
      },
    });
  }

  await store.setSession(u, 'pending_version', version);
  return generateWalletExec(ctx);
}

const generateWalletV4 = (ctx) => warnOrProceed(ctx, 'v4', '/confirm_generate_v4');
const generateWalletV5 = (ctx) => warnOrProceed(ctx, 'v5', '/confirm_generate_v5');

async function confirmGenerate(ctx, version) {
  if (ctx.callbackQuery) {
    await Promise.all([

      ctx.answerCbQuery().catch(() => {}),

      deleteSafe(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id),

    ]);
  }
  await store.setSession(ctx.from.id, 'pending_version', version);
  return generateWalletExec(ctx);
}

const confirmGenerateV4 = (ctx) => confirmGenerate(ctx, 'v4');
const confirmGenerateV5 = (ctx) => confirmGenerate(ctx, 'v5');

async function generateWalletExec(ctx) {
  const isCallback = !!ctx.callbackQuery;
  const u = ctx.from.id;
  const chatId = ctx.chat.id;

  const apiKey = await store.getApiKey(u);
  if (!apiKey) {
    return ctx.telegram.sendMessage(chatId, `${em('5210952531676504517', '❌')} No API key found. Please use /start to register.`, { parse_mode: 'HTML' });
  }

  const version = (await store.getSession(u, 'pending_version')) || 'v5';
  const loadingText = '⏳ <b>Generating your wallet...</b>\n\nPlease wait while we connect to PTExchange API.';
  const loading = isCallback
    ? await ctx.telegram.editMessageText(chatId, ctx.callbackQuery.message.message_id, undefined, loadingText, { parse_mode: 'HTML' }).catch(() => ctx.telegram.sendMessage(chatId, loadingText, { parse_mode: 'HTML' }))
    : await ctx.telegram.sendMessage(chatId, loadingText, { parse_mode: 'HTML' });
  const loadingMsgId = loading.message_id;

  const data = await gateway.tonGenerateWallet(apiKey, version);
  if (!data.success) {
    return editOrSend(ctx, chatId, loadingMsgId, `${em('5210952531676504517', '❌')} ${data.message || 'Error'}`);
  }

  const { address, address_eq: addressEq, mnemonic } = data;
  const encryptedMnemonic = cryptoLib.encrypt(mnemonic);

  let rawAddress = null;
  try { rawAddress = friendlyToRaw(address); } catch (e) { console.error('Address conversion failed:', e.message); }

  const { previousRawAddress } = await store.saveWallet(u, 'ton', { address, addressEq, rawAddress, version, encryptedMnemonic, importType: 'generated' });
  syncTonSubscription(rawAddress, previousRawAddress).catch((e) => console.error('TonAPI sync error:', e.message));
  await deleteSafe(ctx, chatId, loadingMsgId);

  const formatted = mnemonic.replace(/ /g, '\n');

  await ctx.telegram.sendMessage(
    chatId,
    `${em('5427009714745517609', '✅')} <b>Wallet Generated!</b>\n\n` +
      `${em('5427168083074628963', '💎')} Version: <b>${version.toUpperCase()}</b>\n\n` +
      `${em('5264895611517300926', '🏦')} <b>Address:</b>\n<code>${address}</code>\n\n` +
      `${em('5231200819986047254', '🔑')} <b>API Key:</b>\n<code>${apiKey}</code>`,
    { parse_mode: 'HTML' }
  );

  await ctx.telegram.sendMessage(
    chatId,
    `${em('5956561916573782596', '📜')} <b>Seed Phrase</b>\n\n<tg-spoiler>${formatted}</tg-spoiler>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n${em('5420323339723881652', '⚠️')} <b>Save this safely. Never share it.</b>`,
    { parse_mode: 'HTML' }
  );

  return startBackupConfirm(ctx, chatId, 'ton', mnemonic);
}

async function generateBnbWallet(ctx) {
  const text =
    `${em('5397916757333654639', '➕')} <b>Generate BNB Wallet</b>\n\n` +
    `This will create a new <b>BSC (BEP20)</b> wallet.\nYour seed phrase will be shown once — save it immediately.`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '✦ Generate Wallet', callback_data: '/generate_bnb_wallet_exec' }],
      [{ text: 'Cancel', callback_data: '/dashboard' }],
    ],
  };
  return showMenu(ctx, text, keyboard);
}

async function generateBnbWalletExec(ctx) {
  const isCallback = !!ctx.callbackQuery;
  const u = ctx.from.id;
  const chatId = ctx.chat.id;
  if (isCallback) await ctx.answerCbQuery().catch(() => {});

  const apiKey = await store.getApiKey(u);
  if (!apiKey) {
    return ctx.reply(`${em('5210952531676504517', '❌')} <b>Account not set up.</b>\nPlease use /start to register first.`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Start', callback_data: '/start' }]] },
    });
  }

  const msgId = isCallback ? ctx.callbackQuery.message.message_id : null;
  const loadingText = `⏳ Generating your BNB wallet...`;
  if (msgId) await editOrSend(ctx, chatId, msgId, loadingText);

  const data = await gateway.bscGenerateWallet(apiKey);
  if (!data.success) {
    return ctx.telegram.sendMessage(chatId, `${em('5210952531676504517', '❌')} <b>Error:</b> ${data.message || 'Unknown error'}`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Try Again', callback_data: '/generate_bnb_wallet_exec' }]] },
    });
  }

  const { address, mnemonic, private_key: privKey, path } = data;
  const encryptedMnemonic = cryptoLib.encrypt(mnemonic);
  const encryptedPrivateKey = cryptoLib.encrypt(privKey);

  await store.saveWallet(u, 'bsc', { address, version: 'bsc', path, encryptedMnemonic, encryptedPrivateKey, importType: 'generated' });

  const formattedSeed = mnemonic.replace(/ /g, '\n');

  await ctx.telegram.sendMessage(
    chatId,
    `${em('5427009714745517609', '✅')} <b>BNB Wallet Generated!</b>\n\n${em('5397916757333654639', '🔗')} Network: <b>BSC (BEP20)</b>\n\n` +
      `${em('5264895611517300926', '🏦')} <b>Address:</b>\n<code>${address}</code>\n\n${em('5231200819986047254', '🔑')} <b>API Key:</b>\n<code>${apiKey}</code>`,
    { parse_mode: 'HTML' }
  );

  await ctx.telegram.sendMessage(
    chatId,
    `${em('5956561916573782596', '📜')} <b>Seed Phrase</b>\n\n<tg-spoiler>${formattedSeed}</tg-spoiler>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n${em('5420323339723881652', '⚠️')} <b>Save this safely. Never share it.</b>`,
    { parse_mode: 'HTML' }
  );

  await ctx.telegram.sendMessage(
    chatId,
    `${em('5956561916573782596', '🔑')} <b>Private Key</b>\n\n<tg-spoiler><code>${privKey}</code></tg-spoiler>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n${em('5420323339723881652', '⚠️')} <b>Never share your private key with anyone.</b>`,
    { parse_mode: 'HTML' }
  );

  return startBackupConfirm(ctx, chatId, 'bsc', mnemonic);
}

module.exports = {
  generateWallet,
  generateTonWallet,
  generateWalletV4,
  generateWalletV5,
  confirmGenerateV4,
  confirmGenerateV5,
  generateWalletExec,
  generateBnbWallet,
  generateBnbWalletExec,
};
