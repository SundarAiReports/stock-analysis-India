/*
 * netlify/functions/stock.js
 * ---------------------------------------------------------------
 *   • Indian tickers  (.NS / .BO)  →  Yahoo Finance (free)
 *   • All other tickers            →  TwelveData ↴ FMP ↴ Finnhub ↴ Alpha Vantage
 *   • Each provider is tried in turn until one returns data.
 *   • Extensive console.log output so Netlify ➜ Functions ➜ Logs
 *     shows exactly what happened on every call.
 * ---------------------------------------------------------------
 * Required environment variables in Netlify:
 *   TWELVEDATA_API_KEY
 *   FMP_API_KEY
 *   FINNHUB_API_KEY
 *   ALPHA_VANTAGE_API_KEY
 * ---------------------------------------------------------------
 */

const fetch = require('node-fetch');        // Netlify still ships Node18

exports.handler = async (event) => {
  const { symbol = '', endpoint = 'quote' } = event.queryStringParameters || {};

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'max-age=1800'          // 30 min
  };

  console.log('──────────────────────────────────────────────');
  console.log(`🚀 stock.js called | symbol=${symbol} | endpoint=${endpoint}`);

  try {
    if (!symbol) throw new Error('Missing “symbol” query parameter');

    // ────────────────── Indian tickers (.NS / .BO) ──────────────────
    const isIndian = /\.(NS|BO)$/i.test(symbol);
    console.log(`🔍 Ticker check: ${symbol} → isIndian=${isIndian}`);

    if (isIndian) {
      console.log(`🇮🇳 Fetching from Yahoo Finance…`);
      const data = await yahooFetch(symbol, endpoint);
      console.log(`✅ Yahoo delivered keys:`, Object.keys(data));
      return send(200, { ...data, source: 'Yahoo Finance', lastUpdated: now() });
    }

    // ────────────────── US / other tickers – provider cascade ───────
    const providers = [
      { name: 'TwelveData',  fn: twelveFetch, key: process.env.TWELVEDATA_API_KEY },
      { name: 'FMP',         fn: fmpFetch,    key: process.env.FMP_API_KEY },
      { name: 'Finnhub',     fn: finnhubFetch,key: process.env.FINNHUB_API_KEY },
      { name: 'AlphaVantage',fn: alphaFetch,  key: process.env.ALPHA_VANTAGE_API_KEY }
    ];

    let lastErr = 'no provider tried';
    for (const { name, fn, key } of providers) {
      if (!key) { console.log(`⚠️  ${name}: API key missing; skipping`); continue; }

      try {
        console.log(`🔄 Trying ${name}…`);
        const data = await fn(symbol, endpoint, key);
        console.log(`✅ ${name} succeeded, keys:`, Object.keys(data));
        return send(200, { ...data, source: name, lastUpdated: now() });
      } catch (e) {
        console.log(`❌ ${name} failed:`, e.message);
        lastErr = e.message;
      }
    }
    throw new Error(`All providers exhausted. Last error: ${lastErr}`);

  } catch (err) {
    console.log('💥 Handler error:', err.message);
    return send(500, { error: err.message, symbol, endpoint, ts: now() });
  }

  // helper to send JSON
  function send(status, body) { return { statusCode: status, headers, body: JSON.stringify(body) }; }
  function now() { return new Date().toISOString(); }
};

/* ════════════════════════════════════════════════════════════════ */
/*                           PROVIDERS                             */
/* ════════════════════════════════════════════════════════════════ */

/* ---------- TwelveData ---------- */
async function twelveFetch(sym, ep, key) {
  const qs = new URLSearchParams({ symbol: sym, apikey: key });
  if (ep === 'time_series') { qs.set('interval', '1day'); qs.set('outputsize', '1000'); }
  const url = `https://api.twelvedata.com/${ep}?${qs}`;
  console.log('🌐 TwelveData URL:', url.replace(key, '***'));
  const j = await (await fetch(url)).json();
  if (j.status === 'error' || j.message?.match(/limit|exceeded/i)) throw new Error(j.message);
  if (!j || Object.keys(j).length === 0) throw new Error('Empty response from TwelveData');
  return j;   // already in dashboard-friendly format
}

/* ---------- FMP (Financial Modeling Prep) ---------- */
async function fmpFetch(sym, ep, key) {
  const base = 'https://financialmodelingprep.com/api/v3';
  let url;
  switch (ep) {
    case 'quote':            url = `${base}/quote/${sym}?apikey=${key}`; break;
    case 'time_series':      url = `${base}/historical-price-full/${sym}?apikey=${key}`; break;
    case 'dividends':        url = `${base}/historical-price-full/stock_dividend/${sym}?apikey=${key}`; break;
    case 'earnings':         url = `${base}/earnings-surprises/${sym}?apikey=${key}`; break;
    case 'cash_flow':        url = `${base}/cash-flow-statement/${sym}?limit=40&apikey=${key}`; break;
    case 'income_statement': url = `${base}/income-statement/${sym}?limit=40&apikey=${key}`; break;
    default: throw new Error(`FMP unsupported endpoint ${ep}`);
  }
  console.log('🌐 FMP URL:', url.replace(key, '***'));
  const j = await (await fetch(url)).json();
  if (!j || (Array.isArray(j) && !j.length)) throw new Error('FMP empty result');

  if (ep === 'quote') {
    const q = Array.isArray(j) ? j[0] : j;
    return {
      symbol: q.symbol, open: q.open, high: q.dayHigh, low: q.dayLow,
      close: q.price, volume: q.volume, change: q.change, percent_change: q.changesPercentage
    };
  }
  if (ep === 'time_series') {
    return {
      symbol: sym,
      values: j.historical.map(x => ({
        datetime: x.date, open: x.open, high: x.high,
        low: x.low, close: x.close, volume: x.volume
      }))
    };
  }
  return j;
}

/* ---------- Finnhub ---------- */
async function finnhubFetch(sym, ep, key) {
  const base = 'https://finnhub.io/api/v1';
  let url;
  switch (ep) {
    case 'quote':            url = `${base}/quote?symbol=${sym}&token=${key}`; break;
    case 'time_series': {
      const to = Math.floor(Date.now() / 1000);
      const from = to - 5 * 365 * 24 * 60 * 60;
      url = `${base}/stock/candle?symbol=${sym}&resolution=D&from=${from}&to=${to}&token=${key}`; break;
    }
    case 'dividends': {
      const to = new Date().toISOString().split('T')[0];
      const from = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      url = `${base}/stock/dividend?symbol=${sym}&from=${from}&to=${to}&token=${key}`; break;
    }
    case 'earnings':         url = `${base}/stock/earnings?symbol=${sym}&token=${key}`; break;
    default: throw new Error(`Finnhub unsupported endpoint ${ep}`);
  }
  console.log('🌐 Finnhub URL:', url.replace(key, '***'));
  const j = await (await fetch(url)).json();
  if (j.error || j.s === 'no_data') throw new Error(j.error || 'Finnhub no_data');

  if (ep === 'quote') {
    return {
      symbol: sym, open: j.o, high: j.h, low: j.l,
      close: j.c, volume: j.v, change: j.d, percent_change: j.dp
    };
  }
  if (ep === 'time_series') {
    return {
      symbol: sym,
      values: j.t.map((t, i) => ({
        datetime: new Date(t * 1000).toISOString().split('T')[0],
        open: j.o[i], high: j.h[i], low: j.l[i], close: j.c[i], volume: j.v[i]
      }))
    };
  }
  return j;
}

/* ---------- Alpha Vantage ---------- */
async function alphaFetch(sym, ep, key) {
  const base = 'https://www.alphavantage.co/query';
  let qs;
  switch (ep) {
    case 'quote':            qs = { function: 'GLOBAL_QUOTE', symbol: sym, apikey: key }; break;
    case 'time_series':      qs = { function: 'TIME_SERIES_DAILY', symbol: sym, outputsize: 'compact', apikey: key }; break;
    case 'earnings':         qs = { function: 'EARNINGS', symbol: sym, apikey: key }; break;
    case 'cash_flow':        qs = { function: 'CASH_FLOW', symbol: sym, apikey: key }; break;
    case 'income_statement': qs = { function: 'INCOME_STATEMENT', symbol: sym, apikey: key }; break;
    default: throw new Error(`Alpha Vantage unsupported endpoint ${ep}`);
  }
  const url = `${base}?${new URLSearchParams(qs)}`;
  console.log('🌐 Alpha Vantage URL:', url.replace(key, '***'));
  const j = await (await fetch(url)).json();
  if (j['Error Message'] || j['Note']) throw new Error(j['Error Message'] || j['Note']);

  if (ep === 'quote') {
    const q = j['Global Quote'];
    return {
      symbol: q['01. symbol'],
      open: +q['02. open'], high: +q['03. high'], low: +q['04. low'],
      close: +q['05. price'], volume: +q['06. volume'],
      change: +q['09. change'], percent_change: parseFloat(q['10. change percent'])
    };
  }
  if (ep === 'time_series') {
    const ts = j['Time Series (Daily)'] || {};
    return {
      symbol: sym,
      values: Object.entries(ts).map(([date, v]) => ({
        datetime: date,
        open: +v['1. open'], high: +v['2. high'],
        low: +v['3. low'],  close: +v['4. close'],
        volume: +v['5. volume']
      })).reverse()
    };
  }
  return j;
}

/* ---------- Yahoo Finance (Indian tickers) ---------- */
async function yahooFetch(sym, ep) {
  if (ep === 'quote') {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`;
    console.log('🌐 Yahoo URL:', url);
    const j = await (await fetch(url)).json();
    if (j.chart.error) throw new Error(j.chart.error.description);
    const meta = j.chart.result[0].meta;
    const q    = j.chart.result[0].indicators.quote[0];
    return {
      symbol: sym,
      open: q.open[0], high: q.high[0], low: q.low[0],
      close: meta.regularMarketPrice, volume: q.volume[0],
      change: meta.regularMarketPrice - meta.previousClose,
      percent_change: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
      datetime: new Date(meta.regularMarketTime * 1000).toISOString()
    };
  }

  if (ep === 'time_series') {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5y`;
    console.log('🌐 Yahoo URL:', url);
    const j = await (await fetch(url)).json();
    if (j.chart.error) throw new Error(j.chart.error.description);
    const ts  = j.chart.result[0].timestamp;
    const q   = j.chart.result[0].indicators.quote[0];
    return {
      symbol: sym,
      values: ts.map((t, i) => ({
        datetime: new Date(t * 1000).toISOString().split('T')[0],
        open: q.open[i], high: q.high[i], low: q.low[i],
        close: q.close[i], volume: q.volume[i]
      })).filter(v => v.close !== null)
    };
  }

  if (ep === 'dividends') {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&events=div`;
    console.log('🌐 Yahoo URL:', url);
    const j = await (await fetch(url)).json();
    const divs = j.chart?.result?.[0]?.events?.dividends || {};
    return Object.values(divs).map(d => ({
      ex_date: new Date(d.date * 1000).toISOString().split('T')[0],
      amount: d.amount
    })).sort((a, b) => b.ex_date.localeCompare(a.ex_date));
  }

  throw new Error(`Yahoo Finance: endpoint “${ep}” not implemented`);
}
