'use strict';
const https = require('https');

// ── In-memory cache (survives warm lambda invocations) ────────────
const groupCache = {};
const CACHE_TTL  = 45_000; // 45 s

let yfCrumb  = null;
let yfCookie = null;
let crumbExp = 0;

// ── Ticker definitions ────────────────────────────────────────────
const GROUPS = {
  us: [
    { sym: '^GSPC',     label: 'S&P 500'     },
    { sym: '^DJI',      label: 'DJIA'        },
    { sym: 'QQQ',       label: 'QQQ'         },
    { sym: '^IXIC',     label: 'Nasdaq'      },
    { sym: '^MID',      label: 'S&P 400'     },
    { sym: '^RUT',      label: 'Russell 2K'  },
    { sym: 'NVDA',      label: 'NVDA'        },
    { sym: 'MSFT',      label: 'MSFT'        },
    { sym: 'JPM',       label: 'JPM'         },
    { sym: 'GC=F',      label: 'Gold'        },
    { sym: 'BZ=F',      label: 'Brent'       },
    { sym: 'CL=F',      label: 'WTI'         },
  ],
  apac: [
    { sym: '^N225',     label: 'Nikkei 225'          },
    { sym: '^TOPX',     label: 'TOPIX'               },
    { sym: '^HSI',      label: 'Hang Seng'           },
    { sym: '000001.SS', label: 'Shanghai'            },
    { sym: '^KS11',     label: 'KOSPI'               },
    { sym: '^TWII',     label: 'TWSE'                },
    { sym: '^NSEI',     label: 'Nifty 50'            },
    { sym: '^SET.BK',   label: 'SET'                 },
    { sym: 'USDCNY=X',  label: '🇺🇸🇨🇳 USD/CNY', fx: true },
    { sym: 'USDKRW=X',  label: '🇺🇸🇰🇷 USD/KRW', fx: true },
    { sym: 'USDTWD=X',  label: '🇺🇸🇹🇼 USD/TWD', fx: true },
    { sym: 'USDJPY=X',  label: '🇺🇸🇯🇵 USD/JPY', fx: true },
    { sym: 'GC=F',      label: 'Gold'                },
    { sym: 'BZ=F',      label: 'Brent'               },
    { sym: 'CL=F',      label: 'WTI'                 },
  ],
  europe: [
    { sym: '^STOXX',    label: 'STOXX 600'   },
    { sym: '^FTSE',     label: 'FTSE 100'    },
    { sym: '^GDAXI',    label: 'DAX'         },
    { sym: '^FCHI',     label: 'CAC 40'      },
    { sym: 'NVO',       label: 'Novo Nordisk'},
    { sym: 'MC.PA',     label: 'LVMH'        },
    { sym: 'ASML.AS',   label: 'ASML'        },
    { sym: 'SHEL.L',    label: 'Shell'       },
    { sym: 'AZN.L',     label: 'AstraZeneca' },
    { sym: 'SAP.DE',    label: 'SAP SE'      },
    { sym: 'GC=F',      label: 'Gold'        },
    { sym: 'BZ=F',      label: 'Brent'       },
    { sym: 'CL=F',      label: 'WTI'         },
  ],
};

// ── HTTP helper ───────────────────────────────────────────────────
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function httpGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent':      UA,
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer':         'https://finance.yahoo.com/',
        ...extraHeaders,
      },
      timeout: 9000,
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Yahoo Finance crumb (cached ~55 min) ──────────────────────────
async function ensureCrumb() {
  if (yfCrumb && Date.now() < crumbExp) return true;
  try {
    const { headers } = await httpGet('https://finance.yahoo.com/');
    const setCookie = headers['set-cookie'] || [];
    yfCookie = (Array.isArray(setCookie) ? setCookie : [setCookie])
      .map(c => c.split(';')[0]).filter(Boolean).join('; ');
    const { body } = await httpGet(
      'https://query2.finance.yahoo.com/v1/test/getcrumb',
      { 'Cookie': yfCookie }
    );
    yfCrumb  = body.trim();
    crumbExp = Date.now() + 55 * 60 * 1000;
    return !!yfCrumb;
  } catch {
    return false;
  }
}

// ── Primary: v7/finance/quote (one request for ALL symbols) ───────
async function fetchBatch(symbols) {
  const hasCrumb = await ensureCrumb();
  const syms     = symbols.map(encodeURIComponent).join('%2C');
  const crumbQ   = hasCrumb ? `&crumb=${encodeURIComponent(yfCrumb)}` : '';
  const cookieH  = hasCrumb ? { Cookie: yfCookie } : {};

  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v7/finance/quote`
        + `?symbols=${syms}${crumbQ}`
        + `&fields=regularMarketPrice,regularMarketChangePercent,currency,marketState`;
      const { status, body } = await httpGet(url, cookieH);
      if (status !== 200) continue;
      const json    = JSON.parse(body);
      const results = json?.quoteResponse?.result;
      if (results?.length) return results;
    } catch { continue; }
  }
  return null;
}

// ── Fallback: v8/finance/chart (individual, staggered) ───────────
async function fetchChart(sym) {
  const crumbQ  = yfCrumb ? `&crumb=${encodeURIComponent(yfCrumb)}` : '';
  const cookieH = yfCookie ? { Cookie: yfCookie } : {};
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/`
        + `${encodeURIComponent(sym)}?interval=1d&range=1d${crumbQ}`;
      const { status, body } = await httpGet(url, cookieH);
      if (status !== 200) continue;
      const meta = JSON.parse(body)?.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) continue;
      return {
        symbol:                      sym,
        regularMarketPrice:          meta.regularMarketPrice,
        regularMarketChangePercent:  meta.regularMarketChangePercent,
        currency:                    meta.currency,
        marketState:                 meta.marketState,
      };
    } catch { continue; }
  }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Handler ───────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');

  const group = (req.query.group || '').toLowerCase();
  if (!GROUPS[group]) {
    return res.status(400).json({ error: 'group must be us, apac, or europe' });
  }

  // Serve from cache if fresh
  const cached = groupCache[group];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return res.json(cached.items);

  const tickers  = GROUPS[group];
  const uniqSyms = [...new Set(tickers.map(t => t.sym))];

  // 1. Try batch (single request)
  const quoteMap = {};
  try {
    const batch = await fetchBatch(uniqSyms);
    if (batch) batch.forEach(q => { quoteMap[q.symbol] = q; });
  } catch { /* fall through */ }

  // 2. Fill gaps with staggered individual requests
  const missing = uniqSyms.filter(s => !quoteMap[s]);
  for (let i = 0; i < missing.length; i++) {
    if (i > 0) await sleep(200);
    try {
      const r = await fetchChart(missing[i]);
      if (r) quoteMap[r.symbol] = r;
    } catch { /* skip */ }
  }

  // Build ordered response (preserves duplicates like Gold across groups)
  const items = tickers.map(t => {
    const q = quoteMap[t.sym];
    return {
      sym:    t.sym,
      label:  t.label,
      fx:     !!t.fx,
      price:  q?.regularMarketPrice          ?? null,
      change: q?.regularMarketChangePercent  ?? null,
      cur:    q?.currency                    ?? null,
      state:  q?.marketState                 ?? null,
    };
  });

  groupCache[group] = { ts: Date.now(), items };
  return res.json(items);
};
