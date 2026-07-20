const tasksRepo = require('../lib/tasksRepo');
const { hktNow, daysBetween } = require('../lib/time');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const tasks = await tasksRepo.getCachedTasks();
    const { date: today } = hktNow();
    const includeAll = req.query.all === 'true';
    const annotated = tasks
      .filter(t => includeAll || t.status === 'pending')
      .map(t => ({ ...t, daysUntilDeadline: t.deadlineDate ? daysBetween(today, t.deadlineDate) : null }))
      .sort((a, b) => {
        if (a.deadlineType !== b.deadlineType) return a.deadlineType === 'hard' ? -1 : 1;
        return (a.deadlineDate || '9999') < (b.deadlineDate || '9999') ? -1 : 1;
      });
    return res.status(200).json(annotated);
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'missing id' });
    const patch = req.body || {};
    const task = await tasksRepo.updateTask(id, patch);
    if (!task) return res.status(404).json({ error: 'task not found' });
    return res.status(200).json({ ok: true, task });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
