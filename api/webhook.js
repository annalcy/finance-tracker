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

// ── Parse natural language with Gemini ────────────────────────────────────────
async function parseEntry(text) {
  const today = new Date().toISOString().split('T')[0];
  const prompt = `You are Anna's finance tracker assistant. Anna is a freelance creative (photographer/videographer) based in Hong Kong.

Parse this message and return JSON. Be generous — even short messages like "taxi 47" or "oscar 1200" are valid.

Message: "${text}"
Today: ${today}

Rules:
- "ambiguous" must be true when you genuinely cannot tell if money was RECEIVED by Anna or PAID by Anna. Example: "oscar 1200" — is Oscar a client who paid Anna, or a friend Anna paid? Mark ambiguous.
- "ambiguous" is false when the direction is obvious from context: "taxi 47" = expense, "client paid me 2000" = income, "lunch 80" = expense.
- Default to expense when not ambiguous and no income signals.
- Income signals: paid me, received, earned, laisee, shooting fee, project, invoice, sold.
- Amount is HKD. If no date mentioned, use today.
- If amount is missing or unclear, set amount to 0.

Expense categories: ${EXPENSE_CATS.join(', ')}
Income categories: ${INCOME_CATS.join(', ')}

Return ONLY valid JSON, no explanation, no markdown:
{"type":"expense","amount":0,"desc":"","date":"${today}","cat":"","client":"","ambiguous":false}`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    }),
  });
  const data = await res.json();
  if (!data.choices || !data.choices[0]) {
    throw new Error('Groq API error: ' + JSON.stringify(data.error || data));
  }
  const responseText = data.choices[0].message.content;
  const start = responseText.indexOf('{');
  const end = responseText.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in response: ' + responseText.slice(0, 100));
  return JSON.parse(responseText.slice(start, end + 1));
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
    entry = await parseEntry(text);
  } catch (err) {
    console.error('parseEntry error:', err.message);
    await ctx.reply(`ERR: ${err.message}`);
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
