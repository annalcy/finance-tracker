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
  assert.ok(rows.find(r=>r.name==='(no client)'));
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
  assert.ok(!rows.find(r=>r.name==='old client'));assert.ok(!rows.find(r=>r.name==='(no client)'));
});
test('empty client data returns a usable empty state model',()=>{
  assert.deepEqual(osClientWorkModel([],normalize,dateOf,'2026-11-16'),[]);
  assert.deepEqual(osClientHealthModel([],[],[],normalize,dateOf,'2026-11-16'),[]);
});
