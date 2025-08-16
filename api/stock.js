// api/stock.js
export default async function handler(req, res) {
  const { symbol, endpoint } = req.query;
  if (!symbol || !endpoint)
    return res.status(400).json({ error: 'Missing symbol or endpoint param' });

  // For each endpoint, choose the provider you want, using your Vercel env vars for secrets.
  let url = '', headers = {};
  const tda = process.env.TWELVE_API_KEY, fmp = process.env.FMP_API_KEY,
        av = process.env.ALPHA_VANTAGE_API_KEY, fh = process.env.FINNHUB_API_KEY;

  // Per endpoint, construct the needed URL; adjust as needed for your use-case.
  if (endpoint === 'quote') {
    url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${tda}`;
  } else if (endpoint === 'time_series') {
    url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=4000&apikey=${tda}`;
  } else if (endpoint === 'dividends') {
    // Example with FMP, if desired:
    url = `https://financialmodelingprep.com/api/v3/stock_dividend/${encodeURIComponent(symbol)}?apikey=${fmp}`;
  } else if (endpoint === 'earnings') {
    url = `https://financialmodelingprep.com/api/v3/earning_surprises/${encodeURIComponent(symbol)}?apikey=${fmp}`;
  } else if (endpoint === 'cash_flow') {
    url = `https://financialmodelingprep.com/api/v3/cash-flow-statement/${encodeURIComponent(symbol)}?limit=20&apikey=${fmp}`;
  } else if (endpoint === 'income_statement') {
    url = `https://financialmodelingprep.com/api/v3/income-statement/${encodeURIComponent(symbol)}?limit=20&apikey=${fmp}`;
  } else {
    return res.status(400).json({ error: 'Unknown endpoint' });
  }

  try {
    const r = await fetch(url, { headers });
    const ct = r.headers.get('content-type');
    let data = await (ct && ct.includes('application/json') ? r.json() : r.text());
    // FMP endpoints return arrays, but you expect object in frontend: flatten if needed.
    if ((endpoint === 'dividends' || endpoint === 'earnings' || endpoint === 'cash_flow' || endpoint === 'income_statement') && Array.isArray(data) && data.length) {
      data = data;
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
