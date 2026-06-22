const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
  });
}
const db = admin.firestore();

// All entries are cached in a single Firestore document — 1 read per GET
// instead of 1 read per entry (was 1,400+ reads per poll).
const CACHE = db.collection('anna_meta').doc('entries_cache');

async function readCache() {
  const snap = await CACHE.get();
  return snap.exists ? (snap.data().entries || []) : null;
}

async function writeCache(entries) {
  await CACHE.set({ entries });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    let entries = await readCache();
    if (entries === null) {
      // One-time rebuild from individual docs (only runs if cache is missing)
      const snap = await db.collection('anna_tracker').get();
      entries = snap.docs.map(d => d.data());
      await writeCache(entries);
    }
    entries.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    return res.status(200).json(entries);
  }

  if (req.method === 'POST') {
    const entry = req.body;
    if (!entry.id) entry.id = Date.now();
    // Write to individual doc (source of truth) + update cache
    await db.collection('anna_tracker').doc(String(entry.id)).set(entry);
    const entries = (await readCache()) || [];
    const idx = entries.findIndex(e => String(e.id) === String(entry.id));
    if (idx >= 0) entries[idx] = entry;
    else entries.push(entry);
    await writeCache(entries);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'missing id' });
    await db.collection('anna_tracker').doc(String(id)).delete();
    const entries = (await readCache()) || [];
    await writeCache(entries.filter(e => String(e.id) !== String(id)));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
