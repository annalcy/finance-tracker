const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
  });
}
const db = admin.firestore();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const snap = await db.collection('anna_tracker').get();
    const entries = snap.docs.map(d => d.data());
    entries.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    return res.status(200).json(entries);
  }

  if (req.method === 'POST') {
    const entry = req.body;
    if (!entry.id) entry.id = Date.now();
    await db.collection('anna_tracker').doc(String(entry.id)).set(entry);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'missing id' });
    await db.collection('anna_tracker').doc(String(id)).delete();
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
