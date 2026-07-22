const { em } = require('../lib/emoji');
const gateway = require('../lib/gateway');
const store = require('../db/store');
const cryptoLib = require('../lib/crypto');
const { showMenu, editOrSend, deleteSafe } = require('../lib/ui');
const { startBackupConfirm } = require('../lib/backupConfirm');
const { syncTonSubscription } = require('../lib/tonapiSubscribe');
const { friendlyToRaw } = require('../lib/tonAddress');

// ── Chain select ──

async function importWallet(ctx) {
  const text = `${em('5443127283898405358', '📥')} <b>Import Wallet</b>\n\nSelect chain:`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '💎 Import TON Wallet', callback_data: '/import_ton_wallet' }],
      [{ text: '🟡 Import BNB Wallet', callback_data: '/import_bnb_wallet' }],
      [{ text: 'Cancel', callback_data: '/dashboard' }],
    ],
  };
  return showMenu(ctx, text, keyboard);
}

// ── TON import ──

async function importTonWallet(ctx) {
  const text = `${em('5427168083074628963', '💎')} <b>Import TON Wallet</b>\n\nSelect version:`;
  const keyboard = {
    inline_keyboard: [
      [
        { text: 'V4', callback_data: '/import_wallet_v4' },
        { text: 'V5 (Latest)', callback_data: '/import_wallet_v5' },
      ],
      [{ text: 'Cancel', callback_data: '/import_wallet' }],
    ],
  };
  return showMenu(ctx, text, keyboard);
}

async function warnOrProceedImport(ctx, version, confirmCallback) {
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
      `Importing a new wallet will <b>REPLACE</b> your current wallet.\n\n` +
      `<b>Current wallet:</b>\n<code>${existing.address.slice(0, 30)}...</code>\n\n` +
      `<b>You will lose access to your current wallet unless you have saved its seed phrase.</b>\n\n` +
      `Are you sure you want to continue?`;
    return ctx.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Yes, Import New Wallet', callback_data: confirmCallback }],
          [{ text: '❌ No, Cancel', callback_data: '/dashboard' }],
        ],
      },
    });
  }

  await store.setSession(u, 'pending_version', version);
  return importWalletAsk(ctx);
}

const importWalletV4 = (ctx) => warnOrProceedImport(ctx, 'v4', '/confirm_import_v4');
const importWalletV5 = (ctx) => warnOrProceedImport(ctx, 'v5', '/confirm_import_v5');

async function confirmImport(ctx, version) {
  if (ctx.callbackQuery) {
    await Promise.all([

      ctx.answerCbQuery().catch(() => {}),

      deleteSafe(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id),

    ]);
  }
  await store.setSession(ctx.from.id, 'pending_version', version);
  return importWalletAsk(ctx);
}

const confirmImportV4 = (ctx) => confirmImport(ctx, 'v4');
const confirmImportV5 = (ctx) => confirmImport(ctx, 'v5');

async function importWalletAsk(ctx) {
  const u = ctx.from.id;
  const chatId = ctx.chat.id;
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

  const version = (await store.getSession(u, 'pending_version')) || 'v5';
  await ctx.telegram.sendMessage(
    chatId,
    `${em('5443127283898405358', '📥')} <b>Import ${version.toUpperCase()} Wallet</b>\n\n` +
      `Send your 24-word seed phrase:\n\n${em('5420323339723881652', '⚠️')} Delete your message after sending.`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Cancel', callback_data: '/dashboard' }]] } }
  );
  await store.setNextCommand(u, 'import_wallet_save');
}

async function importWalletSave(ctx) {
  const u = ctx.from.id;
  const chatId = ctx.chat.id;
  const mnemonic = (ctx.message.text || '').trim();

  await deleteSafe(ctx, chatId, ctx.message.message_id);

  const words = mnemonic.split(/\s+/);
  if (words.length !== 24) {
    return ctx.telegram.sendMessage(chatId, `${em('5210952531676504517', '❌')} Invalid seed phrase. Must be 24 words. Got ${words.length}.`, { parse_mode: 'HTML' });
  }

  const version = (await store.getSession(u, 'pending_version')) || 'v5';
  const apiKey = await store.getApiKey(u);
  if (!apiKey) {
    return ctx.telegram.sendMessage(chatId, `${em('5210952531676504517', '❌')} No API key found. Please use /start to register.`, { parse_mode: 'HTML' });
  }

  const loading = await ctx.telegram.sendMessage(chatId, '⏳ <b>Importing your wallet...</b>\n\nPlease wait while we connect to PTExchange API.', { parse_mode: 'HTML' });

  const data = await gateway.tonImportWallet(apiKey, mnemonic, version);
  if (!data.success) {
    return editOrSend(ctx, chatId, loading.message_id, `${em('5210952531676504517', '❌')} ${data.message || 'Invalid seed phrase'}`);
  }

  const { address, address_eq: addressEq } = data;
  // Note: TPY's original /import_wallet_save never encrypted+stored the mnemonic here,
  // which meant /export_seed silently failed for imported (not generated) TON wallets.
  // Filled that gap below.
  const encryptedMnemonic = cryptoLib.encrypt(mnemonic);
  let rawAddress = null;
  try { rawAddress = friendlyToRaw(address); } catch (e) { console.error('Address conversion failed:', e.message); }

  const { previousRawAddress } = await store.saveWallet(u, 'ton', { address, addressEq, rawAddress, version, encryptedMnemonic, importType: 'mnemonic' });
  syncTonSubscription(rawAddress, previousRawAddress).catch((e) => console.error('TonAPI sync error:', e.message));

  await deleteSafe(ctx, chatId, loading.message_id);

  await ctx.telegram.sendMessage(
    chatId,
    `${em('5427009714745517609', '✅')} <b>Wallet Imported!</b>\n\n${em('5427168083074628963', '💎')} Version: <b>${version.toUpperCase()}</b>\n\n` +
      `${em('5264895611517300926', '🏦')} <b>Address:</b>\n<code>${address}</code>\n\n${em('5231200819986047254', '🔑')} <b>API Key:</b>\n<code>${apiKey}</code>`,
    { parse_mode: 'HTML' }
  );

  return startBackupConfirm(ctx, chatId, 'ton', mnemonic);
}

// ── BSC import ──

async function importBnbWallet(ctx) {
  const u = ctx.from.id;
  const existing = await store.getWallet(u, 'bsc');

  let text, keyboard;
  if (existing?.address) {
    text =
      `${em('5420323339723881652', '⚠️')} <b>BNB Wallet Already Linked</b>\n\n${em('5264895611517300926', '🏦')} <b>Address:</b>\n<code>${existing.address}</code>\n\n` +
      `Importing a new wallet will <b>replace</b> your current one.\nAre you sure?`;
    keyboard = {
      inline_keyboard: [
        [{ text: '⚠️ Yes, Replace It', callback_data: '/import_bnb_wallet_ask' }],
        [{ text: 'Cancel', callback_data: '/dashboard' }],
      ],
    };
  } else {
    text =
      `${em('5443127283898405358', '📥')} <b>Import BNB Wallet</b>\n\nYou can import using a:\n` +
      `• <b>Seed phrase</b> (12 or 24 words)\n• <b>Private key</b> (0x…)\n\nSend your seed phrase or private key in the next message.`;
    keyboard = {
      inline_keyboard: [
        [{ text: 'Continue', callback_data: '/import_bnb_wallet_ask' }],
        [{ text: 'Cancel', callback_data: '/dashboard' }],
      ],
    };
  }
  return showMenu(ctx, text, keyboard);
}

async function importBnbWalletAsk(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  await ctx.telegram.sendMessage(
    ctx.chat.id,
    `${em('5443127283898405358', '📥')} <b>Import BNB Wallet</b>\n\nSend your <b>seed phrase</b> (12 or 24 words)\n` +
      `or <b>private key</b> (starts with 0x):\n\n${em('5420323339723881652', '⚠️')} Delete your message after sending.`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Cancel', callback_data: '/dashboard' }]] } }
  );
  await store.setNextCommand(ctx.from.id, 'import_bnb_wallet_preview');
}

async function importBnbWalletPreview(ctx) {
  const u = ctx.from.id;
  const chatId = ctx.chat.id;
  const input = (ctx.message.text || '').trim();
  await deleteSafe(ctx, chatId, ctx.message.message_id);

  const words = input.split(/\s+/);
  const isPrivkey = input.startsWith('0x') && input.length === 66;
  const isMnemonic = [12, 24].includes(words.length) && !input.startsWith('0x');

  if (!isPrivkey && !isMnemonic) {
    return ctx.telegram.sendMessage(chatId, `${em('5210952531676504517', '❌')} <b>Invalid input.</b>\n\nExpected a 12 or 24-word seed phrase, or a private key starting with <code>0x</code>.`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Try Again', callback_data: '/import_bnb_wallet_ask' }]] },
    });
  }

  const apiKey = await store.getApiKey(u);
  if (!apiKey) {
    return ctx.telegram.sendMessage(chatId, `${em('5210952531676504517', '❌')} <b>Account not set up.</b>\nPlease use /start to register first.`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Start', callback_data: '/start' }]] },
    });
  }

  const loading = await ctx.telegram.sendMessage(chatId, `${em('5397916757333654639', '⏳')} Verifying wallet...`, { parse_mode: 'HTML' });

  const walletData = await gateway.bscImportWallet(apiKey, isPrivkey ? { privateKey: input } : { mnemonic: input });
  if (!walletData.success) {
    return editOrSend(ctx, chatId, loading.message_id, `${em('5210952531676504517', '❌')} <b>Invalid wallet:</b> ${walletData.message || 'Unknown error'}`, {
      inline_keyboard: [[{ text: 'Try Again', callback_data: '/import_bnb_wallet_ask' }]],
    });
  }

  const { address, private_key: privKey, mnemonic = '', path = '' } = walletData;

  const balData = await gateway.bscBalance({ address });
  let assetsText;
  if (balData.success !== false && balData.bnb_balance !== undefined) {
    const lines = [`${em('5397916757333654639', '🔸')} <b>BNB:</b> ${Number(balData.bnb_balance).toFixed(6)}`];
    for (const t of balData.tokens || []) lines.push(`${em('5264895611517300926', '🪙')} <b>${t.symbol}:</b> ${Number(t.balance).toFixed(4)}`);
    assetsText = lines.join('\n');
  } else {
    assetsText = `${em('5420323339723881652', '⚠️')} Could not fetch balances.`;
  }

  await store.setSession(u, 'bnb_import_pending', { address, privateKey: privKey, mnemonic, path, inputType: isPrivkey ? 'privkey' : 'mnemonic' });

  return editOrSend(
    ctx, chatId, loading.message_id,
    `${em('5443127283898405358', '📥')} <b>Wallet Preview</b>\n\n${em('5264895611517300926', '🏦')} <b>Address:</b>\n<code>${address}</code>\n\n` +
      `${em('5427009714745517609', '📊')} <b>Assets:</b>\n${assetsText}\n\n━━━━━━━━━━━━━━━━━━━━\nConfirm to save this wallet.`,
    { inline_keyboard: [[{ text: '✦ Confirm & Save', callback_data: '/import_bnb_wallet_save' }], [{ text: 'Cancel', callback_data: '/dashboard' }]] }
  );
}

async function importBnbWalletSave(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  const u = ctx.from.id;
  const chatId = ctx.chat.id;
  const msgId = ctx.callbackQuery.message.message_id;

  const pending = await store.getSession(u, 'bnb_import_pending');
  if (!pending) return ctx.answerCbQuery('Session expired. Try again.', { show_alert: true });

  const apiKey = (await store.getApiKey(u)) || 'Not found';
  const { address, privateKey, mnemonic, path, inputType } = pending;

  const saveData = await gateway.bscImportWallet(apiKey, inputType === 'privkey' ? { privateKey } : { mnemonic });
  if (!saveData.success) {
    return editOrSend(ctx, chatId, msgId, `${em('5210952531676504517', '❌')} <b>Failed to save wallet:</b> ${saveData.message || 'Unknown error'}`, {
      inline_keyboard: [[{ text: 'Try Again', callback_data: '/import_bnb_wallet_ask' }]],
    });
  }

  const encryptedMnemonic = mnemonic ? cryptoLib.encrypt(mnemonic) : null;
  const encryptedPrivateKey = privateKey ? cryptoLib.encrypt(privateKey) : null;

  await store.saveWallet(u, 'bsc', { address, version: 'bsc', path, encryptedMnemonic, encryptedPrivateKey, importType: inputType });
  await store.clearSession(u, 'bnb_import_pending');

  if (inputType === 'mnemonic' && mnemonic) {
    await editOrSend(
      ctx, chatId, msgId,
      `${em('5427009714745517609', '✅')} <b>Wallet Imported!</b>\n\n${em('5264895611517300926', '🏦')} <b>Address:</b>\n<code>${address}</code>\n\n` +
        `${em('5231200819986047254', '🔑')} <b>API Key:</b>\n<code>${apiKey}</code>`
    );
    return startBackupConfirm(ctx, chatId, 'bsc', mnemonic);
  }

  return editOrSend(
    ctx, chatId, msgId,
    `${em('5427009714745517609', '✅')} <b>Wallet Imported!</b>\n\n${em('5264895611517300926', '🏦')} <b>Address:</b>\n<code>${address}</code>\n\n` +
      `${em('5231200819986047254', '🔑')} <b>API Key:</b>\n<code>${apiKey}</code>`,
    { inline_keyboard: [[{ text: 'Go to Dashboard', callback_data: '/dashboard' }]] }
  );
}

module.exports = {
  importWallet,
  importTonWallet,
  importWalletV4,
  importWalletV5,
  confirmImportV4,
  confirmImportV5,
  importWalletAsk,
  importWalletSave,
  importBnbWallet,
  importBnbWalletAsk,
  importBnbWalletPreview,
  importBnbWalletSave,
};
