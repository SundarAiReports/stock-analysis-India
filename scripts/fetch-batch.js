// scripts/fetch-batch.js
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const API = process.env.TWELVEDATA_API_KEY;
const BATCH = parseInt(process.env.BATCH_NUM || '0', 10); // 0-based
const SIZE  = 50;                                         // 50 stocks per batch

const allSymbols = fs.readFileSync('stocks.txt', 'utf8')
                      .split(/\r?\n/)
                      .map(s => s.trim())
                      .filter(Boolean);

const batchSyms = allSymbols.slice(BATCH * SIZE, (BATCH + 1) * SIZE);
if (!batchSyms.length) {
  console.log(`Batch ${BATCH} has no symbols — exiting`);
  process.exit(0);
}

const ENDPOINTS = ['quote','time_series','dividends','earnings','cash_flow','income_statement'];
const DATA_DIR  = 'data';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

async function fetchOne(symbol, endpoint) {
  const qs = new URLSearchParams({symbol, apikey: API});
  if (endpoint === 'time_series') { qs.set('interval','1day'); qs.set('outputsize','1000'); }

  const url = `https://api.twelvedata.com/${endpoint}?${qs}`;
  const r   = await fetch(url);
  const js  = await r.json();
  if (js.status === 'error') throw new Error(js.message);

  js.lastUpdated = new Date().toISOString();
  const file = `${symbol.toLowerCase()}-${endpoint}.json`;
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(js, null, 1));
  console.log(`✓ ${file}`);
}

(async ()=>{
  console.log(`🚀 Batch ${BATCH}: ${batchSyms.length} symbols`);
  for (const sym of batchSyms) {
    for (const ep of ENDPOINTS) {
      try { await fetchOne(sym, ep); } catch(e) { console.log(`⚠ ${sym}/${ep} ${e.message}`); }
      await new Promise(r => setTimeout(r, 1200));       // 1.2 s between calls ≈ 50 req/min
    }
  }
})();
