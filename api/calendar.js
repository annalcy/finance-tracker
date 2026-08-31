const caldav = require('../lib/caldav');

// Thin REST wrapper around lib/caldav.js so the dashboard and bot can both
// read/write Anna's iCloud calendar without embedding CalDAV logic twice.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Diagnostics: ?meta=calendars lists every iCloud calendar name/url so
    // Anna can find the exact ICLOUD_CALENDAR_NAME to set.
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

    if (req.method === 'POST') {
      const body = req.body || {};
      if (!body.summary || !body.start || !body.end) {
        return res.status(400).json({ error: 'missing summary/start/end' });
      }
      const event = await caldav.createEvent(body);
      return res.status(201).json({ ok: true, event });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      if (!body.url) return res.status(400).json({ error: 'missing url' });
      const event = await caldav.updateEvent(body);
      return res.status(200).json({ ok: true, event });
    }

    if (req.method === 'DELETE') {
      const { url, etag } = req.method === 'DELETE' ? (req.body || req.query) : {};
      if (!url) return res.status(400).json({ error: 'missing url' });
      await caldav.deleteEvent({ url, etag });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('calendar api error:', e);
    return res.status(500).json({ error: e.message });
  }
};
