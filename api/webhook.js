const { Telegraf, Markup } = require('telegraf');
const Anthropic = require('@anthropic-ai/sdk');
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

// ── Clients ────────────────────────────────────────────────────────────────────
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Category lists (must match finance_tracker.html) ──────────────────────────
const EXPENSE_CATS = [
  'Food & drinks','Transport','Socializing','Entertainment','Beauty & health',
  'Phone & subscriptions','Books & education','Gifts & treats','Travel',
  'Shopping','Music & media','Leisure','Utilities','Fees','Family','Misc',
];
const INCOME_CATS = [
  'Shooting','Video editing','Graphic design','Writing/Caption','Freelance day rate',
  'Project fee','Retainer','Sales/Resale','Event','Laisee','Other income',
];

// ── Parse natural language with Claude ────────────────────────────────────────
async function parseEntry(text) {
  const today = new Date().toISOString().split('T')[0];
  const msg = await claude.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `You are Anna's finance tracker assistant. Parse this message into a structured expense or income entry.
Today is ${today} (YYYY-MM-DD).

Message: "${text}"

Rules:
- Default to expense unless clearly income (payment received, earned, laisee, sold something)
- Amount is always in HKD
- If no date mentioned, use today
- Pick the best matching category

Expense categories: ${EXPENSE_CATS.join(', ')}
Income categories: ${INCOME_CATS.join(', ')}

Respond with JSON only, no explanation:
{
  "type": "expense" or "income",
  "amount": number,
  "desc": "short description",
  "date": "YYYY-MM-DD",
  "cat": "category from the list above",
  "client": "client/person name or empty string"
}`,
    }],
  });
  return JSON.parse(msg.content[0].text.trim());
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtHKD(n) {
  return 'HKD ' + Number(n).toLocaleString('en-HK', { maximumFractionDigits: 0 });
}

async function getMonthSummary(yearMonth) {
  const snap = await db.collection('anna_tracker').get();
  const entries = snap.docs.map(d => d.data()).filter(e => e.date && e.date.startsWith(yearMonth));
  const income = entries.filter(e => e.type === 'income').reduce((s, e) => s + (e.amount || 0), 0);
  const expense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + (e.amount || 0), 0);
  return { income, expense, net: income - expense, count: entries.length };
}

async function getRecentEntries(n = 5) {
  const snap = await db.collection('anna_tracker').orderBy('date', 'desc').limit(n).get();
  return snap.docs.map(d => d.data());
}

// ── Pending confirmations (in-memory, per user) ────────────────────────────────
const pending = new Map();

// ── Bot commands ───────────────────────────────────────────────────────────────
bot.start(ctx =>
  ctx.reply(
    `Hi Anna! 👋 I'm your finance tracker bot.\n\n` +
    `Just tell me what you spent or earned:\n` +
    `• "taxi 47 to cbeauty"\n` +
    `• "lunch 62 matchali"\n` +
    `• "momo shooting 1200"\n\n` +
    `Commands:\n` +
    `/summary — this month's overview\n` +
    `/recent — last 5 entries\n` +
    `/help — show this message`
  )
);

bot.help(ctx =>
  ctx.reply(
    `Send any expense or income in plain text and I'll log it.\n\n` +
    `Examples:\n` +
    `• "uber 85 from home"\n` +
    `• "dinner 320 with friends"\n` +
    `• "ck work 2 days 1200"\n` +
    `• "sold lkh poster 300"\n\n` +
    `/summary — monthly overview\n` +
    `/recent — last 5 entries`
  )
);

bot.command('summary', async ctx => {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const label = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  try {
    const { income, expense, net, count } = await getMonthSummary(ym);
    const sign = net >= 0 ? '+' : '';
    ctx.reply(
      `📊 *${label}* (${count} entries)\n\n` +
      `💚 Income: ${fmtHKD(income)}\n` +
      `🔴 Expenses: ${fmtHKD(expense)}\n` +
      `━━━━━━━━━━━━\n` +
      `${net >= 0 ? '💰' : '⚠️'} Net: ${sign}${fmtHKD(net)}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    ctx.reply('Could not fetch summary. Try again in a moment.');
  }
});

bot.command('recent', async ctx => {
  try {
    const entries = await getRecentEntries(5);
    if (!entries.length) return ctx.reply('No entries yet.');
    const lines = entries.map(e => {
      const sign = e.type === 'income' ? '💚 +' : '🔴 -';
      return `${sign}${fmtHKD(e.amount)}  ${e.desc}  _${e.date}_`;
    });
    ctx.reply(`*Last 5 entries:*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply('Could not fetch entries. Try again in a moment.');
  }
});

// ── Main message handler ───────────────────────────────────────────────────────
bot.on('text', async ctx => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return; // ignore unknown commands

  ctx.sendChatAction('typing');
  try {
    const entry = await parseEntry(text);
    const sign = entry.type === 'income' ? '+' : '-';
    const emoji = entry.type === 'income' ? '💚' : '🔴';
    const clientLine = entry.client ? `👤 ${entry.client}\n` : '';

    pending.set(ctx.from.id, entry);

    await ctx.reply(
      `${emoji} *${entry.desc}*\n` +
      `${sign}${fmtHKD(entry.amount)}\n` +
      `🏷 ${entry.cat}\n` +
      `📅 ${entry.date}\n` +
      `${clientLine}\n` +
      `Log this entry?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✓ Yes, log it', 'confirm'),
            Markup.button.callback('✗ Cancel', 'cancel'),
          ],
        ]),
      }
    );
  } catch (err) {
    ctx.reply(
      `Sorry, I couldn't understand that.\n` +
      `Try: "taxi 47 to cbeauty" or "lunch 62 matchali"\n` +
      `Or: "momo shooting 1200"`
    );
  }
});

bot.action('confirm', async ctx => {
  const entry = pending.get(ctx.from.id);
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
    ctx.answerCbQuery('Error saving. Try again.');
  }
});

bot.action('cancel', async ctx => {
  pending.delete(ctx.from.id);
  await ctx.editMessageText('❌ Cancelled.');
  ctx.answerCbQuery();
});

// ── Vercel serverless export ───────────────────────────────────────────────────
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
