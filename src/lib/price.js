const axios = require('axios');

let cache = { data: null, expiresAt: 0 };

// CoinGecko's free tier has its own rate limit, and prices don't need to be
// real-time for a "≈ $X" display - 60s cache means at most 1 outbound call
// per minute total, shared across every user viewing their dashboard.
async function getPrices() {
  if (Date.now() < cache.expiresAt && cache.data) return cache.data;

  try {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: { ids: 'the-open-network,binancecoin', vs_currencies: 'usd' },
      timeout: 8000,
    });
    const prices = {
      ton: data['the-open-network']?.usd ?? null,
      bnb: data['binancecoin']?.usd ?? null,
    };
    cache = { data: prices, expiresAt: Date.now() + 60_000 };
    return prices;
  } catch {
    // Fall back to the last known good prices rather than showing nothing,
    // if CoinGecko is briefly unavailable.
    return cache.data || { ton: null, bnb: null };
  }
}

function formatUsd(amount, unitPrice) {
  if (unitPrice === null || unitPrice === undefined) return '';
  const value = Number(amount) * unitPrice;
  if (!Number.isFinite(value)) return '';
  return ` <i>(≈ $${value.toFixed(2)})</i>`;
}

module.exports = { getPrices, formatUsd };
