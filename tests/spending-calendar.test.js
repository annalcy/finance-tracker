const {test} = require('node:test');
const assert = require('node:assert/strict');
const {osMonthModel,osTotals,osSpendingLevel,osMonthlyEntries,osScopeEntries} = require('../os-redesign');
const records = [
  {id:1,date:'2026-09-18',type:'expense',amount:480},
  {id:2,date:'2026-09-18',type:'expense',amount:620},
  {id:3,date:'2026-09-18',type:'expense',amount:180},
  {id:4,date:'2026-09-18',type:'income',amount:5000},
  {id:5,date:'2026-10-01',type:'expense',amount:999},
  {id:6,date:'2022-09-10',type:'income',amount:2000},
];
test('calendar aligns September correctly and counts expenses separately from income',()=>{
  const model=osMonthModel(records,2026,8,600);
  assert.equal(model.days.length,30);
  assert.equal(model.offset,1);
  assert.equal(model.expense,1280);
  assert.equal(model.income,5000);
  assert.equal(model.days[17].entries.length,4);
  assert.equal(model.days[17].level,'high');
  assert.equal(model.days[0].expense,0);
});
test('threshold boundaries include zero, exact budget, and exact 1.5× budget',()=>{
  assert.deepEqual([0,1,600,601,900,901].map(n=>osSpendingLevel(n,600)),['zero','low','low','medium','medium','high']);
});
test('historical months and leap years remain available',()=>{
  assert.equal(osMonthlyEntries(records,2022,8).length,1);
  assert.equal(osMonthModel([],2024,1,100).days.length,29);
  assert.equal(osMonthModel([],2026,1,100).days.length,28);
  assert.equal(osMonthModel([],2026,10,100).offset,6);
});
test('numeric strings cannot concatenate monthly totals',()=>{
  assert.deepEqual(osTotals([{type:'income',amount:'765'},{type:'income',amount:'1300'},{type:'expense',amount:'180'}]),{income:2065,expense:180});
});

test('overview scopes keep the selected year and include all past records in all-time',()=>{
  assert.deepEqual(osTotals(osScopeEntries(records,'month',2026,8)),{income:5000,expense:1280});
  assert.deepEqual(osTotals(osScopeEntries(records,'year',2026,8)),{income:5000,expense:2279});
  assert.deepEqual(osTotals(osScopeEntries(records,'year',2022,8)),{income:2000,expense:0});
  assert.deepEqual(osTotals(osScopeEntries(records,'alltime',2026,8)),{income:7000,expense:2279});
});
