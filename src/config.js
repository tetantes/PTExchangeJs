require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

module.exports = {
  botToken: required('BOT_TOKEN'),
  webhookUrl: required('WEBHOOK_URL'),
  webhookSecret: process.env.WEBHOOK_SECRET || 'change-me',
  databaseUrl: required('DATABASE_URL'),

  tonApiUrl: process.env.TON_API_URL || 'https://ptexchange-api.vercel.app',
  bscApiUrl: process.env.BSC_API_URL || 'https://pt-kappa-ten.vercel.app',
  gatewayKey: required('GATEWAY_KEY'),
  toncenterKey: process.env.TONCENTER_API_KEY || '',
  depositWebhookSecret: process.env.DEPOSIT_WEBHOOK_SECRET || '',
  tonapiKey: process.env.TONAPI_KEY || '',
  // Random path segment so the TonAPI webhook URL can't be guessed/spoofed -
  // TonAPI's webhook contract has no shared-secret header, so this is the
  // equivalent protection: only Telegram-style "secret in the URL" is possible.
  tonapiWebhookToken: process.env.TONAPI_WEBHOOK_TOKEN || '',

  encryptionKey: required('ENCRYPTION_KEY'), // 64 hex chars = 32 bytes

  botAdminId: process.env.BOT_ADMIN_ID || '6011460052',

  port: process.env.PORT || 3000,
};
