const tasksRepo = require('../lib/tasksRepo');
const { hktNow, daysBetween } = require('../lib/time');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const tasks = await tasksRepo.getCachedTasks();
    const { date: today } = hktNow();
    const annotated = tasks
      .filter(t => t.status === 'pending')
      .map(t => ({ ...t, daysUntilDeadline: t.deadlineDate ? daysBetween(today, t.deadlineDate) : null }))
      .sort((a, b) => {
        if (a.deadlineType !== b.deadlineType) return a.deadlineType === 'hard' ? -1 : 1;
        return (a.deadlineDate || '9999') < (b.deadlineDate || '9999') ? -1 : 1;
      });
    return res.status(200).json(annotated);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
