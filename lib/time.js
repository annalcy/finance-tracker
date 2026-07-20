// ── HKT-aware time helpers ──────────────────────────────────────────────────
// All wall-clock reads go through Intl with an explicit timeZone so the logic
// is correct regardless of what timezone the serverless host runs in.
const TZ = 'Asia/Hong_Kong';

function hktNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false, weekday: 'short',
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    weekday: get('weekday'), // 'Sun', 'Mon', ...
  };
}

function addDaysToDateStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12)); // noon UTC dodges DST edge cases
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().split('T')[0];
}

function daysBetween(fromStr, toStr) {
  const [ay, am, ad] = fromStr.split('-').map(Number);
  const [by, bm, bd] = toStr.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = ((mins % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

module.exports = { TZ, hktNow, addDaysToDateStr, daysBetween, timeToMinutes, minutesToTime };
