let yfCrumb  = null;
let yfCookie = null;
let crumbExp = 0;

const YF_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://finance.yahoo.com/',
  'Origin':          'https://finance.yahoo.com',
};

async function getYFCrumb() {
  if (yfCrumb && Date.now() < crumbExp) return;
  const r1 = await fetch('https://finance.yahoo.com/', { headers: YF_HEADERS, redirect: 'follow' });
  const setCookie = r1.headers.get('set-cookie') || '';
  yfCookie = setCookie.split(',').map(s => s.trim().split(';')[0]).filter(Boolean).join('; ');
  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { ...YF_HEADERS, 'Cookie': yfCookie }
  });
  yfCrumb = (await r2.text()).trim();
  crumbExp = Date.now() + 55 * 60 * 1000;
}

module.exports = async function handler(req, res) {
  const sym = req.query.sym;
  if (!sym) return res.status(400).json({ error: 'sym required' });

  try {
    await getYFCrumb();
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d&crumb=${encodeURIComponent(yfCrumb)}`,
      { headers: { ...YF_HEADERS, 'Cookie': yfCookie } }
    );
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
