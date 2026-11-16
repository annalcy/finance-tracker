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
  insights: ['Your rhythm', 'A clearer picture of your time and work.'],
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
