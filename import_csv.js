const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(process.env.HOME, 'Downloads/Pennyworth_defaultbook_Income&Expense_20260622040956.csv');
const API = 'https://finance-tracker-anna-li.vercel.app/api/entries';

// Map Pennyworth categories to our system
function mapCat(rawCat, type) {
  const c = (rawCat || '').toLowerCase();
  if (type === 'income') {
    if (/shoot/.test(c)) return 'Shooting';
    if (/video|edit/.test(c)) return 'Video editing';
    if (/design|graphic/.test(c)) return 'Graphic design';
    if (/writ|caption|copy/.test(c)) return 'Writing/Caption';
    if (/retainer/.test(c)) return 'Retainer';
    if (/project|fee/.test(c)) return 'Project fee';
    if (/laisee|red packet/.test(c)) return 'Laisee';
    if (/sale|resale|carousell/.test(c)) return 'Sales/Resale';
    if (/event/.test(c)) return 'Event';
    if (/day rate|daily|freelance/.test(c)) return 'Freelance day rate';
    return 'Other income';
  }
  if (/food|meal|restaurant|lunch|dinner|breakfast/.test(c)) return 'Food & drinks';
  if (/uber|taxi/.test(c)) return 'Uber/Taxi';
  if (/transport|mtr|bus|octopus|ferry/.test(c)) return 'Transport';
  if (/social/.test(c)) return 'Socializing';
  if (/concert/.test(c)) return 'Concert';
  if (/film|films|movie|cinema/.test(c)) return 'Movie';
  if (/vinyl|record|\bcd\b/.test(c)) return 'CD/Vinyl';
  if (/entertainment/.test(c)) return 'Entertainment';
  if (/travel/.test(c)) return 'Travel';
  if (/phone|subscription|ai/.test(c)) return 'Phone & subscriptions';
  if (/book|education/.test(c)) return 'Books & education';
  if (/gift|treat/.test(c)) return 'Gifts & treats';
  if (/stuff|clothes|beauty|health|迷信|mj/.test(c)) return 'Shopping';
  if (/utilit/.test(c)) return 'Utilities';
  if (/transfer|fee/.test(c)) return 'Fees';
  return 'Misc';
}

function parseDate(raw) {
  // Format: 20260621 → 2026-06-21
  const s = String(raw).trim();
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return s;
}

function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim());
  const header = lines[0].split(',');
  // Date,Category,Category Group,Amount,Currency,Member,Account,Tags,Memo,Income&Expense,Last updated,UUID
  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 12) continue;
    const date = parseDate(parts[0]);
    const cat = parts[1].trim();
    const amount = parseFloat(parts[3]);
    const memo = parts[8].trim();
    const ie = parts[9].trim();
    const uuid = parts[11].trim();
    if (!date || !amount || !uuid) continue;
    const type = ie === 'INC' ? 'income' : 'expense';
    entries.push({ date, cat, amount, memo, type, uuid });
  }
  return entries;
}

async function main() {
  console.log('Reading CSV...');
  const content = fs.readFileSync(CSV_PATH, 'utf8');
  const csvEntries = parseCSV(content);
  console.log(`CSV has ${csvEntries.length} entries`);

  console.log('Fetching existing database entries...');
  const res = await fetch(API);
  const dbEntries = await res.json();
  console.log(`Database has ${dbEntries.length} entries`);

  // Build fingerprint set from DB: date_amount_type
  const dbFingerprints = new Set(
    dbEntries.map(e => `${e.date}_${e.amount}_${e.type}`)
  );
  // Also track existing UUIDs (for re-runs)
  const dbUUIDs = new Set(
    dbEntries.filter(e => e.uuid).map(e => e.uuid)
  );

  const toImport = [];
  const skipped = [];

  for (const e of csvEntries) {
    const fp = `${e.date}_${e.amount}_${e.type}`;
    if (dbUUIDs.has(e.uuid)) {
      skipped.push(`UUID match: ${e.memo || e.cat} ${e.amount} ${e.date}`);
      continue;
    }
    if (dbFingerprints.has(fp)) {
      skipped.push(`Fingerprint match: ${e.memo || e.cat} ${e.amount} ${e.date}`);
      continue;
    }
    toImport.push(e);
  }

  console.log(`\nTo import: ${toImport.length}`);
  console.log(`Skipping (already in DB): ${skipped.length}`);

  if (toImport.length === 0) {
    console.log('\nNothing new to import — database is up to date!');
    return;
  }

  console.log('\nUploading new entries...');
  let done = 0;
  for (const e of toImport) {
    const entry = {
      id: Date.now() + done, // ensure unique IDs
      type: e.type,
      desc: e.memo || e.cat,
      amount: e.amount,
      date: e.date,
      cat: mapCat(e.cat, e.type),
      client: '',
      uuid: e.uuid,
      notes: 'Imported from Pennyworth',
    };
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    const json = await r.json();
    if (json.ok) {
      done++;
      process.stdout.write(`\r${done}/${toImport.length} uploaded`);
    } else {
      console.error('\nFailed:', entry.desc, json);
    }
    // Small delay to avoid ID collisions from Date.now()
    await new Promise(r => setTimeout(r, 2));
  }

  console.log(`\n\nDone! Imported ${done} new entries, skipped ${skipped.length} duplicates.`);
}

main().catch(console.error);
