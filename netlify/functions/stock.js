exports.handler = async (event, context) => {
  const { symbol, endpoint = 'quote' } = event.queryStringParameters;
  
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
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=1800', // 30 min cache
      },
      body: JSON.stringify({
        ...data,
        lastUpdated: new Date().toISOString(),
        source: 'Live API'
      })
    };
    
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch data' })
    };
  }
};
