// api/quote.js (Vercel serverless function!)
export default async function handler(req, res) {
  const symbol = req.query.symbol;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  const apiKey = process.env.TWELVE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key missing' });

  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
  try {
    const r = await fetch(url);
    const data = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
