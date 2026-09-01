const caldav = require('../lib/caldav');

// Read-only wrapper around lib/caldav.js — the dashboard displays Anna's real
// iCloud calendar, but Personal OS never writes to it (see lib/caldav.js).
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Diagnostics: ?meta=calendars lists every iCloud calendar name/url.
    if (req.method === 'GET' && req.query.meta === 'calendars') {
      const calendars = await caldav.listCalendars();
      return res.status(200).json(calendars);
    }

    if (req.method === 'GET') {
      const { start, end } = req.query;
      if (!start || !end) return res.status(400).json({ error: 'missing start/end (ISO dates)' });
      const events = await caldav.listEvents({ start, end });
      return res.status(200).json(events);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('calendar api error:', e);
    return res.status(500).json({ error: e.message });
  }
};
