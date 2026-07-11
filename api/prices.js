// Live price lookup for the investments view. Stocks come from Yahoo Finance's
// public (unofficial, no key needed) chart endpoint; crypto from CoinGecko's
// public API. Fetched server-side to avoid CORS issues calling these directly
// from the browser.
const STOCK_SYMBOLS = ['NVDA', 'GOOGL', 'VOO'];
const CRYPTO_IDS = { BTC: 'bitcoin', ETH: 'ethereum' };

async function fetchStock(symbol) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null;
    return { price: meta.regularMarketPrice, prevClose: meta.previousClose };
  } catch {
    return null;
  }
}

async function fetchCrypto() {
  try {
    const ids = Object.values(CRYPTO_IDS).join(',');
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
    return await r.json();
  } catch {
    return {};
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [stockResults, cryptoData] = await Promise.all([
      Promise.all(STOCK_SYMBOLS.map(async s => [s, await fetchStock(s)])),
      fetchCrypto(),
    ]);
    const prices = {};
    stockResults.forEach(([symbol, data]) => {
      if (data) prices[symbol] = { price: data.price, prevClose: data.prevClose };
    });
    Object.entries(CRYPTO_IDS).forEach(([symbol, id]) => {
      if (cryptoData[id]) prices[symbol] = { price: cryptoData[id].usd, change24h: cryptoData[id].usd_24h_change };
    });
    res.status(200).json({ prices, fetchedAt: Date.now() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
