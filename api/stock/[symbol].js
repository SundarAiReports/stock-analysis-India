// api/stock/[symbol].js
export default async function handler(req, res) {
  const { symbol } = req.query;
  const endpoint = req.query.endpoint || 'quote';
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  try {
    const params = new URLSearchParams({
      symbol,
      apikey: process.env.TWELVEDATA_API_KEY,
      ...(endpoint === 'time_series' && { 
        interval: '1day', 
        outputsize: 1000 
      })
    });
    
    const response = await fetch(
      `https://api.twelvedata.com/${endpoint}?${params}`
    );
    const data = await response.json();
    
    if (data.status === 'error') {
      return res.status(400).json({ error: data.message });
    }
    
    // Add metadata
    data.lastUpdated = new Date().toISOString();
    data.source = 'Live API';
    
    // Cache for 30 minutes
    res.setHeader('Cache-Control', 's-maxage=1800');
    
    res.json(data);
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }
}
