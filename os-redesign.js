/* Personal OS: navigation, daily spending, and monthly reports. Existing tools
   and their API handlers remain the source of truth. */
function osEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function osMonthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}
function osMonthlyEntries(entries, year, month) {
  const prefix = osMonthKey(year, month) + '-';
  return entries.filter(e => typeof e.date === 'string' && e.date.startsWith(prefix));
}
function osScopeEntries(entries, scope, year, month) {
  if (scope === 'alltime') return entries;
  if (scope === 'year') return entries.filter(e => typeof e.date === 'string' && e.date.startsWith(`${year}-`));
  return osMonthlyEntries(entries, year, month);
}
function osTotals(entries) {
  return entries.reduce((out, entry) => {
    const amount = Number(entry.amount);
    if (Number.isFinite(amount) && (entry.type === 'income' || entry.type === 'expense')) out[entry.type] += amount;
    return out;
  }, { income: 0, expense: 0 });
}
function osSpendingLevel(amount, budget) {
  if (amount <= 0) return 'zero';
  if (amount <= budget) return 'low';
  return amount <= budget * 1.5 ? 'medium' : 'high';
}
function osMonthModel(entries, year, month, budget) {
  const rows = osMonthlyEntries(entries, year, month);
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const days = Array.from({ length: count }, (_, index) => {
    const date = `${osMonthKey(year, month)}-${String(index + 1).padStart(2, '0')}`;
    const daily = rows.filter(e => e.date.slice(0, 10) === date);
    const total = osTotals(daily);
    return { day: index + 1, date, entries: daily, ...total, level: osSpendingLevel(total.expense, budget) };
  });
  return { days, entries: rows, offset: (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7, ...osTotals(rows) };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { osMonthlyEntries, osTotals, osSpendingLevel, osMonthModel, osScopeEntries };
}

let osSelectedDate = null;
let osPendingNavigation = null;
const osPageInfo = {
  today: ['Today', 'A little space to focus on what matters.'],
  calendar: ['Your calendar', 'Make room for work, and everything around it.'],
  insights: ['Productivity insights', 'Your clients, workload, and progress at a glance.'],
  overview: ['Money overview', 'The bigger picture, without the noise.'],
  spending: ['Spending calendar', 'Your daily spending, in one view.'],
  add: ['Add an entry', 'Keep the little things accounted for.'],
  records: ['Your records', 'Every entry, whenever you need it.'],
  reports: ['Reports', 'From this month to the whole story.'],
  import: ['Import records', 'Bring your past records into the picture.']
};
function navigateOs(page, reportView) {
  if (page === 'reports' && !reportView) reportView = 'month';
  osPendingNavigation = { page, reportView };
  const finance = !['today', 'calendar', 'insights'].includes(page);
  if (finance && sessionStorage.getItem('ft_unlocked') !== '1') {
    showCategory('finance');
    document.querySelector('.shell').classList.remove('menu-open');
    return;
  }
  if (_activeCategory !== (finance ? 'finance' : 'productivity')) showCategory(finance ? 'finance' : 'productivity');
  showPage(page);
  if (reportView) setReportView(reportView);
  osPendingNavigation = null;
  document.querySelector('.shell').classList.remove('menu-open');
  document.querySelector('.menu-toggle').setAttribute('aria-expanded', 'false');
  window.scrollTo({top: 0, behavior: 'instant'});
}
function resumeOsNavigation() {
  const pending = osPendingNavigation;
  showCategory('finance');
  if (pending) navigateOs(pending.page, pending.reportView);
}
function toggleOsMenu() {
  const open = document.querySelector('.shell').classList.toggle('menu-open');
  document.querySelector('.menu-toggle').setAttribute('aria-expanded', String(open));
}
function syncOsShell(locked = false) {
  const shell = document.querySelector('.shell');
  shell.dataset.section = _activeCategory;
  shell.dataset.page = locked ? 'locked' : _currentPage;
  const [title, sub] = locked ? ['Your money', 'A private space for your finances.'] : (osPageInfo[_currentPage] || osPageInfo.today);
  const reportTitles = {investments:'Investments',invoices:'Invoices',goal:'Income goal'};
  document.querySelector('.brand-heading').textContent = !locked && _currentPage==='reports' ? (reportTitles[_reportView] || title) : title;
  document.getElementById('brand-sub').textContent = sub;
  let active = _currentPage;
  if (active === 'reports' && ['investments', 'invoices'].includes(_reportView)) active = _reportView;
  document.querySelectorAll('.os-nav[data-nav]').forEach(button => {
    const selected = !locked && button.dataset.nav === active;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const add = document.getElementById('header-add');
  add.textContent = _activeCategory === 'finance' ? '+ Add entry' : '+ Add task';
  add.hidden = locked;
}
function osQuickAdd() {
  if (_activeCategory === 'finance') { cancelEdit(); navigateOs('add'); }
  else { navigateOs('today'); toggleTodayAddTask(); }
}
function osCurrency(amount) {
  return (Number(amount)<0?'−':'') + 'HK$' + Math.abs(Number(amount)).toLocaleString('en-HK', { maximumFractionDigits: 2 });
}
function osMonthLabel() {
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(selYear, selMonth, 1)));
}
function osPeriodControls(handler) {
  return `<div class="os-period"><button class="btn month-arrow" onclick="osShiftMonth(-1,'${handler}')" aria-label="Previous month">‹</button><label class="period-picker"><span>${osMonthLabel()}</span><input aria-label="Choose month" type="month" min="1900-01" max="9999-12" value="${osMonthKey(selYear,selMonth)}" onchange="osSetMonth(this.value,'${handler}')"></label><button class="btn month-arrow" onclick="osShiftMonth(1,'${handler}')" aria-label="Next month">›</button></div>`;
}
function osSetMonth(value, handler) {
  if (!/^\d{4}-\d{2}$/.test(value)) return;
  const [year, month] = value.split('-').map(Number);
  if (year < 1900 || year > 9999 || month < 1 || month > 12) return;
  selYear = year; selMonth = month - 1; osSelectedDate = null;
  if (handler === 'report') renderMonthlyReport(); else renderSpendingCalendar();
}
function osShiftMonth(delta, handler) {
  const date = new Date(Date.UTC(selYear, selMonth + delta, 1));
  osSetMonth(osMonthKey(date.getUTCFullYear(),date.getUTCMonth()), handler);
}
function osDailyBudget() {
  const custom = Number(localStorage.getItem('os_daily_budget'));
  const days = new Date(Date.UTC(selYear,selMonth+1,0)).getUTCDate();
  return custom > 0 && Number.isFinite(custom) ? custom : Math.round(MONTHLY_BUDGET / days * 100) / 100;
}
function osSaveDailyBudget(event) {
  event.preventDefault();
  const value = Number(document.getElementById('daily-budget-input').value);
  if (!Number.isFinite(value) || value <= 0) return;
  localStorage.setItem('os_daily_budget', String(value));
  renderSpendingCalendar();
}
function osResetDailyBudget() {
  localStorage.removeItem('os_daily_budget'); renderSpendingCalendar();
}
function renderSpendingCalendar() {
  const budget = osDailyBudget();
  const model = osMonthModel(getEntries(), selYear, selMonth, budget);
  const todayKey = today();
  if (!osSelectedDate || !model.days.some(day => day.date === osSelectedDate)) {
    osSelectedDate = model.days.find(day => day.date === todayKey)?.date || [...model.days].reverse().find(day => day.entries.length)?.date || model.days[0].date;
  }
  const selected = model.days.find(day => day.date === osSelectedDate);
  const cells = Array.from({length:model.offset}, () => '<div class="spend-day outside" aria-hidden="true"></div>');
  const levelLabel = { zero: 'No expenses logged', low: 'Within daily budget', medium: 'Above daily budget', high: 'High spending' };
  model.days.forEach(day => {
    const future = day.date > todayKey && !day.entries.length;
    cells.push(`<button id="spend-day-${day.day}" class="spend-day ${future?'future':day.level}${day.date===osSelectedDate?' selected':''}${day.date===todayKey?' is-today':''}" onclick="osSelectDay('${day.date}')" aria-pressed="${day.date===osSelectedDate}" aria-label="${day.date}: ${future?'No entries yet':osCurrency(day.expense)+' spent, '+levelLabel[day.level]}"><span class="spend-date">${day.day}${day.date===todayKey?'<i></i>':''}</span><span class="spend-amount">${future?'—':osCurrency(day.expense).replace('HK$', '<span class="currency-prefix">HK$</span>')}</span>${day.income?'<span class="income-dot" title="Income logged" aria-label="Income logged"></span>':''}</button>`);
  });
  while (cells.length % 7) cells.push('<div class="spend-day outside" aria-hidden="true"></div>');
  document.getElementById('spending-content').innerHTML = `
    <div class="view-toolbar"><span class="eyebrow">A day-by-day picture</span>${osPeriodControls('calendar')}</div>
    ${osSummaryHTML(model)}
    <div class="spending-layout">
      <section class="spending-board" aria-label="Daily expense totals">
        <div class="spending-board-head"><h3>${osMonthLabel()}</h3><span class="muted">Expenses · HKD</span></div>
        <div class="spend-weekdays">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>'<span>'+d+'</span>').join('')}</div>
        <div class="spend-grid">${cells.join('')}</div>
        <div class="spend-legend"><span><i class="zero"></i>No expenses</span><span><i class="low"></i>Within budget</span><span><i class="medium"></i>Up to 1.5× budget</span><span><i class="high"></i>Over 1.5× budget</span></div>
        <details class="daily-budget-settings"><summary>Daily budget ${osCurrency(budget)} <span>Adjust</span></summary><form onsubmit="osSaveDailyBudget(event)"><label for="daily-budget-input">Daily expense budget (HK$)</label><div class="budget-input-row"><input id="daily-budget-input" type="number" min="0.01" step="0.01" required value="${budget}"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" onclick="osResetDailyBudget()">Use monthly budget</button></div><p>By default, your ${osCurrency(MONTHLY_BUDGET)} monthly budget is divided by the number of days. A custom daily budget changes the colours, not your monthly budget.</p></form></details>
      </section>
      <aside class="spending-detail" aria-label="Selected day details">
        <div class="eyebrow">A closer look</div><h3>${new Intl.DateTimeFormat('en',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(selected.date+'T12:00:00Z'))}</h3>
        <div class="daily-total">${osCurrency(selected.expense)}</div><span class="spend-status ${selected.level}">${levelLabel[selected.level]}</span>
        <div class="day-transactions">${selected.entries.length?selected.entries.map(entry=>`<button class="day-transaction" onclick="editEntry(${Number(entry.id)})" aria-label="Edit ${osEscape(entry.desc)}"><span><strong>${osEscape(entry.desc)}</strong><small>${osEscape(entry.cat)}${entry.client?' · '+osEscape(entry.client):''}</small></span><span class="${entry.type==='income'?'positive':''}">${entry.type==='income'?'+':'−'}${osCurrency(Number(entry.amount))}</span></button>`).join(''):'<div class="empty-day"><span>Nothing logged here yet.</span><p>Add an entry or send it through Telegram.</p></div>'}</div>
        ${selected.income?`<div class="day-income">Income received <strong>${osCurrency(selected.income)}</strong></div>`:''}
        <button class="text-action" onclick="osAddForDay('${selected.date}')">+ Add an entry for this day</button>
        <div class="day-budget"><span class="muted">Monthly budget</span><strong>${osCurrency(Math.abs(MONTHLY_BUDGET-model.expense))} ${model.expense>MONTHLY_BUDGET?'over budget':'left'}</strong><div class="quiet-progress"><span style="width:${Math.min(100,model.expense/MONTHLY_BUDGET*100)}%;background:var(--${model.expense>MONTHLY_BUDGET?'negative':'accent-soft'})"></span></div><small>${osCurrency(model.expense)} of ${osCurrency(MONTHLY_BUDGET)}</small></div>
      </aside>
    </div>
    <div class="report-shortcuts"><span>See the bigger picture</span><button onclick="navigateOs('reports','month')">Monthly report ↗</button><button onclick="navigateOs('reports','year')">By year ↗</button><button onclick="navigateOs('reports','alltime')">All time ↗</button><button onclick="osViewMonthRecords()">All records ↗</button></div>`;
}
function osSummaryHTML(model) {
  const net = model.income - model.expense;
  return `<div class="os-money-summary"><div><span><i class="summary-dot sage"></i>Income</span><strong>${osCurrency(model.income)}</strong></div><div><span><i class="summary-dot clay"></i>Expenses</span><strong>${osCurrency(model.expense)}</strong></div><div><span><i class="summary-dot stone"></i>Net</span><strong${net<0?' class="negative"':''}>${osCurrency(net)}</strong></div></div>`;
}
function osSelectDay(date) {
  osSelectedDate = date; renderSpendingCalendar();
  document.getElementById('spend-day-'+Number(date.slice(-2)))?.focus({preventScroll:true});
}
function osAddForDay(date) {
  cancelEdit(); showPage('add'); document.getElementById('f-date').value = date;
}
function osViewMonthRecords() {
  navigateOs('records');
  document.getElementById('f-type').value = 'all';
  document.getElementById('f-cat-filter').value = '';
  document.getElementById('f-search').value = '';
  document.getElementById('f-month-filter').value = osMonthKey(selYear, selMonth);
  renderRecords();
}
function osCategoryHTML(entries, type, limit = Infinity) {
  const totals = new Map();
  entries.filter(e=>e.type===type).forEach(e=>totals.set(e.cat||'Uncategorised',(totals.get(e.cat||'Uncategorised')||0)+Number(e.amount||0)));
  const sorted = [...totals].sort((a,b)=>b[1]-a[1]);
  const total = sorted.reduce((sum,[,amount])=>sum+amount,0);
  const row = ([cat,amount]) => `<div class="month-category"><div><span>${osEscape(cat)}</span><strong><small>${total?Math.round(amount/total*100):0}%</small> ${osCurrency(amount)}</strong></div><div class="quiet-progress"><span style="width:${total?amount/total*100:0}%;background:var(--${type==='income'?'accent-soft':'negative-soft'})"></span></div></div>`;
  if (!sorted.length) return '<p class="no-entries">No '+type+' logged in this period.</p>';
  return sorted.slice(0,limit).map(row).join('')+(sorted.length>limit?`<details class="category-more"><summary>Show ${sorted.length-limit} more categories</summary>${sorted.slice(limit).map(row).join('')}</details>`:'');
}
function renderMonthlyReport() {
  const entries = osMonthlyEntries(getEntries(),selYear,selMonth);
  const totals = osTotals(entries);
  const previousDate = new Date(Date.UTC(selYear,selMonth-1,1));
  const prev = osTotals(osMonthlyEntries(getEntries(),previousDate.getUTCFullYear(),previousDate.getUTCMonth()));
  const highest = osMonthModel(entries,selYear,selMonth,osDailyBudget()).days.reduce((a,b)=>b.expense>a.expense?b:a);
  const delta = totals.expense-prev.expense;
  document.getElementById('report-view-month').innerHTML = `<div class="view-toolbar"><span class="eyebrow">Your month in focus</span>${osPeriodControls('report')}</div>${osSummaryHTML(totals)}
    <div class="monthly-notes"><div><span>Compared with last month</span><strong>${delta===0?'No change in expenses':osCurrency(Math.abs(delta))+(delta>0?' more spent':' less spent')}</strong></div><div><span>Highest spending day</span><strong>${highest.expense?`${highest.day} ${MONTHS[selMonth]} · ${osCurrency(highest.expense)}`:'No expenses logged'}</strong></div><div><span>Entries this month</span><strong>${entries.length} records</strong></div></div>
    <div class="monthly-breakdowns"><section class="form-card"><h3>Where your money went</h3>${osCategoryHTML(entries,'expense')}</section><section class="form-card"><h3>Where your income came from</h3>${osCategoryHTML(entries,'income')}</section></div>
    <div class="os-card"><div class="os-card-head"><h3>Every entry this month</h3><button class="text-action" onclick="osViewMonthRecords()">Open records ↗</button></div><div class="os-card-body"><div class="tbl-head"><span>Description</span><span>Category</span><span>Date</span><span class="thr">Amount</span><span></span></div>${entries.length?entries.map(entryHTML).join(''):'<div class="no-entries">No entries for '+osMonthLabel()+'. Choose another month to explore your history.</div>'}</div></div>`;
}
if (typeof document !== 'undefined') {
  if (typeof Chart !== 'undefined') Chart.defaults.font.family = "'DM Sans', sans-serif";
  syncOsShell(_activeCategory==='finance' && sessionStorage.getItem('ft_unlocked')!=='1');
  document.addEventListener('click', event => {
    if (!event.target.closest('.rail') && !event.target.closest('.menu-toggle')) {
      document.querySelector('.shell').classList.remove('menu-open');
      document.querySelector('.menu-toggle').setAttribute('aria-expanded','false');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      document.querySelector('.shell').classList.remove('menu-open');
      document.querySelector('.menu-toggle').setAttribute('aria-expanded','false');
      document.getElementById('settings-popover').classList.remove('open');
    }
  });
}

// Money overview: one set of totals, categories and records for each scope.
let osOverviewScope = 'month';
function setOverviewScope(scope) {
  if (!['month','year','alltime'].includes(scope)) return;
  osOverviewScope = scope;
  renderMoneyOverview();
}
function openOverviewReport() {
  repYear = selYear;
  navigateOs('reports', osOverviewScope === 'alltime' ? 'alltime' : osOverviewScope === 'year' ? 'year' : 'month');
}
function renderMoneyOverview() {
  document.getElementById('page-overview').dataset.scope = osOverviewScope;
  const entries = getEntries();
  const scoped = osScopeEntries(entries, osOverviewScope, selYear, selMonth);
  const totals = osTotals(scoped);
  const all = osOverviewScope === 'alltime';
  const monthly = osOverviewScope === 'month';
  const caption = all ? 'Across your full history' : monthly ? osMonthLabel() : String(selYear);
  document.querySelectorAll('[data-scope]').forEach(button => {
    const active = button.dataset.scope === osOverviewScope;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.getElementById('overview-period-caption').textContent = caption;
  const years = [...new Set(entries.map(e => Number(String(e.date).slice(0,4))).filter(Number.isFinite).concat(selYear))].sort((a,b)=>b-a);
  const yearPills = document.getElementById('overview-year-pills');
  yearPills.style.display = all ? 'none' : '';
  yearPills.innerHTML = years.map(year=>`<button class="pill${year===selYear?' active':''}" onclick="selYear=${year};renderMoneyOverview()">${year}</button>`).join('');
  const monthPills = document.getElementById('overview-month-pills');
  monthPills.style.display = monthly ? '' : 'none';
  monthPills.innerHTML = MONTHS.map((name,month)=>`<button class="pill${month===selMonth?' active':''}" onclick="selMonth=${month};renderMoneyOverview()">${name}</button>`).join('');
  document.getElementById('metrics').innerHTML = `<div class="metric"><div class="metric-label">Income</div><div class="metric-value">${osCurrency(totals.income)}</div></div><div class="metric"><div class="metric-label">Expenses</div><div class="metric-value">${osCurrency(totals.expense)}</div></div><div class="metric"><div class="metric-label">Net</div><div class="metric-value${totals.income<totals.expense?' negative':''}">${osCurrency(totals.income-totals.expense)}</div></div>`;
  document.getElementById('overview-categories').innerHTML = `<div class="overview-category-heading"><h3>Inside your money</h3><span class="muted">${osEscape(caption)} · ${scoped.length.toLocaleString()} records</span></div><div class="monthly-breakdowns overview-breakdowns"><section class="form-card"><div class="category-panel-title"><span class="category-mark expense-mark">↗</span><h3>Spending by category</h3></div>${osCategoryHTML(scoped,'expense',6)}</section><section class="form-card"><div class="category-panel-title"><span class="category-mark income-mark">↙</span><h3>Income by category</h3></div>${osCategoryHTML(scoped,'income',6)}</section></div>`;
  document.getElementById('overview-entries-title').textContent = monthly ? 'Entries this month' : all ? 'Latest entries · all time' : `Latest entries · ${selYear}`;
  const visible = monthly ? scoped : scoped.slice(0,20);
  document.getElementById('recent-entries').innerHTML = visible.length ? visible.map(entryHTML).join('') : '<div class="no-entries">No entries in this period. Choose another month or year to explore your history.</div>';
  document.getElementById('budget-card').style.display = monthly ? '' : 'none';
  if (monthly) renderBudget(totals.expense);
  // These existing cards are explicitly about the selected month/current week.
  if (monthly) {renderGoalCard();renderWeekCard();loadIncomePred();}
  else ['goal-card','week-card','income-pred-card'].forEach(id=>document.getElementById(id).style.display='none');
}

function osClientIcon(name) {
  const icons = ['🌿','🎬','🎧','🎨','☀️','🪴','🧩','📷','🍊','🌼','🪁','💎'];
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return icons[hash % icons.length];
}
function osClientWorkModel(tasks, normalize, dateOf, todayKey) {
  const clients = new Map();
  for (const task of tasks) {
    const name = normalize(task.client);
    if (!clients.has(name)) clients.set(name, {name, count:0,done:0,open:0,overdue:0,onTime:0,knownTiming:0,turnaround:[],active:[]});
    const row = clients.get(name);
    row.count++;
    if (task.status === 'done') {
      row.done++;
      const completed = dateOf(task);
      if (completed && task.deadlineDate) {row.knownTiming++;if(completed<=task.deadlineDate)row.onTime++;}
      const created = new Date(task.createdAt);
      if (completed && task.createdAt && !Number.isNaN(created.getTime())) {
        const days = Math.round((Date.parse(completed+'T00:00:00Z')-Date.parse(created.toISOString().slice(0,10)+'T00:00:00Z'))/86400000);
        if (days>=0) row.turnaround.push(days);
      }
    } else {
      row.open++;
      row.active.push(task);
      if (task.deadlineDate && task.deadlineDate<todayKey) row.overdue++;
    }
  }
  return [...clients.values()].sort((a,b)=>b.overdue-a.overdue||b.open-a.open||b.count-a.count||a.name.localeCompare(b.name));
}
function osClientHealthModel(tasks, entries, invoices, normalize, dateOf, todayKey) {
  const month = todayKey.slice(0,7);
  const clients = new Map();
  function get(name) {
    if (!clients.has(name)) clients.set(name,{name,done:0,open:0,overdue:0,hours:0,income:0,unpaid:0,unpaidCount:0,overdueInvoices:0,paidDays:[]});
    return clients.get(name);
  }
  for (const task of tasks) {
    const name = normalize(task.client);
    if (name==='(no client)') continue;
    const doneThisMonth = task.status==='done' && dateOf(task)?.startsWith(month);
    const openThisMonth = task.status!=='done' && task.deadlineDate?.startsWith(month);
    const overdue = task.status!=='done' && task.deadlineDate && task.deadlineDate<todayKey;
    if (!doneThisMonth && !openThisMonth && !overdue) continue;
    const row = get(name);
    if (doneThisMonth) row.done++;
    if (openThisMonth) row.open++;
    if (overdue) row.overdue++;
    if (doneThisMonth || openThisMonth) row.hours += (Number(task.estimateMinutes)||0)/60;
  }
  for (const entry of entries) {
    if (entry.type==='income' && entry.client && entry.date?.startsWith(month)) get(normalize(entry.client)).income+=Number(entry.amount)||0;
  }
  for (const invoice of invoices) {
    if (!invoice.client) continue;
    const name = normalize(invoice.client);
    if (invoice.status==='unpaid') {
      const row = get(name);
      row.unpaid += Number(invoice.amount)||0;
      row.unpaidCount++;
      if (invoice.dueDate && invoice.dueDate<todayKey) row.overdueInvoices++;
    }
  }
  // Historical payment speed is context for active clients, not activity itself.
  for (const invoice of invoices) {
    const row = clients.get(normalize(invoice.client));
    if (!row || invoice.status!=='paid' || !invoice.issueDate || !invoice.paidDate) continue;
    const days = Math.round((Date.parse(invoice.paidDate+'T00:00:00Z')-Date.parse(invoice.issueDate+'T00:00:00Z'))/86400000);
    if (Number.isFinite(days) && days>=0) row.paidDays.push(days);
  }
  return [...clients.values()].sort((a,b)=>(b.overdue+b.overdueInvoices)-(a.overdue+a.overdueInvoices)||b.unpaidCount-a.unpaidCount||b.open-a.open||a.name.localeCompare(b.name));
}
function osClientDisplayName(name) {return name==='(no client)'?'Personal / unassigned':name;}
function osClientCardsHTML(cards) {
  return cards.slice(0,4).join('')+(cards.length>4?`<details class="more-client-cards"><summary>Show ${cards.length-4} more clients</summary><div class="client-card-grid">${cards.slice(4).join('')}</div></details>`:'');
}
function renderClientWorkCards() {
  const rows = osClientWorkModel(_tasksAll,normalizeClientName,taskDoneDateStr,today());
  const el = document.getElementById('insights-client-chart');
  if (!rows.length) {el.innerHTML='<div class="client-empty"><span aria-hidden="true">🌱</span><h4>Your clients will appear here</h4><p>Add a client name to a task to start seeing your workload.</p><button class="text-action" onclick="osQuickAdd()">+ Add a task</button></div>';return;}
  const cards = rows.map(row=>{
    const pct = Math.round(row.done/row.count*100);
    const timing = row.knownTiming?Math.round(row.onTime/row.knownTiming*100)+'% on time':'No completion timing yet';
    const average = row.turnaround.length?Math.round(row.turnaround.reduce((sum,n)=>sum+n,0)/row.turnaround.length*10)/10:null;
    const active = [...row.active].sort((a,b)=>(a.deadlineDate||'9999').localeCompare(b.deadlineDate||'9999'));
    return `<article class="client-work-card"><header class="client-card-header"><span class="client-avatar" aria-hidden="true">${row.name==='(no client)'?'🏡':osClientIcon(row.name)}</span><div><h4>${osEscape(osClientDisplayName(row.name))}</h4><span>${row.count} task${row.count===1?'':'s'} in total</span></div>${row.overdue?'<span class="client-status needs-attention">⏰ '+row.overdue+' overdue</span>':row.open?'<span class="client-status in-progress">In progress</span>':'<span class="client-status on-track">✓ All done</span>'}</header><div class="client-work-stats"><div><span aria-hidden="true">📌</span><strong>${row.open}</strong><small>Open</small></div><div><span aria-hidden="true">✅</span><strong>${row.done}</strong><small>Done</small></div><div><span aria-hidden="true">⏰</span><strong class="${row.overdue?'negative':''}">${row.overdue}</strong><small>Overdue</small></div></div><div class="client-progress-caption"><span>Completed</span><strong>${pct}%</strong></div><div class="quiet-progress client-progress" role="progressbar" aria-label="${osEscape(osClientDisplayName(row.name))} tasks completed" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%;background:var(--accent-soft)"></span></div><div class="client-card-foot"><span>🎯 ${timing}</span>${average!=null?`<span>↳ ${average} days avg turnaround</span>`:''}</div>${active.length?`<details class="client-task-details"><summary>See ${active.length} open task${active.length===1?'':'s'}</summary>${active.map(task=>`<div class="client-task-preview"><span>${osEscape(task.desc||'Untitled task')}</span><small class="${task.deadlineDate&&task.deadlineDate<today()?'negative':''}">${task.deadlineDate?'Due '+osEscape(task.deadlineDate):'No deadline'}</small></div>`).join('')}</details>`:''}</article>`;
  });
  el.innerHTML = osClientCardsHTML(cards);
}
function renderClientHealthCards() {
  const todayKey = today();
  const rows = osClientHealthModel(_tasksAll,_entries||[],_invoices||[],normalizeClientName,taskDoneDateStr,todayKey);
  document.getElementById('client-health-period').textContent = new Intl.DateTimeFormat('en',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(todayKey+'T12:00:00Z'));
  const el = document.getElementById('insights-client-health');
  if (!rows.length) {el.innerHTML='<div class="client-empty"><span aria-hidden="true">🌤️</span><h4>A quiet month so far</h4><p>Client activity, income, and unpaid invoices will appear here as you log them.</p></div>';return;}
  const cards = rows.map(row=>{
    const attention = row.overdue || row.overdueInvoices;
    const tone = attention?'needs-attention':row.unpaidCount?'awaiting-payment':row.open?'in-progress':'on-track';
    const status = row.overdueInvoices?'🧾 Payment overdue':row.overdue?'⏰ Overdue work':row.unpaidCount?'🧾 Payment pending':row.open?'📌 In progress':'✓ Up to date';
    const notes = [];
    if (row.overdue) notes.push(`${row.overdue} overdue task${row.overdue===1?'':'s'}`);
    if (row.overdueInvoices) notes.push(`${row.overdueInvoices} overdue invoice${row.overdueInvoices===1?'':'s'}`);
    const avgPay = row.paidDays.length?Math.round(row.paidDays.reduce((sum,n)=>sum+n,0)/row.paidDays.length):null;
    return `<article class="client-health-card ${tone}"><header class="client-card-header"><span class="client-avatar" aria-hidden="true">${osClientIcon(row.name)}</span><div><h4>${osEscape(row.name)}</h4><span class="client-status ${tone}">${status}</span></div></header><div class="health-metrics"><div><span>📌 Open this month</span><strong>${row.open} task${row.open===1?'':'s'}</strong></div><div><span>✅ Done this month</span><strong>${row.done} task${row.done===1?'':'s'}</strong></div><div><span>💰 Income received</span><strong>${osCurrency(row.income)}</strong></div><div><span>🧾 Awaiting payment</span><strong class="${row.overdueInvoices?'negative':''}">${osCurrency(row.unpaid)}</strong><small>${row.unpaidCount?row.unpaidCount+' unpaid invoice'+(row.unpaidCount===1?'':'s'):'No unpaid invoices'}</small></div></div>${notes.length?'<p class="health-attention-note">⚠️ '+notes.join(' · ')+'</p>':''}<footer class="client-card-foot"><span>🕒 ${Math.round(row.hours*10)/10} h estimated this month</span><span>💳 ${avgPay!=null?'Avg payment: '+avgPay+' days':'Payment speed: no history yet'}</span></footer></article>`;
  });
  el.innerHTML = osClientCardsHTML(cards);
}
if (typeof module !== 'undefined' && module.exports) {
  Object.assign(module.exports,{osClientWorkModel,osClientHealthModel,osClientIcon});
}
