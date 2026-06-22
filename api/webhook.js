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

  // Extract amount — first number in the message
  const amountMatch = text.match(/\d+(\.\d+)?/);
  const amount = amountMatch ? parseFloat(amountMatch[0]) : 0;

  // Income signals
  const incomeSignals = [
    'paid me', 'pay me', 'payment to me', 'received from', 'received',
    'laisee', 'lai see', 'red packet', 'invoice paid', 'settled invoice',
    'project fee', 'shooting fee', 'retainer', 'earned', 'sold', 'sale',
  ];
  const isIncome = incomeSignals.some(s => lower.includes(s));

  // Clear expense signals (never ambiguous)
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

  // Ambiguous: a person name + amount but no clear direction signal
  const words = text.trim().split(/\s+/);
  const hasNameWord = words.some((w, i) => i > 0 && /^[A-Z][a-zA-Z]+$/.test(w));
  const ambiguous = !isIncome && !isClearExpense && hasNameWord && amount > 0;

  // Determine category
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

  // Clean description — strip the amount from the text
  const desc = text.replace(/\d+(\.\d+)?/, '').replace(/\s+/g, ' ').trim() || text;

  // Extract client name — capitalised word after the first word
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

// pending[userId] = { stage: 'confirm'|'clarify_type'|'need_amount', entry: {...} }
const pending = new Map();

async function sendConfirmation(ctx, entry, editExisting = false) {
  const sign = entry.type === 'income' ? '+' : '-';
  const emoji = entry.type === 'income' ? '💚' : '🔴';
  const clientLine = entry.client ? `👤 ${entry.client}\n` : '';
  const switchLabel = entry.type === 'income' ? '↕ Switch to Expense' : '↕ Switch to Income';

  pending.set(ctx.from.id, { stage: 'confirm', entry });

  const text =
    `${emoji} *${entry.desc}*\n` +
    `${sign}${fmtHKD(entry.amount)}\n` +
    `🏷 ${entry.cat}\n` +
    `📅 ${entry.date}\n` +
    `${clientLine}\n` +
    `Does this look right?`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✓ Yes, log it', 'confirm'), Markup.button.callback('✗ Cancel', 'cancel')],
    [Markup.button.callback(switchLabel, 'switch_type')],
  ]);

  if (editExisting) {
    return ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
  }
  return ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
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
    `/recent — last 5 entries`
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
  try {
    const snap = await db.collection('anna_tracker').get();
    const entries = snap.docs.map(d => d.data()).filter(e => e.date && e.date.startsWith(ym));
    const income = entries.filter(e => e.type === 'income').reduce((s, e) => s + (e.amount || 0), 0);
    const expense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + (e.amount || 0), 0);
    const net = income - expense;
    ctx.reply(
      `📊 *${label}* (${entries.length} entries)\n\n` +
      `💚 Income:   ${fmtHKD(income)}\n` +
      `🔴 Expenses: ${fmtHKD(expense)}\n` +
      `━━━━━━━━━━━━\n` +
      `${net >= 0 ? '💰' : '⚠️'} Net: ${net >= 0 ? '+' : ''}${fmtHKD(net)}`,
      { parse_mode: 'Markdown' }
    );
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

  // Handle "need amount" follow-up
  const state = pending.get(ctx.from.id);
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

  ctx.sendChatAction('typing');

  let entry;
  try {
    entry = parseEntry(text);
  } catch (err) {
    console.error('parseEntry error:', err.message);
    await ctx.reply("I didn't catch that — try something like \"taxi 47\" or \"oscar paid me 1200\".");
    return;
  }

  // Amount missing — ask
  if (!entry.amount || entry.amount === 0) {
    pending.set(ctx.from.id, { stage: 'need_amount', entry });
    const what = entry.desc || text;
    await ctx.reply(`Got "${what}" — how much was it? (HKD)`);
    return;
  }

  // Income vs expense unclear — ask
  if (entry.ambiguous) {
    pending.set(ctx.from.id, { stage: 'clarify_type', entry });
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
  const state = pending.get(ctx.from.id);
  if (!state || !state.entry) return ctx.reply('Session expired — please try again.');
  state.entry.type = 'income';
  if (!INCOME_CATS.includes(state.entry.cat)) state.entry.cat = 'Other income';
  await sendConfirmation(ctx, state.entry, true);
});

bot.action('type_expense', async ctx => {
  await ctx.answerCbQuery();
  const state = pending.get(ctx.from.id);
  if (!state || !state.entry) return ctx.reply('Session expired — please try again.');
  state.entry.type = 'expense';
  if (!EXPENSE_CATS.includes(state.entry.cat)) state.entry.cat = 'Misc';
  await sendConfirmation(ctx, state.entry, true);
});

bot.action('switch_type', async ctx => {
  await ctx.answerCbQuery();
  const state = pending.get(ctx.from.id);
  if (!state || !state.entry) return ctx.reply('Session expired — please try again.');
  state.entry.type = state.entry.type === 'income' ? 'expense' : 'income';
  if (state.entry.type === 'income' && !INCOME_CATS.includes(state.entry.cat)) state.entry.cat = 'Other income';
  if (state.entry.type === 'expense' && !EXPENSE_CATS.includes(state.entry.cat)) state.entry.cat = 'Misc';
  await sendConfirmation(ctx, state.entry, true);
});

bot.action('confirm', async ctx => {
  const state = pending.get(ctx.from.id);
  const entry = state && state.entry;
  if (!entry) return ctx.answerCbQuery('Entry expired — please re-send your message.');
  try {
    const id = Date.now();
    await db.collection('anna_tracker').doc(String(id)).set({
      id,
      type: entry.type,
      desc: entry.desc,
      amount: entry.amount,
      date: entry.date,
      cat: entry.cat,
      client: entry.client || '',
      notes: 'Added via Telegram',
    });
    pending.delete(ctx.from.id);
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
  pending.delete(ctx.from.id);
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
