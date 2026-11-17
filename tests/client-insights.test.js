const {test}=require('node:test');
const assert=require('node:assert/strict');
const {osClientWorkModel,osClientHealthModel}=require('../os-redesign');
const normalize=value=>value?value.toLowerCase():'(no client)';
const dateOf=task=>task.doneAt||null;
const tasks=[
  {client:'Studio',status:'pending',deadlineDate:'2026-11-15',estimateMinutes:90},
  {client:'STUDIO',status:'done',deadlineDate:'2026-11-12',doneAt:'2026-11-10',createdAt:'2026-11-08',estimateMinutes:60},
  {client:'Studio',status:'done',deadlineDate:'2026-11-12'},
  {client:'Agency',status:'pending',deadlineDate:'2026-10-01',estimateMinutes:120},
  {client:'Old client',status:'done',deadlineDate:'2024-01-01',doneAt:'2024-01-01'},
  {status:'pending',deadlineDate:'2026-11-16'},
];
test('client workload groups aliases and separates open, done, and overdue work',()=>{
  const rows=osClientWorkModel(tasks,normalize,dateOf,'2026-11-16');
  const studio=rows.find(r=>r.name==='studio');
  assert.equal(studio.count,3);assert.equal(studio.open,1);assert.equal(studio.done,2);assert.equal(studio.overdue,1);
  assert.equal(studio.knownTiming,1);assert.equal(studio.onTime,1);
  assert.deepEqual(studio.turnaround,[2]);
  assert.ok(!rows.find(r=>r.name==='(no client)'));
});
test('health separates this month from older overdue work and uses invoice due dates',()=>{
  const entries=[{client:'Studio',type:'income',date:'2026-11-10',amount:'1400'},{client:'Studio',type:'income',date:'2026-10-10',amount:9000}];
  const invoices=[
    {client:'STUDIO',status:'unpaid',amount:'500',dueDate:'2026-11-15'},
    {client:'Studio',status:'unpaid',amount:700,dueDate:'2026-11-20'},
    {client:'Studio',status:'paid',issueDate:'2026-10-01',paidDate:'2026-10-11'},
  ];
  const rows=osClientHealthModel(tasks,entries,invoices,normalize,dateOf,'2026-11-16');
  const studio=rows.find(r=>r.name==='studio');
  assert.equal(studio.income,1400);assert.equal(studio.unpaid,1200);assert.equal(studio.unpaidCount,2);assert.equal(studio.overdueInvoices,1);
  assert.equal(studio.done,1);assert.equal(studio.open,1);assert.equal(studio.hours,2.5);
  assert.deepEqual(studio.paidDays,[10]);
  const agency=rows.find(r=>r.name==='agency');assert.equal(agency.open,0);assert.equal(agency.overdue,1);
  assert.ok(rows.find(r=>r.name==='old client'));assert.equal(rows.find(r=>r.name==='old client').done,0);assert.ok(!rows.find(r=>r.name==='(no client)'));
});
test('empty client data returns a usable empty state model',()=>{
  assert.deepEqual(osClientWorkModel([],normalize,dateOf,'2026-11-16'),[]);
  assert.deepEqual(osClientHealthModel([],[],[],normalize,dateOf,'2026-11-16'),[]);
});

test('personal helping-out markers never become clients and tasks are not mutated',()=>{
  const personal=[{client:'//',status:'pending',desc:'Help a friend'},{client:' / ',status:'done'},{client:'Family',status:'pending'},{status:'pending'}];
  const before=JSON.stringify(personal);
  const normal=value=>value?value.trim().toLowerCase():'(no client)';
  assert.deepEqual(osClientWorkModel(personal,normal,dateOf,'2026-11-16'),[]);
  assert.deepEqual(osClientHealthModel(personal,[{client:'Family',type:'income',date:'2026-11-01',amount:100}],[],normal,dateOf,'2026-11-16'),[]);
  assert.equal(JSON.stringify(personal),before);
});
test('directory includes income-only and invoice-only clients across all history',()=>{
  const entries=[{client:'Past studio',type:'income',date:'2022-01-01',amount:'2000'},{client:'Grocery shop',type:'expense',date:'2026-11-01',amount:100}];
  const invoices=[{client:'Invoice studio',status:'paid',issueDate:'2025-01-01',paidDate:'2025-01-11',amount:500}];
  const rows=osClientWorkModel([],normalize,dateOf,'2026-11-16',entries,invoices);
  assert.deepEqual(rows.map(r=>r.name).sort(),['invoice studio','past studio']);
  assert.equal(rows.find(r=>r.name==='past studio').count,0);
  assert.equal(rows.find(r=>r.name==='past studio').income,2000);
  const health=osClientHealthModel([],entries,invoices,normalize,dateOf,'2026-11-16');
  assert.equal(health.length,2);assert.equal(health.find(r=>r.name==='past studio').income,0);
  assert.deepEqual(health.find(r=>r.name==='invoice studio').paidDays,[10]);
});
test('completing helping-out tasks keeps the task but does not prompt for an invoice',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const {osIsPersonalClient}=require('../os-redesign');
  const html=fs.readFileSync(require('node:path').join(__dirname,'../finance_tracker.html'),'utf8');
  const handler=html.match(/async function markTaskDone\(id\)\{[\s\S]*?\n\}/)[0];
  for(const [client,expected] of [['//',null],['Studio',123]]) {
    const calls=[];
    const ctx={_tasksAll:[{id:123,client,desc:'A task',status:'pending'}],_pendingPaymentPromptId:null,osIsPersonalClient,normalizeClientName:normalize,refreshCurrentTaskView:()=>{},fetch:async(url,options)=>{calls.push(options);},TASKS_API:'/tasks',console};
    vm.createContext(ctx);vm.runInContext(handler,ctx);await ctx.markTaskDone(123);
    assert.equal(ctx._tasksAll.length,1);assert.equal(ctx._tasksAll[0].status,'done');
    assert.equal(ctx._pendingPaymentPromptId,expected);assert.equal(calls[0].method,'PATCH');
  }
});
test('app client aliases merge mixed-case names across tasks and historical income',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const html=fs.readFileSync(require('node:path').join(__dirname,'../finance_tracker.html'),'utf8');
  const ctx={};vm.createContext(ctx);
  vm.runInContext(html.match(/const CLIENT_ALIASES = \{[\s\S]*?\n\};/)[0]+'\n'+html.match(/function normalizeClientName\(raw\)\{[\s\S]*?\n\}/)[0],ctx);
  const rows=osClientWorkModel([{client:'kc',status:'pending'}],ctx.normalizeClientName,dateOf,'2026-11-16',[{client:'KC',type:'income',amount:200}],[]);
  assert.equal(rows.length,1);assert.equal(rows[0].name,'KC');assert.equal(rows[0].income,200);
  assert.equal(ctx.normalizeClientName('//'),'Personal / helping out');
  assert.equal(ctx.normalizeClientName('livenation'),ctx.normalizeClientName('live nation'));
});
test('finance reports combine CK case variants in rankings and concentration',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const html=fs.readFileSync(require('node:path').join(__dirname,'../finance_tracker.html'),'utf8');
  const ctx={};vm.createContext(ctx);
  const source=[html.match(/const CLIENT_ALIASES = \{[\s\S]*?\n\};/)[0],...['normalizeClientName','clientConcentration','topClientsFor'].map(name=>html.match(new RegExp('function '+name+'\\([^]*?\\n\\}'))[0])].join('\n');
  vm.runInContext(source,ctx);
  const entries=[{type:'income',client:'CK',amount:100},{type:'income',client:' ck ',amount:'200'},{type:'income',client:'Other',amount:100},{type:'expense',client:'ck',amount:50}];
  const rankings=JSON.parse(JSON.stringify(ctx.topClientsFor(entries)));
  assert.deepEqual(rankings,[{client:'CK',amount:300},{client:'Other',amount:100}]);
  const concentration=ctx.clientConcentration(entries);
  assert.equal(concentration.top3.length,2);assert.equal(concentration.top3[0].client,'CK');assert.equal(concentration.top3[0].amount,300);assert.equal(concentration.topPct,75);
});
