const { hktNow, daysBetween } = require('./time');

// 🔴/🟡 are reserved for hard/soft deadline TYPE (per Anna's spec) — urgency
// (overdue/due-soon) is shown separately via urgencyNote() instead of emoji,
// unlike productivity-system's original statusEmoji() which used 🔴/🟡 for both.
function deadlineBadge(task) {
  return task.deadlineType === 'hard' ? '🔴 HARD' : '🟡 SOFT';
}

function urgencyNote(task) {
  if (task.status === 'done') return '';
  const { date: today } = hktNow();
  const days = daysBetween(today, task.deadlineDate);
  if (days < 0) return '⚠️ overdue';
  if (days <= 2) return '⏰ due soon';
  return '';
}

function postponeBadge(task) {
  return task.postponeCount > 0 ? ` 🔁×${task.postponeCount}` : '';
}

function fmtTaskLine(task) {
  const client = task.client ? ` (${task.client})` : '';
  const urgency = urgencyNote(task);
  const urgencyText = urgency ? ` ${urgency}` : '';
  const done = task.status === 'done' ? '✅ ' : '';
  return `${done}${deadlineBadge(task)}  ${task.desc}${client}${postponeBadge(task)} — due ${task.deadlineDate} ${task.deadlineTime}${urgencyText}`;
}

function fmtDDMM(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

module.exports = { deadlineBadge, urgencyNote, postponeBadge, fmtTaskLine, fmtDDMM };
