const { db } = require('./firebase');
const caldav = require('./caldav');

const TASKS = db.collection('anna_tasks');
const META = db.collection('anna_task_meta');
const CACHE_DOC = META.doc('tasks_cache');

// Any doc missing deadlineType predates this feature (the 3 legacy docs from
// productivity-system) — default to 'soft', the lower-pressure assumption.
function withDefaults(task) {
  return { deadlineType: 'soft', ...task };
}

// ── Reads ────────────────────────────────────────────────────────────────────
async function getAllTasks() {
  const snap = await TASKS.get();
  return snap.docs.map(d => withDefaults(d.data()));
}
async function getPendingTasks() {
  const snap = await TASKS.where('status', '==', 'pending').get();
  return snap.docs.map(d => withDefaults(d.data()));
}
async function getTask(id) {
  const snap = await TASKS.doc(String(id)).get();
  return snap.exists ? withDefaults(snap.data()) : null;
}

// ── Cache (mirrors finance-tracker's anna_meta/entries_cache pattern) ───────
async function readCache() {
  const snap = await CACHE_DOC.get();
  return snap.exists ? (snap.data().tasks || null) : null;
}
async function writeCache(tasks) {
  await CACHE_DOC.set({ tasks });
}
async function ensureCache() {
  let tasks = await readCache();
  if (tasks === null) {
    tasks = await getAllTasks();
    await writeCache(tasks);
  }
  return tasks.map(withDefaults);
}
async function upsertCache(task) {
  const tasks = await ensureCache();
  const idx = tasks.findIndex(t => String(t.id) === String(task.id));
  if (idx >= 0) tasks[idx] = task; else tasks.push(task);
  await writeCache(tasks);
}

// ── iCloud calendar sync ─────────────────────────────────────────────────────
// Hard/soft deadline tasks with a deadlineDate get pushed to iCloud as a real
// calendar event so they show up on Anna's phone/Mac. Non-fatal on failure
// (unconfigured or unreachable iCloud should never block task writes) — see
// lib/caldav.js for the CalDAV client itself.
function taskEventPayload(task) {
  const startDate = new Date(`${task.deadlineDate}T${task.deadlineTime || '23:59'}:00+08:00`);
  const endDate = new Date(startDate.getTime() + 30 * 60000);
  return {
    summary: task.desc,
    description: task.client ? `Client: ${task.client}` : '',
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    allDay: false,
  };
}

async function syncTaskToICloud(task) {
  if (!process.env.ICLOUD_APPLE_ID || !process.env.ICLOUD_APP_PASSWORD) return {};
  try {
    // No deadline, or task is done — nothing should remain on the calendar.
    if (!task.deadlineDate || task.status === 'done') {
      if (task.icloudUrl) await caldav.deleteEvent({ url: task.icloudUrl, etag: task.icloudEtag });
      return { icloudUrl: null, icloudEtag: null, icloudUid: null };
    }
    const payload = taskEventPayload(task);
    if (task.icloudUrl) {
      const updated = await caldav.updateEvent({ url: task.icloudUrl, etag: task.icloudEtag, uid: task.icloudUid, ...payload });
      return { icloudEtag: updated.etag };
    }
    const created = await caldav.createEvent(payload);
    return { icloudUrl: created.url, icloudEtag: created.etag, icloudUid: created.uid };
  } catch (e) {
    console.error('iCloud task sync failed (non-fatal):', e.message);
    return {};
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────
async function createTask(data) {
  const id = Date.now();
  const task = {
    id,
    desc: data.desc,
    client: data.client || '',
    deadlineType: data.deadlineType || 'soft',
    deadlineDate: data.deadlineDate ?? null,
    deadlineTime: data.deadlineTime || '23:59',
    estimateMinutes: data.estimateMinutes ?? null,
    status: 'pending',
    postponeCount: 0,
    postponeHistory: [],
    createdAt: id,
    doneAt: null,
    icloudUrl: null,
    icloudEtag: null,
    icloudUid: null,
  };
  Object.assign(task, await syncTaskToICloud(task));
  await TASKS.doc(String(id)).set(task);
  await upsertCache(task);
  return task;
}

// Fields that actually change what shows up on the iCloud event — skip the
// CalDAV round-trip (a real network hit to Apple's server) for edits like
// postponeCount or estimateMinutes that don't touch it.
const ICLOUD_RELEVANT_FIELDS = ['deadlineDate', 'deadlineTime', 'desc', 'client', 'status'];

async function updateTask(id, patch) {
  const current = await getTask(id);
  const merged = { ...current, ...patch };
  const touchesICloud = ICLOUD_RELEVANT_FIELDS.some(f => f in patch);
  const icloudPatch = touchesICloud ? await syncTaskToICloud(merged) : {};
  await TASKS.doc(String(id)).set({ ...patch, ...icloudPatch }, { merge: true });
  const task = await getTask(id);
  await upsertCache(task);
  return task;
}

async function deleteTask(id) {
  const task = await getTask(id);
  if (task && task.icloudUrl && process.env.ICLOUD_APPLE_ID) {
    try {
      await caldav.deleteEvent({ url: task.icloudUrl, etag: task.icloudEtag });
    } catch (e) {
      console.error('iCloud event delete failed (non-fatal):', e.message);
    }
  }
  await TASKS.doc(String(id)).delete();
  const tasks = await ensureCache();
  await writeCache(tasks.filter(t => String(t.id) !== String(id)));
}

module.exports = {
  getAllTasks, getPendingTasks, getTask,
  createTask, updateTask, deleteTask,
  getCachedTasks: ensureCache,
};
