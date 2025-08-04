const API_KEY = '513N9J95UV8ZFFT1';
const CACHE = {};

async function avCall(params) {
  const cacheKey = params;
  if (CACHE[cacheKey] && Date.now() - CACHE[cacheKey].timestamp < 300000) { // 5 min cache
    return CACHE[cacheKey].data;
  }
  
  const url = `https://www.alphavantage.co/query?apikey=${API_KEY}&${params}`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.Note) throw new Error('Alpha Vantage rate limit reached');
  if (data.Information) throw new Error(data.Information);
  
  CACHE[cacheKey] = { data, timestamp: Date.now() };
  return data;
}

export async function getCompanyOverview(symbol) {
  return await avCall(`function=OVERVIEW&symbol=${symbol}`);
}

export async function getIncomeStatement(symbol) {
  return await avCall(`function=INCOME_STATEMENT&symbol=${symbol}`);
}

export async function getCashFlow(symbol) {
  return await avCall(`function=CASH_FLOW&symbol=${symbol}`);
}

export async function getHistoricalPrices(symbol, years = 15) {
  const data = await avCall(`function=TIME_SERIES_DAILY_ADJUSTED&symbol=${symbol}&outputsize=full`);
  return data['Time Series (Daily)'];
}

export async function globalQuote(symbol) {
  const data = await avCall(`function=GLOBAL_QUOTE&symbol=${symbol}`);
  return data['Global Quote'];
}

// Fallback for Indian stocks
export async function fetchYahooData(symbol) {
  try {
    const proxyUrl = 'https://api.allorigins.win/raw?url=';
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
    const response = await fetch(proxyUrl + encodeURIComponent(yahooUrl));
    const data = await response.json();
    
    if (data?.chart?.result?.[0]) {
      const result = data.chart.result[0];
      const meta = result.meta;
      
      return {
        price: meta.regularMarketPrice || meta.previousClose,
        change: meta.regularMarketPrice - meta.previousClose,
        changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
        open: meta.regularMarketOpen,
        high: meta.regularMarketDayHigh,
        low: meta.regularMarketDayLow,
        volume: meta.regularMarketVolume || 0,
        currency: symbol.includes('.NS') ? '₹' : '$'
      };
    }
  } catch (error) {
    throw new Error('Unable to fetch data from Yahoo Finance');
  }
}
