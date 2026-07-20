const { db } = require('../lib/firebase');
const { computeGoalProgress, currentYearMonth } = require('../lib/goalCalc');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const progress = await computeGoalProgress();
    if (!progress) return res.status(404).json({ error: 'No income goal set for this year' });
    return res.status(200).json(progress);
  }

  if (req.method === 'POST') {
    const { annualGoal, monthlyTarget, year } = req.body || {};
    if (!annualGoal || !monthlyTarget) {
      return res.status(400).json({ error: 'annualGoal and monthlyTarget are required' });
    }
    const targetYear = year || currentYearMonth().year;
    const docRef = db.collection('anna_income_goals').doc(String(targetYear));
    const existing = await docRef.get();
    const now = Date.now();
    await docRef.set({
      annualGoal,
      monthlyTarget,
      milestones: existing.exists ? (existing.data().milestones || {}) : { 25: false, 50: false, 75: false, 100: false },
      createdAt: existing.exists ? existing.data().createdAt : now,
      updatedAt: now,
    });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
