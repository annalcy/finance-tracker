// ── iCloud CalDAV client (read-only) ────────────────────────────────────────
// Talks directly to Apple's CalDAV server (caldav.icloud.com) — no local Mac
// component needed. Auth is an app-specific password, never the real Apple ID
// password (Apple rejects CalDAV logins with the account password outright).
// Deliberately read-only: Personal OS displays Anna's real calendar but never
// creates/edits/deletes anything on it — an earlier version pushed task
// deadlines and bot-added events to iCloud, which she asked to remove in
// favor of pure iCloud → dashboard display.
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

// Reads pull from ALL of Anna's event calendars merged (Home/Work/Family/
// etc.), not just one — reminder lists (VTODO-only, e.g. "Reminders") are
// excluded since they can't hold events.
function isEventCalendar(c) {
  return (c.components || []).includes('VEVENT');
}
async function getEventCalendars(client) {
  const calendars = await client.fetchCalendars();
  return calendars.filter(isEventCalendar);
}

function parseICS(icsString) {
  const jcalData = ICAL.parse(icsString);
  const comp = new ICAL.Component(jcalData);
  // Real calendar entries (created on iPhone/Mac, possibly while travelling)
  // carry a TZID + sibling VTIMEZONE block — register it first so ical.js
  // resolves the real named zone instead of falling back to floating time
  // against this process's local TZ (Vercel's is likely UTC, not HKT).
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

async function listEvents({ start, end }) {
  const client = await getClient();
  const calendars = await getEventCalendars(client);
  const perCalendar = await Promise.all(calendars.map(async calendar => {
    const objects = await client.fetchCalendarObjects({ calendar, timeRange: { start, end } });
    return objects
      .map(o => {
        const parsed = parseICS(o.data);
        if (!parsed) return null;
        return { ...parsed, calendarName: calendar.displayName };
      })
      .filter(Boolean);
  }));
  return perCalendar.flat();
}

module.exports = { listCalendars, listEvents };
