const { db } = require('./firebase');

function currentYearMonth(d = new Date()) {
  return { year: String(d.getFullYear()), ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` };
}

function weeksLeftInMonth(d = new Date()) {
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(0, lastDay - d.getDate());
  return Math.round((daysLeft / 7) * 10) / 10;
}

const MILESTONE_THRESHOLDS = [25, 50, 75, 100];

// How much income should have been earned by today, given the month's target
// and how far through the month we are — used to detect "behind pace", not
// just "behind the finish line" at month-end.
function expectedByNow(monthlyTarget, d = new Date()) {
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Math.round(monthlyTarget * (d.getDate() / daysInMonth));
}

async function getEntriesFromCache() {
  const snap = await db.collection('anna_meta').doc('entries_cache').get();
  return snap.exists ? (snap.data().entries || []) : [];
}

async function getUnpaidInvoices() {
  const snap = await db.collection('anna_invoices').where('status', '==', 'unpaid').get();
  const today = new Date().toISOString().split('T')[0];
  return snap.docs.map(d => {
    const inv = d.data();
    const daysOverdue = inv.dueDate && inv.dueDate < today
      ? Math.floor((new Date(today) - new Date(inv.dueDate)) / 86400000)
      : 0;
    return { ...inv, daysOverdue };
  });
}

async function computeGoalProgress(entries) {
  const { year, ym } = currentYearMonth();
  const goalDoc = await db.collection('anna_income_goals').doc(year).get();
  if (!goalDoc.exists) return null;
  const goal = goalDoc.data();

  const allEntries = entries || await getEntriesFromCache();
  const monthIncome = allEntries.filter(e => e.type === 'income' && e.date && e.date.startsWith(ym));
  const earnedThisMonth = monthIncome.reduce((s, e) => s + (e.amount || 0), 0);
  const yearIncome = allEntries.filter(e => e.type === 'income' && e.date && e.date.startsWith(year));
  const earnedThisYear = yearIncome.reduce((s, e) => s + (e.amount || 0), 0);

  const monthlyTarget = goal.monthlyTarget;
  const remaining = Math.max(0, monthlyTarget - earnedThisMonth);
  const pctProgress = monthlyTarget > 0 ? Math.round((earnedThisMonth / monthlyTarget) * 100) : 0;
  const weeksLeft = weeksLeftInMonth();

  const paceExpected = expectedByNow(monthlyTarget);
  const behindAmount = Math.max(0, paceExpected - earnedThisMonth);
  const behindTarget = behindAmount > 0;

  const unpaidInvoices = await getUnpaidInvoices();
  const unpaidTotal = unpaidInvoices.reduce((s, i) => s + (i.amount || 0), 0);

  return {
    year, ym,
    annualGoal: goal.annualGoal,
    monthlyTarget,
    earnedThisMonth,
    earnedThisYear,
    remaining,
    pctProgress,
    weeksLeftInMonth: weeksLeft,
    behindTarget,
    behindAmount,
    unpaidInvoices,
    unpaidTotal,
    annualPctProgress: goal.annualGoal > 0 ? Math.round((earnedThisYear / goal.annualGoal) * 100) : 0,
    milestones: goal.milestones || {},
  };
}

// Compares year-to-date income before/after a new entry to see if a
// milestone threshold was just crossed. Returns the newly-crossed threshold
// (25/50/75/100) or null. Does not mutate Firestore — caller flips the flag.
function newlyCrossedMilestone(annualGoal, milestones, incomeBefore, incomeAfter) {
  if (!annualGoal) return null;
  for (const t of MILESTONE_THRESHOLDS) {
    if (milestones[t]) continue;
    const thresholdAmount = annualGoal * (t / 100);
    if (incomeBefore < thresholdAmount && incomeAfter >= thresholdAmount) return t;
  }
  return null;
}

module.exports = {
  currentYearMonth,
  weeksLeftInMonth,
  expectedByNow,
  getEntriesFromCache,
  getUnpaidInvoices,
  computeGoalProgress,
  newlyCrossedMilestone,
  MILESTONE_THRESHOLDS,
};
