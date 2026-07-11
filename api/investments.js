const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
  });
}
const db = admin.firestore();
const DOC = db.collection('anna_investments').doc('holdings');

const DEFAULT_ASSETS = [
  { symbol: 'NVDA', name: 'Nvidia', type: 'stock' },
  { symbol: 'GOOGL', name: 'Alphabet', type: 'stock' },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', type: 'stock' },
  { symbol: 'BTC', name: 'Bitcoin', type: 'crypto' },
  { symbol: 'ETH', name: 'Ethereum', type: 'crypto' },
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const snap = await DOC.get();
    if (!snap.exists) {
      return res.status(200).json({ items: DEFAULT_ASSETS.map(a => ({ ...a, quantity: 0, avgCost: 0 })) });
    }
    return res.status(200).json(snap.data());
  }

  if (req.method === 'POST') {
    const { items } = req.body || {};
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });
    await DOC.set({ items, updatedAt: Date.now() });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
