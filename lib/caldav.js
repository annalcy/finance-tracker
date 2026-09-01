// ── iCloud CalDAV client ─────────────────────────────────────────────────────
// Talks directly to Apple's CalDAV server (caldav.icloud.com) — no local Mac
// component needed. Auth is an app-specific password, never the real Apple ID
// password (Apple rejects CalDAV logins with the account password outright).
const { DAVClient } = require('tsdav');
const ICAL = require('ical.js');

function assertConfigured() {
  if (!process.env.ICLOUD_APPLE_ID || !process.env.ICLOUD_APP_PASSWORD) {
    throw new Error(
      'iCloud calendar not configured — set ICLOUD_APPLE_ID and ICLOUD_APP_PASSWORD env vars ' +
      '(generate the app-specific password at appleid.apple.com).'
    );
  }
}

async function getClient() {
  assertConfigured();
  const client = new DAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: {
      username: process.env.ICLOUD_APPLE_ID,
      password: process.env.ICLOUD_APP_PASSWORD,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  await client.login();
  return client;
}

// ── Calendar discovery ──────────────────────────────────────────────────────
async function listCalendars() {
  const client = await getClient();
  const calendars = await client.fetchCalendars();
  return calendars.map(c => ({
    displayName: c.displayName,
    url: c.url,
    components: c.components || [],
  }));
}

// Anna syncs against ALL her event calendars for reading (Home/Work/Family/
// etc. all show up merged), not just one — reminder lists (VTODO-only, e.g.
// "Reminders") are excluded since they can't hold events at all.
function isEventCalendar(c) {
  return (c.components || []).includes('VEVENT');
}
async function getEventCalendars(client) {
  const calendars = await client.fetchCalendars();
  return calendars.filter(isEventCalendar);
}

// New events created BY Personal OS (task deadlines, /addevent) still need
// one specific calendar to land in — ICLOUD_CALENDAR_NAME picks it, defaults
// to "Home" (iCloud's original default calendar), or the first available
// event calendar if even that isn't found. Set ICLOUD_CALENDAR_NAME to
// change where new events go; it has no effect on reading.
async function getWritableCalendar(client) {
  const eventCalendars = await getEventCalendars(client);
  if (!eventCalendars.length) {
    throw new Error('No writable iCloud calendar found (only VTODO/reminder lists exist?).');
  }
  const name = process.env.ICLOUD_CALENDAR_NAME;
  if (name && name.toLowerCase() !== 'all') {
    const target = eventCalendars.find(c => (c.displayName || '').toLowerCase() === name.toLowerCase());
    if (!target) {
      throw new Error(`No iCloud calendar named "${name}" found. Run /calendars to see available names.`);
    }
    return target;
  }
  return eventCalendars.find(c => (c.displayName || '').toLowerCase() === 'home') || eventCalendars[0];
}

// ── ICS helpers ──────────────────────────────────────────────────────────────
// Timed events are written in UTC "Z" form (unambiguous, no VTIMEZONE needed)
// rather than a bare TZID+local time — ical.js treats an unregistered TZID as
// *floating* and resolves it against the parsing process's system timezone,
// not the named zone, which would silently corrupt times read back on a
// server whose local TZ isn't Asia/Hong_Kong (e.g. Vercel's default UTC).
function icsDateOnly(dateStr) {
  return dateStr.replace(/-/g, '');
}
function icsUtcStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}
function escapeICS(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function buildICS({ uid, summary, description, location, start, end, allDay }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Personal OS//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsUtcStamp(new Date())}`,
  ];
  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDateOnly(start)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDateOnly(end)}`);
  } else {
    lines.push(`DTSTART:${icsUtcStamp(new Date(start))}`);
    lines.push(`DTEND:${icsUtcStamp(new Date(end))}`);
  }
  lines.push(`SUMMARY:${escapeICS(summary)}`);
  if (description) lines.push(`DESCRIPTION:${escapeICS(description)}`);
  if (location) lines.push(`LOCATION:${escapeICS(location)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function parseICS(icsString) {
  const jcalData = ICAL.parse(icsString);
  const comp = new ICAL.Component(jcalData);
  // Events from Anna's own calendar (created on iPhone/Mac, possibly while
  // travelling) carry a TZID + sibling VTIMEZONE block — register it first so
  // ical.js resolves the real named zone instead of falling back to floating
  // time against this process's local TZ.
  comp.getAllSubcomponents('vtimezone').forEach(vt => ICAL.TimezoneService.register(vt));
  const vevent = comp.getFirstSubcomponent('vevent');
  if (!vevent) return null;
  const event = new ICAL.Event(vevent);
  return {
    uid: event.uid,
    summary: event.summary || '',
    description: event.description || '',
    location: event.location || '',
    start: event.startDate.toJSDate().toISOString(),
    end: event.endDate.toJSDate().toISOString(),
    allDay: !!event.startDate.isDate,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
async function listEvents({ start, end }) {
  const client = await getClient();
  const calendars = await getEventCalendars(client);
  const perCalendar = await Promise.all(calendars.map(async calendar => {
    const objects = await client.fetchCalendarObjects({ calendar, timeRange: { start, end } });
    return objects
      .map(o => {
        const parsed = parseICS(o.data);
        if (!parsed) return null;
        return { ...parsed, url: o.url, etag: o.etag, calendarName: calendar.displayName };
      })
      .filter(Boolean);
  }));
  return perCalendar.flat();
}

// createCalendarObject/updateCalendarObject/deleteCalendarObject return the
// raw fetch Response (not a parsed object) — the etag comes back in a header,
// and the URL for a freshly-created object is the one we chose via filename.
async function createEvent({ summary, description, location, start, end, allDay }) {
  const client = await getClient();
  const calendar = await getWritableCalendar(client);
  const uid = `personal-os-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@annalcy`;
  const filename = `${uid}.ics`;
  const iCalString = buildICS({ uid, summary, description, location, start, end, allDay });
  const response = await client.createCalendarObject({ calendar, filename, iCalString });
  if (!response.ok) throw new Error(`iCloud rejected event creation (${response.status})`);
  const url = new URL(filename, calendar.url).toString();
  return { uid, url, etag: response.headers.get('etag') };
}

async function updateEvent({ url, etag, summary, description, location, start, end, allDay, uid }) {
  const client = await getClient();
  const iCalString = buildICS({ uid: uid || 'personal-os-update', summary, description, location, start, end, allDay });
  const response = await client.updateCalendarObject({
    calendarObject: { url, etag, data: iCalString },
  });
  if (!response.ok) throw new Error(`iCloud rejected event update (${response.status})`);
  return { url, etag: response.headers.get('etag') || etag };
}

async function deleteEvent({ url, etag }) {
  const client = await getClient();
  const response = await client.deleteCalendarObject({ calendarObject: { url, etag } });
  if (!response.ok && response.status !== 404) {
    throw new Error(`iCloud rejected event deletion (${response.status})`);
  }
}

module.exports = {
  listCalendars, listEvents, createEvent, updateEvent, deleteEvent,
};
