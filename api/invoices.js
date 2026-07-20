const { db } = require('../lib/firebase');

function withDaysOverdue(inv) {
  const today = new Date().toISOString().split('T')[0];
  const daysOverdue = inv.status === 'unpaid' && inv.dueDate && inv.dueDate < today
    ? Math.floor((new Date(today) - new Date(inv.dueDate)) / 86400000)
    : 0;
  return { ...inv, daysOverdue };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { status } = req.query;
    let query = db.collection('anna_invoices');
    if (status) query = query.where('status', '==', status);
    const snap = await query.get();
    const invoices = snap.docs.map(d => withDaysOverdue(d.data()));
    invoices.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));
    return res.status(200).json(invoices);
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.client || !body.amount) {
      return res.status(400).json({ error: 'client and amount are required' });
    }
    const id = body.id || Date.now();
    const now = Date.now();
    const docRef = db.collection('anna_invoices').doc(String(id));
    const existing = await docRef.get();
    const invoice = {
      id,
      client: body.client,
      amount: body.amount,
      issueDate: body.issueDate || existing.data()?.issueDate || new Date().toISOString().split('T')[0],
      dueDate: body.dueDate ?? existing.data()?.dueDate ?? null,
      status: body.status || existing.data()?.status || 'unpaid',
      paidDate: body.paidDate ?? existing.data()?.paidDate ?? null,
      linkedEntryId: body.linkedEntryId ?? existing.data()?.linkedEntryId ?? null,
      notes: body.notes ?? existing.data()?.notes ?? '',
      followUpSentAt: body.followUpSentAt ?? existing.data()?.followUpSentAt ?? null,
      createdAt: existing.exists ? existing.data().createdAt : now,
    };
    await docRef.set(invoice);
    return res.status(200).json({ ok: true, invoice });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'missing id' });
    await db.collection('anna_invoices').doc(String(id)).delete();
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
