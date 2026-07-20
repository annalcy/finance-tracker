const { db } = require('./firebase');

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

// ── Writes ───────────────────────────────────────────────────────────────────
async function createTask(data) {
  const id = Date.now();
  const task = {
    id,
    desc: data.desc,
    client: data.client || '',
    deadlineType: data.deadlineType || 'soft',
    deadlineDate: data.deadlineDate,
    deadlineTime: data.deadlineTime || '23:59',
    estimateMinutes: data.estimateMinutes,
    status: 'pending',
    postponeCount: 0,
    postponeHistory: [],
    createdAt: id,
    doneAt: null,
  };
  await TASKS.doc(String(id)).set(task);
  await upsertCache(task);
  return task;
}

async function updateTask(id, patch) {
  await TASKS.doc(String(id)).set(patch, { merge: true });
  const task = await getTask(id);
  await upsertCache(task);
  return task;
}

async function deleteTask(id) {
  await TASKS.doc(String(id)).delete();
  const tasks = await ensureCache();
  await writeCache(tasks.filter(t => String(t.id) !== String(id)));
}

module.exports = {
  getAllTasks, getPendingTasks, getTask,
  createTask, updateTask, deleteTask,
  getCachedTasks: ensureCache,
};
