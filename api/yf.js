module.exports = async function handler(req, res) {
  const sym = req.query.sym;
  if (!sym) return res.status(400).json({ error: 'sym required' });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finance.yahoo.com/',
        'Origin': 'https://finance.yahoo.com',
      }
    });
    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
