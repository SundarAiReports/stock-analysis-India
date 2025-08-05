/*  netlify/functions/stock.js
    One function – many providers – one output format
    (c) 2025  •  works on Netlify Free plan
*/
const fetch = require('node-fetch');

exports.handler = async (event) => {
  const { symbol, endpoint = 'quote' } = event.queryStringParameters || {};

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'max-age=1800'   // 30 min CDN + browser
  };

  try {
    if (!symbol) throw new Error('symbol query-param missing');

    // ───────── Indian tickers (.NS / .BO) → Yahoo Finance ─────────
    if (symbol.endsWith('.NS') || symbol.endsWith('.BO')) {
      const body = await yahooRouter(symbol, endpoint);
      return { statusCode: 200, headers, body: JSON.stringify(body) };
    }

    // ───────── US + others → cascade through 4 paid/free APIs ─────
    const providers = [
      { name: 'TwelveData',  fn: twdRouter  , key: process.env.TWELVEDATA_API_KEY },
      { name: 'FMP',         fn: fmpRouter  , key: process.env.FMP_API_KEY        },
      { name: 'Finnhub',     fn: finRouter  , key: process.env.FINNHUB_API_KEY    },
      { name: 'AlphaVantage',fn: avRouter   , key: process.env.ALPHA_VANTAGE_API_KEY }
    ];

    let lastErr;
    for (const p of providers) {
      if (!p.key) { lastErr = `missing key for ${p.name}`; continue; }
      try {
        const body = await p.fn(symbol, endpoint, p.key);
        body.source     = p.name;
        body.lastUpdated= new Date().toISOString();
        return { statusCode: 200, headers, body: JSON.stringify(body) };
      } catch (e) {
        lastErr = `${p.name}: ${e.message}`;
      }
    }

    throw new Error(lastErr || 'all providers failed');
  } catch (e) {
    return { statusCode: 500, headers,
             body: JSON.stringify({ error: e.message || e }) };
  }
};

/* ═══════════════════  PROVIDER ROUTERS  ═══════════════════ */
/* ♦ each returns the **normalised** object expected by dashboard */

/* ── 1. TwelveData ── */
async function twdRouter(sym, ep, key){
  const qs = new URLSearchParams({ symbol: sym, apikey: key });
  if(ep==='time_series'){ qs.set('interval','1day'); qs.set('outputsize','1000'); }
  const r = await fetch(`https://api.twelvedata.com/${ep}?${qs}`);
  const j = await r.json();
  if (j.status === 'error' || j.message?.includes('limit')) throw new Error(j.message);
  return j;             // already in our desired format
}

/* ── 2. FMP (Financial Modeling Prep) ── */
async function fmpRouter(sym, ep, key){
  const base = 'https://financialmodelingprep.com/api/v3';
  let url;
  switch(ep){
    case 'quote':           url = `${base}/quote/${sym}?apikey=${key}`; break;
    case 'time_series':     url = `${base}/historical-price-full/${sym}?apikey=${key}`; break;
    case 'dividends':       url = `${base}/historical-price-full/stock_dividend/${sym}?apikey=${key}`; break;
    case 'earnings':        url = `${base}/earnings-surprises/${sym}?apikey=${key}`; break;
    case 'cash_flow':       url = `${base}/cash-flow-statement/${sym}?limit=40&apikey=${key}`; break;
    case 'income_statement':url = `${base}/income-statement/${sym}?limit=40&apikey=${key}`; break;
    default: throw new Error('unsupported endpoint for FMP');
  }
  const j = await (await fetch(url)).json();
  if (!j || (Array.isArray(j)&&!j.length)) throw new Error('no data');

  if (ep==='quote'){
    const q = Array.isArray(j)? j[0]: j;
    return {
      symbol: q.symbol,
      open: q.open,
      high: q.dayHigh,
      low:  q.dayLow,
      close:q.price,
      volume:q.volume,
      change:q.change,
      percent_change:q.changesPercentage
    };
  }
  if (ep==='time_series'){
    return {
      symbol: sym,
      values: j.historical.map(x=>({
        datetime:x.date, open:x.open, high:x.high,
        low:x.low, close:x.close, volume:x.volume
      }))
    };
  }
  return j;  // other endpoints: just pass through
}

/* ── 3. Finnhub ── */
async function finRouter(sym, ep, key){
  const base = 'https://finnhub.io/api/v1';
  let url;
  switch(ep){
    case 'quote':       url = `${base}/quote?symbol=${sym}&token=${key}`; break;
    case 'time_series': {
      const to = Math.floor(Date.now()/1000);
      const from = to - 365*24*60*60*5;            // 5 y
      url = `${base}/stock/candle?symbol=${sym}&resolution=D&from=${from}&to=${to}&token=${key}`;
      break;
    }
    case 'dividends': {
      const to = new Date().toISOString().split('T')[0];
      const from= new Date(Date.now()-5*365*24*60*60*1000).toISOString().split('T')[0];
      url = `${base}/stock/dividend?symbol=${sym}&from=${from}&to=${to}&token=${key}`; break;
    }
    case 'earnings':    url = `${base}/stock/earnings?symbol=${sym}&token=${key}`; break;
    default: throw new Error('endpoint not on Finnhub');
  }
  const j = await (await fetch(url)).json();
  if (j.error || j.s==='no_data') throw new Error(j.error || 'no data');

  if (ep==='quote'){
    return {
      symbol:sym, open:j.o, high:j.h, low:j.l,
      close:j.c, volume:j.v, change:j.d, percent_change:j.dp
    };
  }
  if (ep==='time_series'){
    return {
      symbol:sym,
      values: j.t.map((t,i)=>({
        datetime: new Date(t*1000).toISOString().split('T')[0],
        open:j.o[i], high:j.h[i], low:j.l[i], close:j.c[i], volume:j.v[i]
      }))
    };
  }
  return j;
}

/* ── 4. Alpha Vantage ── */
async function avRouter(sym, ep, key){
  const base = 'https://www.alphavantage.co/query';
  let qs;
  switch(ep){
    case 'quote': qs = new URLSearchParams({ function:'GLOBAL_QUOTE', symbol:sym, apikey:key }); break;
    case 'time_series': qs = new URLSearchParams({ function:'TIME_SERIES_DAILY', symbol:sym,
                                                   outputsize:'compact', apikey:key }); break;
    case 'earnings': qs = new URLSearchParams({ function:'EARNINGS', symbol:sym, apikey:key }); break;
    case 'cash_flow': qs = new URLSearchParams({ function:'CASH_FLOW', symbol:sym, apikey:key }); break;
    case 'income_statement': qs = new URLSearchParams({ function:'INCOME_STATEMENT', symbol:sym, apikey:key }); break;
    default: throw new Error('endpoint not on AV');
  }
  const j = await (await fetch(`${base}?${qs}`)).json();
  if (j['Error Message'] || j['Note']) throw new Error(j['Error Message']||j['Note']);

  if (ep==='quote'){
    const q = j['Global Quote'];
    return {
      symbol: q['01. symbol'],
      open:   +q['02. open'],
      high:   +q['03. high'],
      low:    +q['04. low'],
      close:  +q['05. price'],
      change: +q['09. change'],
      percent_change: parseFloat(q['10. change percent'])
    };
  }
  if (ep==='time_series'){
    const ts = j['Time Series (Daily)']||{};
    return {
      symbol:sym,
      values: Object.entries(ts).map(([date,obj])=>({
        datetime: date,
        open:+obj['1. open'], high:+obj['2. high'],
        low:+obj['3. low'],  close:+obj['4. close'],
        volume:+obj['5. volume']
      })).reverse()
    };
  }
  return j;
}

/* ── Yahoo Finance for Indian tickers ── */
async function yahooRouter(sym, ep){
  if (ep==='quote'){
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`;
    const j = await (await fetch(url)).json();
    if (j.chart.error) throw new Error(j.chart.error.description);
    const res  = j.chart.result[0];
    const meta = res.meta;
    const q    = res.indicators.quote[0];
    return {
      symbol:sym,
      open:q.open[0], high:q.high[0], low:q.low[0],
      close:meta.regularMarketPrice,
      volume:q.volume[0],
      change:meta.regularMarketPrice-meta.previousClose,
      percent_change: ((meta.regularMarketPrice-meta.previousClose)/meta.previousClose)*100,
      datetime:new Date(meta.regularMarketTime*1000).toISOString(),
      source:'Yahoo Finance'
    };
  }

  if (ep==='time_series'){
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5y`;
    const j = await (await fetch(url)).json();
    if (j.chart.error) throw new Error(j.chart.error.description);
    const res = j.chart.result[0];
    const ts  = res.timestamp;
    const q   = res.indicators.quote[0];
    return {
      symbol:sym,
      values: ts.map((t,i)=>({
        datetime:new Date(t*1000).toISOString().split('T')[0],
        open:q.open[i], high:q.high[i], low:q.low[i],
        close:q.close[i], volume:q.volume[i]
      })).filter(v=>v.close!==null),
      source:'Yahoo Finance'
    };
  }

  // Dividends only
  if (ep==='dividends'){
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&events=div`;
    const j = await (await fetch(url)).json();
    const div = j.chart?.result?.[0]?.events?.dividends || {};
    return Object.values(div).map(d=>({
      ex_date: new Date(d.date*1000).toISOString().split('T')[0],
      amount: d.amount
    })).sort((a,b)=>b.ex_date.localeCompare(a.ex_date));
  }

  throw new Error(`Yahoo Finance doesn't support endpoint ${ep}`);
}
