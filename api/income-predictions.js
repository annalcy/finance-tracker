// Read-only feed for the dashboard's predicted-income widget. Writes only
// happen from productivity-system's Telegram bot (lib/incomePredictions.js) —
// this mirrors its calculation logic against the same shared Firestore
// project rather than importing across repos (separate Vercel deployments).
const { db } = require('../lib/firebase');

const STAGE_WEIGHTS = { likely: 0.5, confirmed: 0.7, paid: 1.0 };
const SAFE_TO_SPEND_BUFFER_PCT = 0.15;

function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}`;
}

function rawTotal(entries) {
  return entries.reduce((s, e) => s + (e.predicted_amount || 0), 0);
}
function riskAdjustedTotal(entries) {
  return entries.reduce((s, e) => s + (e.predicted_amount || 0) * (STAGE_WEIGHTS[e.stage] ?? 0), 0);
}
function stageBreakdown(entries) {
  const out = { likely: 0, confirmed: 0, paid: 0 };
  for (const e of entries) out[e.stage] = (out[e.stage] || 0) + (e.predicted_amount || 0);
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const month = (req.query.month || currentMonth()).toString();

    const predSnap = await db.collection('income_predictions').where('month', '==', month).get();
    const entries = predSnap.docs.map(d => d.data());

    const configSnap = await db.collection('anna_task_meta').doc('income_prediction_config').get();
    const config = (configSnap.exists ? configSnap.data() : {})[month] || { savings_target: 0, fixed_bills: 0 };

    const raw = rawTotal(entries);
    const adjusted = riskAdjustedTotal(entries);
    const buffer = Math.round(adjusted * SAFE_TO_SPEND_BUFFER_PCT);
    const safe = Math.round(adjusted - (config.savings_target || 0) - (config.fixed_bills || 0) - buffer);

    // Spending pace: actual expenses logged this month vs. a simple linear
    // day-of-month share of safe-to-spend.
    const cacheSnap = await db.collection('anna_meta').doc('entries_cache').get();
    const allEntries = cacheSnap.exists ? (cacheSnap.data().entries || []) : [];
    const spentThisMonth = allEntries
      .filter(e => e.type === 'expense' && e.date && e.date.startsWith(month))
      .reduce((s, e) => s + (e.amount || 0), 0);

    const { date: todayStr } = (() => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date());
      const get = t => parts.find(p => p.type === t).value;
      return { date: `${get('year')}-${get('month')}-${get('day')}` };
    })();
    const [y, m, d] = todayStr.split('-').map(Number);
    const isCurrentMonth = todayStr.startsWith(month);
    const dayOfMonth = isCurrentMonth ? d : new Date(Date.UTC(y, m, 0)).getUTCDate();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const expectedSpendToDate = Math.round(safe * (dayOfMonth / daysInMonth));
    const overPace = isCurrentMonth && safe > 0 && spentThisMonth > expectedSpendToDate;

    return res.status(200).json({
      month,
      entries,
      raw,
      adjusted: Math.round(adjusted),
      buffer,
      safe,
      breakdown: stageBreakdown(entries),
      config,
      pace: {
        spentThisMonth,
        expectedSpendToDate,
        overPace,
        dayOfMonth,
        daysInMonth,
        isCurrentMonth,
      },
    });
  } catch (err) {
    console.error('income-predictions fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
};
