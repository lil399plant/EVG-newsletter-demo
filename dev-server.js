// Local dev server: serves static files + proxies /api/yf to Yahoo Finance
const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT = 3456;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.jpg':  'image/jpeg',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.woff2':'font/woff2',
  '.json': 'application/json',
};

// ── Yahoo Finance crumb/cookie cache ─────────────────────────
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

  // 1. Hit the home page to get a session cookie
  const r1 = await fetch('https://finance.yahoo.com/', {
    headers: YF_HEADERS, redirect: 'follow'
  });
  const setCookie = r1.headers.get('set-cookie') || '';
  // grab all cookie k=v pairs, ignore attributes
  yfCookie = setCookie.split(',')
    .map(s => s.trim().split(';')[0])
    .filter(Boolean)
    .join('; ');

  // 2. Fetch the crumb
  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { ...YF_HEADERS, 'Cookie': yfCookie }
  });
  yfCrumb = (await r2.text()).trim();
  crumbExp = Date.now() + 55 * 60 * 1000; // 55 min
  console.log('YF crumb refreshed:', yfCrumb);
}

async function fetchYF(sym) {
  await getYFCrumb();
  const symEnc = encodeURIComponent(sym);
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symEnc}?interval=1d&range=1d&crumb=${encodeURIComponent(yfCrumb)}`,
    { headers: { ...YF_HEADERS, 'Cookie': yfCookie } }
  );
  return r.json();
}

// ── HTTP server ───────────────────────────────────────────────
http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/api/yf') {
    const sym = parsed.query.sym;
    if (!sym) { res.writeHead(400); res.end('{"error":"sym required"}'); return; }
    try {
      const data = await fetchYF(sym);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      console.error('YF error:', e.message);
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Static files
  let filePath = path.join(ROOT, parsed.pathname === '/' ? 'index.html' : parsed.pathname);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });

}).listen(PORT, () => console.log(`Dev server at http://localhost:${PORT}`));
