/*
 * netlify/functions/stock.js
 * Multi-provider stock data API with Indian stock detection
 * Tries: TwelveData → FMP → Finnhub → Alpha Vantage (for US stocks)
 *        Yahoo Finance (for Indian stocks ending in .NS/.BO)
 */

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  const { symbol, endpoint = 'quote' } = event.queryStringParameters || {};

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET',
    'Cache-Control': 'max-age=1800' // 30 min cache
  };

  try {
    if (!symbol) {
      throw new Error('Missing symbol parameter');
    }

    // ──────── BULLETPROOF INDIAN STOCK DETECTION ────────
    const isIndianStock = /\.(NS|BO)$/i.test(symbol);
    console.log(`Symbol: ${symbol}, Is Indian: ${isIndianStock}`);

    if (isIndianStock) {
      console.log('🇮🇳 Routing to Yahoo Finance for Indian stock');
      const yahooData = await fetchFromYahoo(symbol, endpoint);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ...yahooData,
          source: 'Yahoo Finance',
          lastUpdated: new Date().toISOString()
        })
      };
    }

    // ──────── US STOCKS: CASCADE THROUGH PROVIDERS ────────
    console.log('🇺🇸 Routing to US providers for non-Indian stock');
    
    const providers = [
      { name: 'TwelveData', fn: fetchFromTwelveData, key: process.env.TWELVEDATA_API_KEY },
      { name: 'FMP', fn: fetchFromFMP, key: process.env.FMP_API_KEY },
      { name: 'Finnhub', fn: fetchFromFinnhub, key: process.env.FINNHUB_API_KEY },
      { name: 'AlphaVantage', fn: fetchFromAlphaVantage, key: process.env.ALPHA_VANTAGE_API_KEY }
    ];

    let lastError = null;

    for (const [index, provider] of providers.entries()) {
      if (!provider.key) {
        console.log(`❌ ${provider.name}: API key missing`);
        continue;
      }

      try {
        console.log(`🔄 Trying ${provider.name} (attempt ${index + 1})`);
        const data = await provider.fn(symbol, endpoint, provider.key);
        
        if (data && (data.symbol || data.values || Array.isArray(data))) {
          console.log(`✅ ${provider.name} succeeded`);
          
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              ...data,
              source: provider.name,
              lastUpdated: new Date().toISOString()
            })
          };
        }
      } catch (error) {
        console.log(`❌ ${provider.name} failed: ${error.message}`);
        lastError = error;
        continue;
      }
    }

    throw new Error(`All providers failed. Last error: ${lastError?.message || 'Unknown'}`);

  } catch (error) {
    console.error('Handler error:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.message || 'Internal server error',
        symbol: symbol,
        endpoint: endpoint
      })
    };
  }
};

// ═══════════════════ PROVIDER IMPLEMENTATIONS ═══════════════════

async function fetchFromTwelveData(symbol, endpoint, apiKey) {
  const params = new URLSearchParams({
    symbol,
    apikey: apiKey,
    ...(endpoint === 'time_series' && { 
      interval: '1day', 
      outputsize: 1000 
    })
  });

  const response = await fetch(`https://api.twelvedata.com/${endpoint}?${params}`);
  const data = await response.json();

  if (data.status === 'error' || data.message?.includes('limit') || data.message?.includes('exceeded')) {
    throw new Error(data.message || 'TwelveData API error');
  }

  return data;
}

async function fetchFromFMP(symbol, endpoint, apiKey) {
  const baseUrl = 'https://financialmodelingprep.com/api/v3';
  let url;

  switch (endpoint) {
    case 'quote':
      url = `${baseUrl}/quote/${symbol}?apikey=${apiKey}`;
      break;
    case 'time_series':
      url = `${baseUrl}/historical-price-full/${symbol}?apikey=${apiKey}`;
      break;
    case 'dividends':
      url = `${baseUrl}/historical-price-full/stock_dividend/${symbol}?apikey=${apiKey}`;
      break;
    case 'earnings':
      url = `${baseUrl}/earnings-surprises/${symbol}?apikey=${apiKey}`;
      break;
    case 'cash_flow':
      url = `${baseUrl}/cash-flow-statement/${symbol}?limit=40&apikey=${apiKey}`;
      break;
    case 'income_statement':
      url = `${baseUrl}/income-statement/${symbol}?limit=40&apikey=${apiKey}`;
      break;
    default:
      throw new Error(`FMP doesn't support ${endpoint}`);
  }

  const response = await fetch(url);
  const data = await response.json();

  if (data.Error || (Array.isArray(data) && data.length === 0)) {
    throw new Error('FMP: No data available');
  }

  // Normalize FMP data format
  if (endpoint === 'quote') {
    const quote = Array.isArray(data) ? data[0] : data;
    return {
      symbol: quote.symbol,
      open: quote.open,
      high: quote.dayHigh,
      low: quote.dayLow,
      close: quote.price,
      volume: quote.volume,
      change: quote.change,
      percent_change: quote.changesPercentage
    };
  } else if (endpoint === 'time_series') {
    return {
      symbol: symbol,
      values: data.historical?.map(item => ({
        datetime: item.date,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume
      })) || []
    };
  }

  return data;
}

async function fetchFromFinnhub(symbol, endpoint, apiKey) {
  const baseUrl = 'https://finnhub.io/api/v1';
  let url;

  switch (endpoint) {
    case 'quote':
      url = `${baseUrl}/quote?symbol=${symbol}&token=${apiKey}`;
      break;
    case 'time_series':
      const to = Math.floor(Date.now() / 1000);
      const from = to - (365 * 24 * 60 * 60 * 5); // 5 years
      url = `${baseUrl}/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${apiKey}`;
      break;
    case 'dividends':
      const toDate = new Date().toISOString().split('T')[0];
      const fromDate = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      url = `${baseUrl}/stock/dividend?symbol=${symbol}&from=${fromDate}&to=${toDate}&token=${apiKey}`;
      break;
    case 'earnings':
      url = `${baseUrl}/stock/earnings?symbol=${symbol}&token=${apiKey}`;
      break;
    default:
      throw new Error(`Finnhub doesn't support ${endpoint}`);
  }

  const response = await fetch(url);
  const data = await response.json();

  if (data.error || data.s === 'no_data') {
    throw new Error('Finnhub: No data available');
  }

  // Normalize Finnhub data format
  if (endpoint === 'quote') {
    return {
      symbol: symbol,
      open: data.o,
      high: data.h,
      low: data.l,
      close: data.c,
      volume: data.v,
      change: data.d,
      percent_change: data.dp
    };
  } else if (endpoint === 'time_series') {
    return {
      symbol: symbol,
      values: data.t.map((timestamp, i) => ({
        datetime: new Date(timestamp * 1000).toISOString().split('T')[0],
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
        volume: data.v[i]
      }))
    };
  }

  return data;
}

async function fetchFromAlphaVantage(symbol, endpoint, apiKey) {
  const baseUrl = 'https://www.alphavantage.co/query';
  let params;

  switch (endpoint) {
    case 'quote':
      params = new URLSearchParams({
        function: 'GLOBAL_QUOTE',
        symbol: symbol,
        apikey: apiKey
      });
      break;
    case 'time_series':
      params = new URLSearchParams({
        function: 'TIME_SERIES_DAILY',
        symbol: symbol,
        outputsize: 'compact',
        apikey: apiKey
      });
      break;
    case 'earnings':
      params = new URLSearchParams({
        function: 'EARNINGS',
        symbol: symbol,
        apikey: apiKey
      });
      break;
    case 'cash_flow':
      params = new URLSearchParams({
        function: 'CASH_FLOW',
        symbol: symbol,
        apikey: apiKey
      });
      break;
    case 'income_statement':
      params = new URLSearchParams({
        function: 'INCOME_STATEMENT',
        symbol: symbol,
        apikey: apiKey
      });
      break;
    default:
      throw new Error(`Alpha Vantage doesn't support ${endpoint}`);
  }

  const response = await fetch(`${baseUrl}?${params}`);
  const data = await response.json();

  if (data['Error Message'] || data['Note']) {
    throw new Error(data['Error Message'] || data['Note'] || 'Alpha Vantage API error');
  }

  // Normalize Alpha Vantage data format
  if (endpoint === 'quote') {
    const quote = data['Global Quote'];
    return {
      symbol: quote['01. symbol'],
      open: parseFloat(quote['02. open']),
      high: parseFloat(quote['03. high']),
      low: parseFloat(quote['04. low']),
      close: parseFloat(quote['05. price']),
      volume: parseInt(quote['06. volume']),
      change: parseFloat(quote['09. change']),
      percent_change: parseFloat(quote['10. change percent'].replace('%', ''))
    };
  } else if (endpoint === 'time_series') {
    const timeSeries = data['Time Series (Daily)'] || {};
    return {
      symbol: symbol,
      values: Object.entries(timeSeries).map(([date, values]) => ({
        datetime: date,
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
        volume: parseInt(values['5. volume'])
      })).reverse()
    };
  }

  return data;
}

// ═══════════════════ YAHOO FINANCE FOR INDIAN STOCKS ═══════════════════

async function fetchFromYahoo(symbol, endpoint) {
  try {
    if (endpoint === 'quote') {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`
      );
      const data = await response.json();

      if (data.chart.error) {
        throw new Error(data.chart.error.description);
      }

      const result = data.chart.result[0];
      const meta = result.meta;
      const quote = result.indicators.quote[0];

      return {
        symbol: symbol,
        open: quote.open[0],
        high: quote.high[0],
        low: quote.low[0],
        close: meta.regularMarketPrice,
        volume: quote.volume[0],
        change: meta.regularMarketPrice - meta.previousClose,
        percent_change: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
        datetime: new Date(meta.regularMarketTime * 1000).toISOString()
      };

    } else if (endpoint === 'time_series') {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5y`
      );
      const data = await response.json();

      if (data.chart.error) {
        throw new Error(data.chart.error.description);
      }

      const result = data.chart.result[0];
      const timestamps = result.timestamp;
      const quotes = result.indicators.quote[0];

      return {
        symbol: symbol,
        values: timestamps.map((time, index) => ({
          datetime: new Date(time * 1000).toISOString().split('T')[0],
          open: quotes.open[index],
          high: quotes.high[index],
          low: quotes.low[index],
          close: quotes.close[index],
          volume: quotes.volume[index]
        })).filter(item => item.close !== null)
      };

    } else if (endpoint === 'dividends') {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?events=div&range=5y`
      );
      const data = await response.json();

      const dividends = data.chart?.result?.[0]?.events?.dividends || {};

      return Object.values(dividends).map(div => ({
        ex_date: new Date(div.date * 1000).toISOString().split('T')[0],
        amount: div.amount,
        record_date: new Date(div.date * 1000).toISOString().split('T')[0]
      })).sort((a, b) => new Date(b.ex_date) - new Date(a.ex_date));

    } else {
      // For other endpoints (earnings, financials), return empty array
      // Yahoo Finance free API doesn't provide detailed financial statements
      return [];
    }

  } catch (error) {
    throw new Error(`Yahoo Finance error: ${error.message}`);
  }
}
