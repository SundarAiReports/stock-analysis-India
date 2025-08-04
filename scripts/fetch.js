// scripts/fetch.js
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const KEY      = process.env.TWELVEDATA_API_KEY;
const SYMBOLS  = ['AAPL','GOOGL','AMD'];        // add yours
const OUT_DIR  = 'data';

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

async function saveJSON(sym, obj) {
  fs.writeFileSync(`${OUT_DIR}/${sym}.json`, JSON.stringify(obj, null, 2));
  console.log(`✅  saved ${sym}.json`);
}

async function fetchQuote(sym) {
  const url = `https://api.twelvedata.com/quote?symbol=${sym}&apikey=${KEY}`;
  return await fetch(url).then(r => r.json());
}

(async () => {
  for (const s of SYMBOLS) {
    const quote = await fetchQuote(s);
    await saveJSON(s, quote);
  }
})();
