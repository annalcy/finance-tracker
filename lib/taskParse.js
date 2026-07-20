const { addDaysToDateStr } = require('./time');

// ── Deadline parsing (ported from productivity-system, extended with weekday names) ──
function parseTimeToken(raw) {
  const s = raw.trim().toLowerCase();
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1]), mi = parseInt(m[2]);
    if (h <= 23 && mi <= 59) return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    return null;
  }
  m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (m) {
    let h = parseInt(m[1]) % 12;
    const mi = m[2] ? parseInt(m[2]) : 0;
    if (m[3] === 'pm') h += 12;
    if (h > 23 || mi > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }
  return null;
}

const WEEKDAY_NAMES = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

// "Friday" → the next occurring Friday, counting today itself as a match
// (so if today IS Friday, "Friday" means today, not a week from now).
function parseWeekday(text, todayStr) {
  const lower = text.toLowerCase().trim();
  const target = WEEKDAY_NAMES[lower];
  if (target === undefined) return null;
  const [y, m, d] = todayStr.split('-').map(Number);
  const todayIdx = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  let diff = target - todayIdx;
  if (diff < 0) diff += 7;
  return addDaysToDateStr(todayStr, diff);
}

function parseDateOnly(text, todayStr) {
  const lower = text.toLowerCase().trim();
  if (!lower) return null;
  if (lower === 'today') return todayStr;
  if (lower === 'tomorrow' || lower === 'tmr' || lower === 'tmrw') return addDaysToDateStr(todayStr, 1);

  const weekday = parseWeekday(lower, todayStr);
  if (weekday) return weekday;

  const inDays = lower.match(/^(?:in\s+)?(\d+)\s+days?$/);
  if (inDays) return addDaysToDateStr(todayStr, parseInt(inDays[1]));

  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthMatch = lower.match(/^(?:(\d{1,2})\s+([a-z]+)|([a-z]+)\s+(\d{1,2}))$/);
  if (monthMatch) {
    const day = parseInt(monthMatch[1] || monthMatch[4]);
    const monthStr = (monthMatch[2] || monthMatch[3]).slice(0, 3);
    const monthIdx = months.indexOf(monthStr);
    if (monthIdx !== -1 && day >= 1 && day <= 31) {
      let year = parseInt(todayStr.slice(0, 4));
      let candidate = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (candidate < todayStr) { year += 1; candidate = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
      return candidate;
    }
  }

  // "15/7" or "15/7/2026" — day/month, matching the finance tracker's convention
  const slashMatch = lower.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]);
    const month = parseInt(slashMatch[2]);
    let year = slashMatch[3] ? parseInt(slashMatch[3]) : parseInt(todayStr.slice(0, 4));
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31)
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) return text.trim();

  return null;
}

// Accepts "tomorrow", "tomorrow 5pm", "Friday", "Friday 2pm", "Jul 15", "Jul 15 3:30pm", "15/7", etc.
function parseDeadline(text, todayStr) {
  const raw = text.trim();
  if (!raw) return null;
  const tokens = raw.split(/\s+/);
  let time = null;
  let datePart = raw;

  if (tokens.length > 1) {
    const lastTwo = tokens.slice(-2).join(' ');
    const lastOne = tokens[tokens.length - 1];
    if (parseTimeToken(lastTwo)) { time = parseTimeToken(lastTwo); datePart = tokens.slice(0, -2).join(' '); }
    else if (parseTimeToken(lastOne)) { time = parseTimeToken(lastOne); datePart = tokens.slice(0, -1).join(' '); }
  }

  const date = parseDateOnly(datePart.trim(), todayStr);
  if (!date) return null;
  return { date, time: time || '23:59' };
}

// ── Duration parsing (ported verbatim) ──────────────────────────────────────
// "2h", "1.5h", "1h30m", "90m", "45min", "2 hours", bare "30" (= minutes)
function parseDuration(text) {
  const s = text.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));

  const hm = s.match(/^(\d+(?:\.\d+)?)h(\d+)?m?$/);
  if (hm) return Math.round(parseFloat(hm[1]) * 60) + (hm[2] ? parseInt(hm[2]) : 0);

  const hOnly = s.match(/^(\d+(?:\.\d+)?)h(?:rs?|ours?)?$/);
  if (hOnly) return Math.round(parseFloat(hOnly[1]) * 60);

  const mOnly = s.match(/^(\d+)m(?:in|ins|inutes?)?$/);
  if (mOnly) return parseInt(mOnly[1]);

  return null;
}

// ── Deadline type (new — not in productivity-system, which never distinguished this) ──
// Returns 'hard'/'soft' when the text clearly signals it, otherwise null —
// callers should ask explicitly rather than silently guessing.
function parseDeadlineType(text) {
  const lower = text.toLowerCase();
  const hardSignals = ['hard deadline', 'must', "can't move", 'cannot move', 'strict deadline', 'due'];
  const softSignals = ['soft deadline', 'target', 'aim for', 'roughly', 'flexible', 'self-set', 'ideally'];
  if (hardSignals.some(s => lower.includes(s))) return 'hard';
  if (softSignals.some(s => lower.includes(s))) return 'soft';
  return null;
}

module.exports = { parseDeadline, parseDateOnly, parseDuration, parseDeadlineType, parseWeekday };
