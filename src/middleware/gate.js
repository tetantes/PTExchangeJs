const store = require('../db/store');
const config = require('../config');

// Maintenance mode is checked on EVERY message and callback - that was a
// Postgres round trip per update even though it changes maybe once a month.
// Cache it in memory for 10s; /toggle_maintenance in admin.js calls
// invalidate() so an admin flip takes effect immediately instead of waiting
// out the cache window.
let cached = { value: 'off', expiresAt: 0 };

async function getMaintenance() {
  if (Date.now() < cached.expiresAt) return cached.value;
  const value = await store.getConfig('maintenance', 'off');
  cached = { value, expiresAt: Date.now() + 10_000 };
  return value;
}

function invalidate() {
  cached.expiresAt = 0;
}

async function gate(ctx, next) {
  const u = ctx.from?.id;
  if (!u) return next();

  const maintenance = await getMaintenance();
  const isAdmin = String(u) === String(config.botAdminId);

  if (maintenance === 'on' && !isAdmin) {
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery('🚧 Bot under maintenance.', { show_alert: true }).catch(() => {});
    }
    return ctx.reply('🚧 <b>Bot under maintenance.</b>', { parse_mode: 'HTML' });
  }

  // Fire-and-forget: the handler downstream doesn't need to wait on this
  // write to know who the user is (only used for admin's /users list later).
  if (ctx.message && ctx.from) {
    store.upsertUser(u, { username: ctx.from.username, firstName: ctx.from.first_name }).catch(() => {});
  }

  return next();
}

module.exports = gate;
module.exports.invalidateMaintenanceCache = invalidate;
