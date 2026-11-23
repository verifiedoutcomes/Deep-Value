#!/usr/bin/env python3
"""
Build packages/data/src/universe.json: every S&P 500 and Nasdaq-100
constituent, mapped to its SEC CIK and classified by what SEC filings can
support.

Sources (fetched fresh each run; stdlib only):
  - S&P 500:    https://en.wikipedia.org/wiki/List_of_S%26P_500_companies
  - Nasdaq-100: https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies
    (constituent tables, CC BY-SA; tickers, names, sectors)
  - SEC ticker map: https://www.sec.gov/files/company_tickers_exchange.json
  - SEC submissions (per CIK): form types filed, to classify support

Every ticker must resolve to a CIK in SEC's own map and, where the S&P
table lists a CIK, the two must agree; the script fails loudly otherwise.

  python3 scripts/build_universe.py            # writes the JSON
"""
import gzip
import json
import sys
import time
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

UA = 'DeepValueHunter-research/0.1 (contact: research@example.com)'
SP500_URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
NDX_URL = 'https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies'
SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_exchange.json'
OUT = Path(__file__).resolve().parent.parent / 'packages/data/src/universe.json'

# Holding-company reorganisations that moved a company to a new CIK; the
# predecessor carries its history. Each verified by SEC entity name and by
# its 10-K periods ending where the successor's begin.
PREDECESSORS = {
    'XOM': [34088],     # Exxon Mobil Corporation (2026 holdco reorganisation)
    'BLK': [1364742],   # BlackRock Finance, Inc. (formerly BlackRock, Inc.)
    'BG': [1144519],    # Bunge Ltd (redomiciled as Bunge Global SA, 2023)
    'APO': [1411494],   # Apollo Asset Management (formerly Apollo Global Mgmt)
    'APA': [6769],      # Apache Corp (APA Corp holdco, 2021)
    'MRVL': [1058057],  # Marvell Technology Group (redomiciled 2021)
}


def get(url, binary=False):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'gzip'})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                if r.headers.get('Content-Encoding') == 'gzip':
                    data = gzip.decompress(data)
            return data if binary else data.decode('utf-8')
        except Exception as e:  # noqa: BLE001 - retry any transport error
            err = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f'GET {url} failed: {err}')


class Tables(HTMLParser):
    """Collect top-level wikitables as lists of cell-text rows."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.depth, self.cur, self.row, self.cell, self.skip = [], 0, None, None, None, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'table':
            self.depth += 1
            if self.depth == 1 and 'wikitable' in (a.get('class') or ''):
                self.cur = {'id': a.get('id'), 'rows': []}
        elif self.cur is not None and self.depth == 1:
            if tag == 'tr':
                self.row = []
            elif tag in ('td', 'th') and self.row is not None:
                self.cell = []
            elif tag in ('sup', 'style'):
                self.skip += 1

    def handle_endtag(self, tag):
        if tag == 'table':
            if self.depth == 1 and self.cur is not None:
                self.tables.append(self.cur)
                self.cur = None
            self.depth -= 1
        elif self.cur is not None and self.depth == 1:
            if tag in ('td', 'th') and self.cell is not None and self.row is not None:
                self.row.append(' '.join(''.join(self.cell).split()))
                self.cell = None
            elif tag == 'tr' and self.row is not None:
                if self.row:
                    self.cur['rows'].append(self.row)
                self.row = None
            elif tag in ('sup', 'style') and self.skip:
                self.skip -= 1

    def handle_data(self, d):
        if self.cell is not None and not self.skip:
            self.cell.append(d)


def constituents(url, ticker_col, name_col, sector_col):
    p = Tables()
    p.feed(get(url))
    t = next(t for t in p.tables if t['id'] == 'constituents')
    head, rows = t['rows'][0], t['rows'][1:]
    ix = {h: i for i, h in enumerate(head)}
    out = []
    for r in rows:
        out.append({
            'ticker': r[ix[ticker_col]].strip().upper().replace('.', '-'),
            'name': r[ix[name_col]].strip(),
            'sector': r[ix[sector_col]].strip(),
            'cik': int(r[ix['CIK']]) if 'CIK' in ix and r[ix['CIK']].strip() else None,
        })
    return out


def main():
    sp = constituents(SP500_URL, 'Symbol', 'Security', 'GICS Sector')
    ndx = constituents(NDX_URL, 'Ticker', 'Company', 'ICB Industry')
    if not (500 <= len(sp) <= 510 and 100 <= len(ndx) <= 104):
        sys.exit(f'unexpected constituent counts: S&P {len(sp)}, Nasdaq-100 {len(ndx)}')

    sec = json.loads(get(SEC_TICKERS_URL))
    sec_rows = [dict(zip(sec['fields'], r)) for r in sec['data']]
    by_ticker = {}
    for r in sec_rows:
        by_ticker.setdefault(r['ticker'].upper(), r)

    uni = {}
    for index, members in (('SP500', sp), ('NDX', ndx)):
        for m in members:
            e = uni.setdefault(m['ticker'], {'ticker': m['ticker'], 'indexes': []})
            e['indexes'].append(index)
            e.setdefault('name', m['name'])
            e.setdefault('sector', m['sector'])
            s = by_ticker.get(m['ticker'])
            if not s:
                sys.exit(f"{m['ticker']}: not in SEC's ticker map")
            if m['cik'] is not None and m['cik'] != s['cik']:
                sys.exit(f"{m['ticker']}: CIK {m['cik']} (index table) != {s['cik']} (SEC)")
            e['cik'] = s['cik']
            e['exchange'] = s['exchange']

    # classify support from each registrant's filing history
    def forms(cik):
        sub = json.loads(get(f'https://data.sec.gov/submissions/CIK{cik:010d}.json'))
        time.sleep(0.15)  # SEC fair access: well under 10 requests/second
        return set(sub['filings']['recent']['form'])

    for e in sorted(uni.values(), key=lambda e: e['ticker']):
        pred = PREDECESSORS.get(e['ticker'], [])
        fs = set().union(*(forms(c) for c in [e['cik'], *pred]))
        if pred:
            e['predecessors'] = pred
        if fs & {'10-K', '10-K/A', '10-KT'}:
            e['status'] = 'ok'
        elif fs & {'20-F', '40-F', '20-F/A', '40-F/A'}:
            e['status'] = 'foreign-filer'
        else:
            e['status'] = 'no-annual-report'

    companies = sorted(uni.values(), key=lambda e: e['ticker'])
    OUT.write_text(json.dumps({
        'asOf': date.today().isoformat(),
        'sources': {
            'sp500': SP500_URL,
            'nasdaq100': NDX_URL,
            'sec': SEC_TICKERS_URL,
            'license': 'Constituent tables: Wikipedia, CC BY-SA 4.0. SEC data: public domain.',
        },
        'companies': companies,
    }, indent=1) + '\n')
    counts = {s: sum(1 for c in companies if c['status'] == s) for s in ('ok', 'foreign-filer', 'no-annual-report')}
    print(f'{len(companies)} companies (S&P 500: {len(sp)}, Nasdaq-100: {len(ndx)}) -> {OUT}')
    print(counts)
    for c in companies:
        if c['status'] != 'ok':
            print(f"  {c['status']:17} {c['ticker']:6} {c['name']}")


if __name__ == '__main__':
    main()
