const { em } = require('../lib/emoji');
const gateway = require('../lib/gateway');
const store = require('../db/store');
const { showMenu } = require('../lib/ui');

async function findToken(ctx) {
  const text =
    `${em('5231200819986047254', '📊')} <b>Find Jetton Token</b>\n\n` +
    `Send the token name or symbol to search:\n\n<i>Example: CLAY, PNUTB, NOT, USDT</i>`;
  await showMenu(ctx, text, { inline_keyboard: [[{ text: 'Cancel', callback_data: '/dashboard' }]] });
  await store.setNextCommand(ctx.from.id, 'find_token_search');
}

function fmtSupply(raw, decimals) {
  try {
    const supply = Number(raw) / 10 ** Number(decimals);
    if (supply >= 1e9) return (supply / 1e9).toFixed(2) + 'B';
    if (supply >= 1e6) return (supply / 1e6).toFixed(2) + 'M';
    if (supply >= 1e3) return (supply / 1e3).toFixed(2) + 'K';
    return String(supply);
  } catch {
    return 'N/A';
  }
}

async function findTokenSearch(ctx) {
  const u = ctx.from.id;
  const query = (ctx.message.text || '').trim();

  if (!query) {
    await ctx.reply('❌ Please send a token name.');
    return store.setNextCommand(u, 'find_token_search');
  }

  const data = await gateway.findJettonMasters(query);
  if (!data) {
    return ctx.reply(`${em('5210952531676504517', '❌')} Search failed. Try again.`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Try Again', callback_data: '/find_token' }]] },
    });
  }

  const masters = data.jetton_masters || [];
  const addrbook = data.address_book || {};
  const metadata = data.metadata || {};

  if (!masters.length) {
    return ctx.reply(`${em('5420323339723881652', '⚠️')} No tokens found for <b>${query}</b>.\n\nTry a different name or symbol.`, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Search Again', callback_data: '/find_token' }],
          [{ text: 'Back', callback_data: '/dashboard' }],
        ],
      },
    });
  }

  const lines = masters.slice(0, 8).map((master) => {
    const rawAddr = master.address || '';
    const meta = metadata[rawAddr] || {};
    const tokenInfo = (meta.token_info || []).find((t) => t.type === 'jetton_masters') || {};
    const extra = tokenInfo.extra || {};
    const name = tokenInfo.name || 'Unknown';
    const symbol = tokenInfo.symbol || '???';
    const decimals = extra.decimals || '9';
    const friendly = (addrbook[rawAddr] || {}).user_friendly || rawAddr;
    const supplyStr = fmtSupply(master.total_supply || 0, decimals);

    return (
      `${em('5427009714745517609', '✅')} <b>${name}</b> (${symbol})\n` +
      `📋 Contract: <code>${friendly}</code>\n🔢 Decimals: <b>${decimals}</b>\n💰 Supply: <b>${supplyStr}</b>`
    );
  });

  const text =
    `${em('5231200819986047254', '📊')} <b>Results for "${query}"</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    lines.join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n') +
    `\n\n━━━━━━━━━━━━━━━━━━━━\n<i>Tap contract address to copy</i>`;

  return ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Search Again', callback_data: '/find_token' }],
        [{ text: 'Back', callback_data: '/dashboard' }],
      ],
    },
  });
}

module.exports = { findToken, findTokenSearch };
