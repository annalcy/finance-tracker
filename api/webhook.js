const { Telegraf, Markup } = require('telegraf');
const admin = require('firebase-admin');

// ── Firebase Admin init ────────────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
  });
}
const db = admin.firestore();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const EXPENSE_CATS = [
  'Food & drinks','Transport','Socializing','Entertainment','Beauty & health',
  'Phone & subscriptions','Books & education','Gifts & treats','Travel',
  'Shopping','Music & media','Leisure','Utilities','Fees','Family','Misc',
];
const INCOME_CATS = [
  'Shooting','Video editing','Graphic design','Writing/Caption','Freelance day rate',
  'Project fee','Retainer','Sales/Resale','Event','Laisee','Other income',
];

// ── Smart local parser — no external API needed ───────────────────────────────
function parseEntry(text) {
  const lower = text.toLowerCase();
  const today = new Date().toISOString().split('T')[0];

  const amountMatch = text.match(/\d+(\.\d+)?/);
  const amount = amountMatch ? parseFloat(amountMatch[0]) : 0;

  const incomeSignals = [
    'paid me', 'pay me', 'payment to me', 'received from', 'received',
    'laisee', 'lai see', 'red packet', 'invoice paid', 'settled invoice',
    'project fee', 'shooting fee', 'retainer', 'earned', 'sold', 'sale',
  ];
  const isIncome = incomeSignals.some(s => lower.includes(s));

  const clearExpense = [
    'taxi','uber','grab','mtr','bus','tram','train','ferry','minibus',
    'lunch','dinner','breakfast','brunch','food','eat','restaurant','cafe',
    'coffee','tea','drink','meal','snack','takeaway',
    'beauty','salon','hair','spa','nail','massage','skincare',
    'phone','netflix','spotify','subscription','app','wifi','data',
    'shopping','clothes','shirt','dress','shoes','bag','supermarket',
    'movie','cinema','concert','entertainment','game',
    'gym','sport','fitness','yoga',
    'hotel','flight','airbnb','travel','trip',
    'book','course','class','tuition',
    'gift','present','flowers',
    'rent','utility','electric','water','gas','rates',
    'fee','bank','atm',
  ];
  const isClearExpense = clearExpense.some(s => lower.includes(s));

  const words = text.trim().split(/\s+/);
  const hasNameWord = words.some((w, i) => i > 0 && /^[A-Z][a-zA-Z]+$/.test(w));
  const ambiguous = !isIncome && !isClearExpense && hasNameWord && amount > 0;

  let cat;
  if (isIncome) {
    if (/shoot|shooting|photo/.test(lower)) cat = 'Shooting';
    else if (/video|edit/.test(lower)) cat = 'Video editing';
    else if (/design|graphic/.test(lower)) cat = 'Graphic design';
    else if (/writ|caption|copy/.test(lower)) cat = 'Writing/Caption';
    else if (/retainer/.test(lower)) cat = 'Retainer';
    else if (/project|fee/.test(lower)) cat = 'Project fee';
    else if (/laisee|lai see|red packet/.test(lower)) cat = 'Laisee';
    else if (/sold|sale|resale/.test(lower)) cat = 'Sales/Resale';
    else if (/event/.test(lower)) cat = 'Event';
    else if (/day rate|daily/.test(lower)) cat = 'Freelance day rate';
    else cat = 'Other income';
  } else {
    if (/taxi|uber|grab|mtr|bus|tram|train|ferry|minibus/.test(lower)) cat = 'Transport';
    else if (/lunch|dinner|breakfast|brunch|food|eat|restaurant|cafe|coffee|drink|meal|snack|takeaway/.test(lower)) cat = 'Food & drinks';
    else if (/beauty|salon|hair|spa|nail|massage|skincare/.test(lower)) cat = 'Beauty & health';
    else if (/phone|netflix|spotify|subscription|app|wifi/.test(lower)) cat = 'Phone & subscriptions';
    else if (/shopping|clothes|shirt|dress|shoes|bag|supermarket/.test(lower)) cat = 'Shopping';
    else if (/movie|cinema|concert|entertainment|game/.test(lower)) cat = 'Entertainment';
    else if (/gym|sport|fitness|yoga/.test(lower)) cat = 'Leisure';
    else if (/hotel|flight|airbnb|travel|trip/.test(lower)) cat = 'Travel';
    else if (/book|course|class|tuition/.test(lower)) cat = 'Books & education';
    else if (/gift|present|flower/.test(lower)) cat = 'Gifts & treats';
    else if (/social|friend|party/.test(lower)) cat = 'Socializing';
    else if (/rent|utility|electric|water|gas/.test(lower)) cat = 'Utilities';
    else if (/fee|bank|atm/.test(lower)) cat = 'Fees';
    else if (/family|mum|mom|dad|parent/.test(lower)) cat = 'Family';
    else cat = 'Misc';
  }

  const desc = text.replace(/\d+(\.\d+)?/, '').replace(/\s+/g, ' ').trim() || text;
  const clientWord = words.find((w, i) => i > 0 && /^[A-Z][a-zA-Z]+$/.test(w)) || '';

  return {
    type: isIncome ? 'income' : 'expense',
    amount,
    desc: desc.slice(0, 60),
    date: today,
    cat,
    client: clientWord,
    ambiguous,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtHKD(n) {
  return 'HKD ' + Number(n).toLocaleString('en-HK', { maximumFractionDigits: 0 });
}

function parseRelativeDate(text) {
  const lower = text.toLowerCase().trim();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const fmt = d => d.toISOString().split('T')[0];

  if (lower === 'today') return fmt(today);
  if (lower === 'yesterday') {
    const d = new Date(today); d.setDate(d.getDate() - 1); return fmt(d);
  }

  const daysAgo = lower.match(/^(\d+)\s+days?\s+ago$/);
  if (daysAgo) {
    const d = new Date(today); d.setDate(d.getDate() - parseInt(daysAgo[1])); return fmt(d);
  }

  // "Jul 7", "7 Jul", "July 7", "7 July"
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const monthMatch = lower.match(/(?:(\d{1,2})\s+([a-z]+)|([a-z]+)\s+(\d{1,2}))/);
  if (monthMatch) {
    const day = parseInt(monthMatch[1] || monthMatch[4]);
    const monthStr = (monthMatch[2] || monthMatch[3]).slice(0, 3);
    const monthIdx = months.indexOf(monthStr);
    if (monthIdx !== -1 && day >= 1 && day <= 31) {
      const year = today.getFullYear();
      return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // "7/7" or "7/7/2026"
  const slashMatch = lower.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]);
    const month = parseInt(slashMatch[2]);
    const year = slashMatch[3] ? parseInt(slashMatch[3]) : today.getFullYear();
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31)
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // ISO: "2026-07-07"
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  return null;
}

// Short code → full category name
const CAT_MAP = {
  c_food: 'Food & drinks', c_trans: 'Transport', c_social: 'Socializing',
  c_ent: 'Entertainment', c_health: 'Beauty & health', c_phone: 'Phone & subscriptions',
  c_edu: 'Books & education', c_gifts: 'Gifts & treats', c_travel: 'Travel',
  c_shop: 'Shopping', c_music: 'Music & media', c_leisure: 'Leisure',
  c_util: 'Utilities', c_fees: 'Fees', c_family: 'Family', c_misc: 'Misc',
  c_shoot: 'Shooting', c_video: 'Video editing', c_design: 'Graphic design',
  c_copy: 'Writing/Caption', c_rate: 'Freelance day rate', c_proj: 'Project fee',
  c_ret: 'Retainer', c_resale: 'Sales/Resale', c_event: 'Event',
  c_lai: 'Laisee', c_otherinc: 'Other income',
};

const EXPENSE_CAT_BTNS = [
  ['🍜 Food', 'c_food'], ['🚖 Transport', 'c_trans'],
  ['🍻 Socializing', 'c_social'], ['🎬 Entertainment', 'c_ent'],
  ['💄 Beauty & health', 'c_health'], ['📱 Phone & subs', 'c_phone'],
  ['📚 Education', 'c_edu'], ['🎁 Gifts & treats', 'c_gifts'],
  ['✈️ Travel', 'c_travel'], ['🛍 Shopping', 'c_shop'],
  ['🎵 Music & media', 'c_music'], ['🏋️ Leisure', 'c_leisure'],
  ['🔧 Utilities', 'c_util'], ['💸 Fees', 'c_fees'],
  ['👨‍👩‍👧 Family', 'c_family'], ['📦 Misc', 'c_misc'],
];
const INCOME_CAT_BTNS = [
  ['📷 Shooting', 'c_shoot'], ['🎞 Video editing', 'c_video'],
  ['🎨 Graphic design', 'c_design'], ['✍️ Writing/Caption', 'c_copy'],
  ['📆 Day rate', 'c_rate'], ['💼 Project fee', 'c_proj'],
  ['🔁 Retainer', 'c_ret'], ['🏷 Sales/Resale', 'c_resale'],
  ['🎪 Event', 'c_event'], ['🧧 Laisee', 'c_lai'],
  ['💰 Other income', 'c_otherinc'],
];

// ── Firestore-backed session (survives serverless cold starts) ─────────────────
async function getSession(userId) {
  try {
    const doc = await db.collection('anna_sessions').doc(String(userId)).get();
    return doc.exists ? doc.data() : null;
  } catch { return null; }
}
async function setSession(userId, data) {
  try {
    await db.collection('anna_sessions').doc(String(userId)).set(data);
  } catch { /* non-fatal */ }
}
async function clearSession(userId) {
  try {
    await db.collection('anna_sessions').doc(String(userId)).delete();
  } catch { /* non-fatal */ }
}

// ── UI helpers ─────────────────────────────────────────────────────────────────
async function sendConfirmation(ctx, entry, editExisting = false) {
  const userId = ctx.from.id;
  const sign = entry.type === 'income' ? '+' : '-';
  const emoji = entry.type === 'income' ? '💚' : '🔴';
  const clientLine = entry.client ? `👤 ${entry.client}\n` : '';
  const switchLabel = entry.type === 'income' ? '↕ Switch to Expense' : '↕ Switch to Income';
  const clientBtn = entry.client ? '👤 Edit client' : '👤 Add client';

  await setSession(userId, { stage: 'confirm', entry });

  const text =
    `${emoji} *${entry.desc}*\n` +
    `${sign}${fmtHKD(entry.amount)}\n` +
    `🏷 ${entry.cat}\n` +
    `📅 ${entry.date}\n` +
    `${clientLine}\n` +
    `Does this look right?`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✓ Log it', 'confirm'), Markup.button.callback('✗ Cancel', 'cancel')],
    [Markup.button.callback('✏️ Category', 'pick_cat'), Markup.button.callback(clientBtn, 'edit_client')],
    [Markup.button.callback('📅 Change date', 'edit_date'), Markup.button.callback(switchLabel, 'switch_type')],
  ]);

  if (editExisting) {
    return ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
  }
  return ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
}

function catPickerKeyboard(type) {
  const btns = type === 'income' ? INCOME_CAT_BTNS : EXPENSE_CAT_BTNS;
  const rows = [];
  for (let i = 0; i < btns.length; i += 2) {
    const row = [Markup.button.callback(btns[i][0], btns[i][1])];
    if (btns[i + 1]) row.push(Markup.button.callback(btns[i + 1][0], btns[i + 1][1]));
    rows.push(row);
  }
  rows.push([Markup.button.callback('← Back', 'back_to_confirm')]);
  return Markup.inlineKeyboard(rows);
}

// ── Commands ───────────────────────────────────────────────────────────────────
bot.start(ctx =>
  ctx.reply(
    `Hi Anna! 👋 I'm your finance bot.\n\n` +
    `Just tell me what happened — I'll figure out the details and ask if anything's unclear.\n\n` +
    `Examples:\n` +
    `• "taxi 47"\n` +
    `• "lunch 120 with oscar"\n` +
    `• "oscar paid me 1200 for shooting"\n` +
    `• "received 500 laisee"\n\n` +
    `/summary — this month\n` +
    `/recent — last 5 entries\n\n` +
    `_Tip: tap 📅 on any entry to change the date_`
  )
);

bot.help(ctx =>
  ctx.reply(
    `Just describe what you spent or earned — I'll ask if anything's unclear.\n\n` +
    `For income, mention payment direction:\n` +
    `• "oscar paid me 3000 shooting"\n` +
    `• "client settled invoice 5000"\n` +
    `• "received laisee 200"\n\n` +
    `For expenses, just say what it was:\n` +
    `• "taxi 80"\n` +
    `• "dinner 320 cbeauty"\n\n` +
    `/summary — monthly overview\n` +
    `/recent — last 5 entries`
  )
);

bot.command('summary', async ctx => {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const label = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const dayOfMonth = now.getDate();
  try {
    const snap = await db.collection('anna_tracker').get();
    const entries = snap.docs.map(d => d.data()).filter(e => e.date && e.date.startsWith(ym));

    const incomeEntries = entries.filter(e => e.type === 'income');
    const expenseEntries = entries.filter(e => e.type === 'expense');
    const income = incomeEntries.reduce((s, e) => s + (e.amount || 0), 0);
    const expense = expenseEntries.reduce((s, e) => s + (e.amount || 0), 0);
    const net = income - expense;

    // Top expense categories
    const catTotals = {};
    expenseEntries.forEach(e => {
      catTotals[e.cat] = (catTotals[e.cat] || 0) + (e.amount || 0);
    });
    const topCats = Object.entries(catTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat, amt]) => `  ${cat}: ${fmtHKD(amt)}`);

    // Daily average spend
    const dailyAvg = dayOfMonth > 0 ? Math.round(expense / dayOfMonth) : 0;

    // Income breakdown by category
    const incCatTotals = {};
    incomeEntries.forEach(e => {
      incCatTotals[e.cat] = (incCatTotals[e.cat] || 0) + (e.amount || 0);
    });
    const incBreakdown = Object.entries(incCatTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => `  ${cat}: ${fmtHKD(amt)}`);

    let msg =
      `📊 *${label}* (${entries.length} entries)\n\n` +
      `💚 Income: ${fmtHKD(income)}\n`;

    if (incBreakdown.length > 1) msg += incBreakdown.join('\n') + '\n';

    msg += `\n🔴 Expenses: ${fmtHKD(expense)}\n`;
    if (topCats.length) msg += topCats.join('\n') + '\n';

    msg +=
      `\n📈 Daily avg: ${fmtHKD(dailyAvg)}/day\n` +
      `━━━━━━━━━━━━\n` +
      `${net >= 0 ? '💰' : '⚠️'} Net: ${net >= 0 ? '+' : ''}${fmtHKD(net)}`;

    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply('Could not fetch summary right now. Try again in a moment.');
  }
});

bot.command('recent', async ctx => {
  try {
    const snap = await db.collection('anna_tracker').orderBy('date', 'desc').limit(5).get();
    const entries = snap.docs.map(d => d.data());
    if (!entries.length) return ctx.reply('No entries yet.');
    const lines = entries.map(e => {
      const sign = e.type === 'income' ? '💚 +' : '🔴 -';
      return `${sign}${fmtHKD(e.amount)}  ${e.desc}  _${e.date}_`;
    });
    ctx.reply(`*Last 5 entries:*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply('Could not fetch entries right now. Try again in a moment.');
  }
});

// ── Main text handler ──────────────────────────────────────────────────────────
bot.on('text', async ctx => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const userId = ctx.from.id;
  const state = await getSession(userId);

  if (state && state.stage === 'need_amount') {
    const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
    if (!amount || isNaN(amount)) {
      await ctx.reply('Just the number please — e.g. "350"');
      return;
    }
    state.entry.amount = amount;
    await sendConfirmation(ctx, state.entry);
    return;
  }

  if (state && state.stage === 'edit_client') {
    state.entry.client = text.trim().toLowerCase() === 'none' ? '' : text.trim();
    const msg = state.entry.client
      ? `Got it — client set to *${state.entry.client}*`
      : 'Client cleared.';
    await ctx.reply(msg, { parse_mode: 'Markdown' });
    await sendConfirmation(ctx, state.entry);
    return;
  }

  if (state && state.stage === 'edit_date') {
    const parsed = parseRelativeDate(text.trim());
    if (!parsed) {
      await ctx.reply('Didn\'t get that — try "yesterday", "2 days ago", "Jul 7", or "7/7".');
      return;
    }
    state.entry.date = parsed;
    await ctx.reply(`Date set to *${parsed}*`, { parse_mode: 'Markdown' });
    await sendConfirmation(ctx, state.entry);
    return;
  }

  ctx.sendChatAction('typing');

  let entry;
  try {
    entry = parseEntry(text);
  } catch (err) {
    console.error('parseEntry error:', err.message);
    await ctx.reply("I didn't catch that — try something like \"taxi 47\" or \"oscar paid me 1200\".");
    return;
  }

  if (!entry.amount || entry.amount === 0) {
    await setSession(userId, { stage: 'need_amount', entry });
    const what = entry.desc || text;
    await ctx.reply(`Got "${what}" — how much was it? (HKD)`);
    return;
  }

  if (entry.ambiguous) {
    await setSession(userId, { stage: 'clarify_type', entry });
    const who = entry.client || entry.desc;
    await ctx.reply(
      `${who} — ${fmtHKD(entry.amount)}\n\nWas this money you received, or money you paid?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('💚 I received it', 'type_income')],
        [Markup.button.callback('🔴 I paid it', 'type_expense')],
        [Markup.button.callback('✗ Cancel', 'cancel')],
      ])
    );
    return;
  }

  await sendConfirmation(ctx, entry);
});

// ── Button actions ─────────────────────────────────────────────────────────────
bot.action('type_income', async ctx => {
  await ctx.answerCbQuery();
  const state = await getSession(ctx.from.id);
  if (!state || !state.entry) return ctx.reply('Session expired — please try again.');
  state.entry.type = 'income';
  if (!INCOME_CATS.includes(state.entry.cat)) state.entry.cat = 'Other income';
  await sendConfirmation(ctx, state.entry, true);
});

bot.action('type_expense', async ctx => {
  await ctx.answerCbQuery();
  const state = await getSession(ctx.from.id);
  if (!state || !state.entry) return ctx.reply('Session expired — please try again.');
  state.entry.type = 'expense';
  if (!EXPENSE_CATS.includes(state.entry.cat)) state.entry.cat = 'Misc';
  await sendConfirmation(ctx, state.entry, true);
});

bot.action('switch_type', async ctx => {
  await ctx.answerCbQuery();
  const state = await getSession(ctx.from.id);
  if (!state || !state.entry) return ctx.reply('Session expired — please try again.');
  state.entry.type = state.entry.type === 'income' ? 'expense' : 'income';
  if (state.entry.type === 'income' && !INCOME_CATS.includes(state.entry.cat)) state.entry.cat = 'Other income';
  if (state.entry.type === 'expense' && !EXPENSE_CATS.includes(state.entry.cat)) state.entry.cat = 'Misc';
  await sendConfirmation(ctx, state.entry, true);
});

bot.action('pick_cat', async ctx => {
  await ctx.answerCbQuery();
  const state = await getSession(ctx.from.id);
  if (!state || !state.entry) return ctx.reply('Session expired — please try again.');
  await setSession(ctx.from.id, { ...state, stage: 'pick_cat' });
  await ctx.editMessageText(
    `Pick a category for *${state.entry.desc}*:`,
    { parse_mode: 'Markdown', ...catPickerKeyboard(state.entry.type) }
  );
});

bot.action('back_to_confirm', async ctx => {
  await ctx.answerCbQuery();
  const state = await getSession(ctx.from.id);
  if (!state || !state.entry) return ctx.reply('Session expired — please try again.');
  await sendConfirmation(ctx, state.entry, true);
});

bot.action('edit_client', async ctx => {
  await ctx.answerCbQuery();
  const state = await getSession(ctx.from.id);
  if (!state || !state.entry) return ctx.reply('Session expired — please try again.');
  await setSession(ctx.from.id, { ...state, stage: 'edit_client' });
  const prompt = state.entry.client
    ? `Current client: *${state.entry.client}*\n\nType the new name (or "none" to clear):`
    : `Who's the client or person involved? Just type their name:`;
  await ctx.reply(prompt, { parse_mode: 'Markdown' });
});

bot.action('edit_date', async ctx => {
  await ctx.answerCbQuery();
  const state = await getSession(ctx.from.id);
  if (!state || !state.entry) return ctx.reply('Session expired — please try again.');
  await setSession(ctx.from.id, { ...state, stage: 'edit_date' });
  await ctx.reply(
    `Current date: *${state.entry.date}*\n\nWhat date should this be? e.g.\n• yesterday\n• 2 days ago\n• Jul 7\n• 7/7`,
    { parse_mode: 'Markdown' }
  );
});

// Category picker — one handler per cat code
Object.keys(CAT_MAP).forEach(code => {
  bot.action(code, async ctx => {
    await ctx.answerCbQuery();
    const state = await getSession(ctx.from.id);
    if (!state || !state.entry) return ctx.reply('Session expired — please try again.');
    state.entry.cat = CAT_MAP[code];
    await sendConfirmation(ctx, state.entry, true);
  });
});

bot.action('confirm', async ctx => {
  const state = await getSession(ctx.from.id);
  const entry = state && state.entry;
  if (!entry) return ctx.answerCbQuery('Entry expired — please re-send your message.');
  try {
    const id = Date.now();
    const newEntry = {
      id,
      type: entry.type,
      desc: entry.desc,
      amount: entry.amount,
      date: entry.date,
      cat: entry.cat,
      client: entry.client || '',
      notes: 'Added via Telegram',
    };
    // Write to individual doc (source of truth)
    await db.collection('anna_tracker').doc(String(id)).set(newEntry);
    // Update cache so the tracker picks it up immediately
    const CACHE = db.collection('anna_meta').doc('entries_cache');
    const cacheSnap = await CACHE.get();
    const cached = cacheSnap.exists ? (cacheSnap.data().entries || []) : [];
    cached.push(newEntry);
    await CACHE.set({ entries: cached });

    await clearSession(ctx.from.id);
    const sign = entry.type === 'income' ? '+' : '-';
    await ctx.editMessageText(
      `✅ Logged: *${entry.desc}* ${sign}${fmtHKD(entry.amount)}`,
      { parse_mode: 'Markdown' }
    );
    ctx.answerCbQuery('Saved!');
  } catch (err) {
    console.error('save error:', err);
    ctx.answerCbQuery('Error saving — try again.');
  }
});

bot.action('cancel', async ctx => {
  await clearSession(ctx.from.id);
  await ctx.editMessageText('Cancelled.');
  ctx.answerCbQuery();
});

// ── Vercel export ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  } else {
    res.status(200).json({ status: 'Anna Finance Bot is running ✓' });
  }
};
