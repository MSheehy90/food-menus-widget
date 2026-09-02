#!/usr/bin/env node
/**
 * Pull Snowpiercer Food Master from Google Sheets → data/food-master-v2.json
 * and snowpiercer/snowpiercer-food-master-part-{a..g}-v1.js chunks.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ROOT,
  MANIFEST_JSON,
  downloadSheetCSV,
  loadSheetCSV,
  parseCSV,
  mapSheetRow,
  loadArtResolver,
  validateRows,
  expectedRowCountFromCSV,
  emitJsonParts,
} from './food-master-lib.mjs';

async function main() {
  let csvText;
  if (process.env.FOOD_MASTER_SKIP_DOWNLOAD === '1') {
    csvText = loadSheetCSV();
    console.log('Using cached CSV (FOOD_MASTER_SKIP_DOWNLOAD=1).');
  } else {
    try {
      console.log('Downloading live Google Sheet…');
      csvText = await downloadSheetCSV();
      console.log('Downloaded and cached CSV.');
    } catch (e) {
      console.warn('Live download failed:', e.message);
      csvText = loadSheetCSV();
      console.log('Using cached CSV.');
    }
  }

  const expectedCount = expectedRowCountFromCSV(csvText);
  const { rows: rawRows } = parseCSV(csvText);
  const issues = validateRows(rawRows, expectedCount);
  if (issues.length) {
    console.warn('Validation warnings:');
    issues.forEach(i => console.warn(' -', i));
  }

  const { artStatusForItem } = loadArtResolver();
  const rows = rawRows.map((raw, i) => ({
    ...mapSheetRow(raw, i, artStatusForItem(raw.Item)),
    // Explicit lifecycle result for timeline/UI use. Keep this separate from
    // Reusable? because "survives" and "regrows before the next harvest" are
    // meaningfully different states for planning.
    afterHarvest: String(raw['After Harvest'] || '').trim(),
  }));

  const hash = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
  const manifest = {
    version: 2,
    count: rows.length,
    generatedAt: new Date().toISOString(),
    sheetId: '1ShKoeUKdthTgd6Y2zmAyNkUiv0wpkqmOyaZ1D_TX7DQ',
    rowHash: hash,
    artCounts: rows.reduce((a, r) => { a[r.artStatus] = (a[r.artStatus] || 0) + 1; return a; }, {}),
    rows,
  };

  fs.mkdirSync(path.dirname(MANIFEST_JSON), { recursive: true });
  fs.writeFileSync(MANIFEST_JSON, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Wrote ${MANIFEST_JSON} (${rows.length} rows, hash ${hash})`);
  console.log('Art status:', manifest.artCounts);

  const outDir = path.join(ROOT, 'snowpiercer');
  const partFiles = emitJsonParts(rows, outDir);
  console.log('Wrote parts:', partFiles.join(', '));

  // Remove legacy TSV-only parts beyond g if any
  for (const old of ['h', 'i', 'j']) {
    const stale = path.join(outDir, `snowpiercer-food-master-part-${old}-v1.js`);
    if (fs.existsSync(stale)) fs.unlinkSync(stale);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
