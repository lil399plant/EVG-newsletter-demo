'use strict';

// ── Cache ────────────────────────────────────────────────────────
const groupCache = {};
const CACHE_TTL  = 45_000; // 45 s

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
    { sym: '^N225',     label: 'Nikkei 225'            },
    { sym: '^TOPX',     label: 'TOPIX'                 },
    { sym: '^HSI',      label: 'Hang Seng'             },
    { sym: '000001.SS', label: 'Shanghai'              },
    { sym: '^KS11',     label: 'KOSPI'                 },
    { sym: '^TWII',     label: 'TWSE'                  },
    { sym: '^NSEI',     label: 'Nifty 50'              },
    { sym: '^SET.BK',   label: 'SET'                   },
    { sym: 'USDCNY=X',  label: '🇺🇸🇨🇳 USD/CNY', fx: true },
    { sym: 'USDKRW=X',  label: '🇺🇸🇰🇷 USD/KRW', fx: true },
    { sym: 'USDTWD=X',  label: '🇺🇸🇹🇼 USD/TWD', fx: true },
    { sym: 'USDJPY=X',  label: '🇺🇸🇯🇵 USD/JPY', fx: true },
    { sym: 'GC=F',      label: 'Gold'                  },
    { sym: 'BZ=F',      label: 'Brent'                 },
    { sym: 'CL=F',      label: 'WTI'                   },
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

const UA    = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Fetch one symbol via Yahoo Finance v8/chart (no crumb needed) ─
async function fetchOne(sym) {
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/`
        + encodeURIComponent(sym)
        + '?interval=1d&range=1d';

      const r = await fetch(url, {
        headers: {
          'User-Agent':      UA,
          'Accept':          'application/json, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!r.ok) continue;
      const json = await r.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) continue;

      return {
        symbol: sym,
        price:  meta.regularMarketPrice,
        change: meta.regularMarketChangePercent ?? 0,
        cur:    meta.currency,
        state:  meta.marketState,
      };
    } catch { continue; }
  }
  return null;
}

// ── Handler ───────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');

  const group = (req.query.group || '').toLowerCase();
  if (!GROUPS[group]) {
    return res.status(400).json({ error: 'group must be us, apac, or europe' });
  }

  // Serve from cache
  const cached = groupCache[group];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return res.json(cached.items);

  const tickers  = GROUPS[group];
  const uniqSyms = [...new Set(tickers.map(t => t.sym))];

  // Fetch in batches of 5, 300 ms apart — avoids 429 while staying fast
  const quoteMap = {};
  const BATCH = 5;
  for (let i = 0; i < uniqSyms.length; i += BATCH) {
    if (i > 0) await sleep(300);
    const results = await Promise.all(uniqSyms.slice(i, i + BATCH).map(fetchOne));
    results.forEach(r => { if (r) quoteMap[r.symbol] = r; });
  }

  const items = tickers.map(t => {
    const q = quoteMap[t.sym];
    return {
      sym:    t.sym,
      label:  t.label,
      fx:     !!t.fx,
      price:  q?.price  ?? null,
      change: q?.change ?? null,
      cur:    q?.cur    ?? null,
      state:  q?.state  ?? null,
    };
  });

  groupCache[group] = { ts: Date.now(), items };
  return res.json(items);
};
