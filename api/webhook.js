const { Telegraf, Markup } = require('telegraf');
const { db } = require('../lib/firebase');
const {
  MONTHLY_BUDGET, EXPENSE_CATS, INCOME_CATS, CAT_MAP,
  EXPENSE_CAT_BTNS, INCOME_CAT_BTNS,
} = require('../lib/constants');
const { computeGoalProgress, currentYearMonth, newlyCrossedMilestone } = require('../lib/goalCalc');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ── Smart local parser — no external API needed ───────────────────────────────
function parseEntry(text) {
  const lower = text.toLowerCase();
  const today = new Date().toISOString().split('T')[0];

  // Prefer the LAST number in the text as the amount — item names/store names
  // often contain leading digits (e.g. "711 protein tea 28"), and this bot's
  // own convention is always amount-after-description.
  const numberMatches = [...text.matchAll(/\d+(\.\d+)?/g)];
  const amountMatch = numberMatches.length ? numberMatches[numberMatches.length - 1] : null;
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
    'movie','cinema','concert','vinyl','record','entertainment','game',
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
    if (/taxi|uber|grab/.test(lower)) cat = 'Uber/Taxi';
    else if (/mtr|bus|tram|train|ferry|minibus/.test(lower)) cat = 'Transport';
    else if (/lunch|dinner|breakfast|brunch|food|eat|restaurant|cafe|coffee|drink|meal|snack|takeaway/.test(lower)) cat = 'Food & drinks';
    else if (/beauty|salon|hair|spa|nail|massage|skincare/.test(lower)) cat = 'Beauty & health';
    else if (/phone|netflix|spotify|subscription|app|wifi/.test(lower)) cat = 'Phone & subscriptions';
    else if (/shopping|clothes|shirt|dress|shoes|bag|supermarket/.test(lower)) cat = 'Shopping';
    else if (/concert|gig|festival/.test(lower)) cat = 'Concert';
    else if (/movie|cinema/.test(lower)) cat = 'Movie';
    else if (/vinyl|record|\bcd\b/.test(lower)) cat = 'CD/Vinyl';
    else if (/entertainment|game/.test(lower)) cat = 'Entertainment';
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

  // Strip only the matched amount occurrence, not the first number in the
  // string — earlier numbers (store names, product codes) stay in the desc.
  const descRaw = amountMatch
    ? text.slice(0, amountMatch.index) + text.slice(amountMatch.index + amountMatch[0].length)
    : text;
  const desc = descRaw.replace(/\s+/g, ' ').trim() || text;
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

// Due dates are almost always in the future — "in 14 days" / "30 days" —
// unlike entry dates which are almost always in the past. Falls back to
// parseRelativeDate's absolute formats (Jul 30, 30/7, ISO) for the rest.
// Returns: null = explicitly no due date, false = couldn't parse (ask again),
// otherwise an ISO date string.
function parseDueDate(text) {
  const lower = text.toLowerCase().trim();
  if (lower === 'none' || lower === 'no due date' || lower === 'skip') return null;

  const forwardDays = lower.match(/^(?:in\s+)?(\d+)\s*days?$/);
  if (forwardDays) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + parseInt(forwardDays[1]));
    return d.toISOString().split('T')[0];
  }

  return parseRelativeDate(text) || false;
}

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
    [Markup.button.callback('💰 Amount', 'edit_amount'), Markup.button.callback('📝 Description', 'edit_desc')],
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

bot.command('goal', async ctx => {
  try {
    const p = await computeGoalProgress();
    if (!p) return ctx.reply('No income goal set for this year yet.');
    const monthLabel = new Date().toLocaleString('en-US', { month: 'long' });

    let msg =
      `🎯 *${monthLabel} progress*\n\n` +
      `${fmtHKD(p.earnedThisMonth)} earned / ${fmtHKD(p.monthlyTarget)} target — ${p.pctProgress}%\n` +
      `${fmtHKD(p.remaining)} remaining\n\n` +
      `📅 Annual: ${fmtHKD(p.earnedThisYear)} / ${fmtHKD(p.annualGoal)} (${p.annualPctProgress}%)`;

    if (p.behindTarget) {
      msg += `\n\n⚠️ You're ${fmtHKD(p.behindAmount)} behind ${monthLabel}'s pace — ${p.weeksLeftInMonth} weeks left.`;
      if (p.unpaidInvoices.length) {
        const clients = [...new Set(p.unpaidInvoices.map(i => i.client))].join(' and ');
        msg += `\n\nYou have ${fmtHKD(p.unpaidTotal)} outstanding from ${clients} — follow up?`;
      }
    }

    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('goal command error:', e);
    ctx.reply('Could not fetch your goal progress right now. Try again in a moment.');
  }
});

bot.command('invoices', async ctx => {
  try {
    const snap = await db.collection('anna_invoices').where('status', '==', 'unpaid').get();
    if (!snap.docs.length) return ctx.reply('No outstanding invoices. 🎉');
    const today = new Date().toISOString().split('T')[0];
    const invoices = snap.docs.map(d => {
      const inv = d.data();
      const daysOverdue = inv.dueDate && inv.dueDate < today
        ? Math.floor((new Date(today) - new Date(inv.dueDate)) / 86400000)
        : 0;
      return { ...inv, daysOverdue };
    }).sort((a, b) => b.daysOverdue - a.daysOverdue);

    const lines = invoices.map(i => {
      const overdueNote = i.daysOverdue > 0 ? ` — ⚠️ ${i.daysOverdue}d overdue` : i.dueDate ? ` — due ${i.dueDate}` : '';
      return `${fmtHKD(i.amount)}  ${i.client}${overdueNote}`;
    });
    const total = invoices.reduce((s, i) => s + (i.amount || 0), 0);
    ctx.reply(
      `*Outstanding invoices* (${fmtHKD(total)} total)\n\n${lines.join('\n')}\n\n_Use /addinvoice to add a new one._`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.error('invoices command error:', e);
    ctx.reply('Could not fetch invoices right now. Try again in a moment.');
  }
});

bot.command('addinvoice', async ctx => {
  await setSession(ctx.from.id, { flow: 'invoice', stage: 'invoice_client', invoice: {} });
  await ctx.reply('Which client is this invoice for?');
});

// ── Main text handler ──────────────────────────────────────────────────────────
bot.on('text', async ctx => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const userId = ctx.from.id;
  const state = await getSession(userId);

  if (state && state.flow === 'invoice') {
    if (state.stage === 'invoice_client') {
      state.invoice.client = text.trim();
      state.stage = 'invoice_amount';
      await setSession(userId, state);
      await ctx.reply(`How much (HKD)?`);
      return;
    }
    if (state.stage === 'invoice_amount') {
      const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
      if (!amount || isNaN(amount)) {
        await ctx.reply('Just the number please — e.g. "5000"');
        return;
      }
      state.invoice.amount = amount;
      state.stage = 'invoice_duedate';
      await setSession(userId, state);
      await ctx.reply(`When's it due? e.g. "in 14 days", "Jul 30", "30/7", or "none"`);
      return;
    }
    if (state.stage === 'invoice_duedate') {
      const dueDate = parseDueDate(text.trim());
      if (dueDate === false) {
        await ctx.reply('Didn\'t get that — try "in 14 days", "Jul 30", "30/7", or "none".');
        return;
      }
      const id = Date.now();
      const invoice = {
        id,
        client: state.invoice.client,
        amount: state.invoice.amount,
        issueDate: new Date().toISOString().split('T')[0],
        dueDate,
        status: 'unpaid',
        paidDate: null,
        linkedEntryId: null,
        notes: '',
        followUpSentAt: null,
        createdAt: Date.now(),
      };
      await db.collection('anna_invoices').doc(String(id)).set(invoice);
      await clearSession(userId);
      const dueLine = dueDate ? `, due ${dueDate}` : '';
      await ctx.reply(`✅ Invoice logged: ${fmtHKD(invoice.amount)} from *${invoice.client}*${dueLine}`, { parse_mode: 'Markdown' });
      return;
    }
  }

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

  if (state && state.stage === 'edit_amount') {
    const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
    if (!amount || isNaN(amount)) {
      await ctx.reply('Just the number please — e.g. "28"');
      return;
    }
    state.entry.amount = amount;
    await sendConfirmation(ctx, state.entry);
    return;
  }

  if (state && state.stage === 'edit_desc') {
    const desc = text.trim().slice(0, 60);
    if (!desc) {
      await ctx.reply('Description can\'t be empty — try again.');
      return;
    }
    state.entry.desc = desc;
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

bot.action('edit_amount', async ctx => {
  await ctx.answerCbQuery();
  const state = await getSession(ctx.from.id);
  if (!state || !state.entry) return ctx.reply('Session expired — please try again.');
  await setSession(ctx.from.id, { ...state, stage: 'edit_amount' });
  await ctx.reply(`Current amount: *${fmtHKD(state.entry.amount)}*\n\nWhat's the correct amount? Just the number, e.g. "28"`, { parse_mode: 'Markdown' });
});

bot.action('edit_desc', async ctx => {
  await ctx.answerCbQuery();
  const state = await getSession(ctx.from.id);
  if (!state || !state.entry) return ctx.reply('Session expired — please try again.');
  await setSession(ctx.from.id, { ...state, stage: 'edit_desc' });
  await ctx.reply(`Current description: *${state.entry.desc}*\n\nWhat should it say instead?`, { parse_mode: 'Markdown' });
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

    let budgetLine = '';
    if (entry.type === 'expense') {
      const ym = newEntry.date.slice(0, 7);
      const monthTotal = cached
        .filter(e => e.type === 'expense' && e.date && e.date.startsWith(ym))
        .reduce((s, e) => s + (e.amount || 0), 0);
      const pct = Math.round((monthTotal / MONTHLY_BUDGET) * 100);
      const emoji = pct >= 100 ? '🚨' : pct >= 80 ? '⚠️' : '💰';
      budgetLine = `\n\n${emoji} This month: ${fmtHKD(monthTotal)} / ${fmtHKD(MONTHLY_BUDGET)} (${pct}%)`;
    }

    await ctx.editMessageText(
      `✅ Logged: *${entry.desc}* ${sign}${fmtHKD(entry.amount)}${budgetLine}`,
      { parse_mode: 'Markdown' }
    );
    ctx.answerCbQuery('Saved!');

    // Milestone + invoice follow-ups only apply to income — fire as separate
    // messages so they don't block or clutter the "Logged" receipt above.
    if (entry.type === 'income') {
      await checkMilestone(ctx, newEntry, cached);
      await checkInvoiceMatch(ctx, newEntry);
    }
  } catch (err) {
    console.error('save error:', err);
    ctx.answerCbQuery('Error saving — try again.');
  }
});

async function checkMilestone(ctx, newEntry, cachedEntries) {
  try {
    const { year } = currentYearMonth();
    const goalDoc = await db.collection('anna_income_goals').doc(year).get();
    if (!goalDoc.exists) return;
    const goal = goalDoc.data();

    const yearIncome = cachedEntries.filter(e => e.type === 'income' && e.date && e.date.startsWith(year));
    const incomeAfter = yearIncome.reduce((s, e) => s + (e.amount || 0), 0);
    const incomeBefore = incomeAfter - newEntry.amount;

    const crossed = newlyCrossedMilestone(goal.annualGoal, goal.milestones || {}, incomeBefore, incomeAfter);
    if (!crossed) return;

    await db.collection('anna_income_goals').doc(year).set(
      { milestones: { ...(goal.milestones || {}), [crossed]: true } },
      { merge: true }
    );

    const emoji = crossed >= 100 ? '🎉🎉🎉' : crossed >= 75 ? '🎉🎊' : '🎉';
    await ctx.reply(`${emoji} You just hit ${crossed}% of your ${year} income goal (${fmtHKD(goal.annualGoal)})!`);
  } catch (err) {
    console.error('milestone check error:', err);
  }
}

async function checkInvoiceMatch(ctx, newEntry) {
  try {
    if (!newEntry.client) return;
    const snap = await db.collection('anna_invoices').where('status', '==', 'unpaid').get();
    const match = snap.docs.find(d => (d.data().client || '').toLowerCase() === newEntry.client.toLowerCase());
    if (!match) return;
    const invoice = match.data();
    await ctx.reply(
      `Mark invoice from *${invoice.client}* (${fmtHKD(invoice.amount)}) as paid?`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
        [Markup.button.callback('✓ Yes, mark paid', `invoice_paid_${invoice.id}`), Markup.button.callback('✗ Not yet', 'invoice_paid_dismiss')],
      ]) }
    );
  } catch (err) {
    console.error('invoice match check error:', err);
  }
}

bot.action(/^invoice_paid_(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const id = ctx.match[1];
  try {
    await db.collection('anna_invoices').doc(id).set(
      { status: 'paid', paidDate: new Date().toISOString().split('T')[0] },
      { merge: true }
    );
    await ctx.editMessageText('✅ Invoice marked as paid.');
  } catch (err) {
    console.error('mark invoice paid error:', err);
    await ctx.editMessageText('Could not update the invoice — try /invoices to manage it manually.');
  }
});

bot.action('invoice_paid_dismiss', async ctx => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('OK, left as unpaid.');
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
