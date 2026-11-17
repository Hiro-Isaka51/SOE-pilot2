"""
The Simple view (docs/DESIGN-simple-view.md, sections "Hard rules", "DOM contract", "Copy", "Tests"):
the built SOE-Fiscal-Risk-Final.html opens in Simple view, its figures equal the Analyst view's, no
technical label leaks into it, and the Analyst view is intact behind the mode switch.

Seven groups of checks (Playwright, chromium, headless, file:// URL of the built file):
  1 landing state              2 totals equal the Analyst view   3 sizes block follows the scenario
  4 banned labels              5 mode switch, Analyst view intact 6 upload with a Country column (GDP)
  7 one-SOE page

Where Simple-view figures are compared with Analyst-view figures, the DISPLAYED text is compared (both views
format money with the same money() helper). Where two Simple-view numbers must agree, data-v is compared with
a relative tolerance of 1e-9. All failures are collected and printed, then the exit code is 1.

Analyst-view sources (templates/app.js):
  * Expected Fiscal Cost tab, first tile "Aggregate EFC" (pages.efc render, tile(...) at app.js:1755):
    `#efc .statstrip .tile` number 1, `.tile-value` first text node = money(total).
  * Report tab, card "Stress by channel" (pages.report render, table `ct` at app.js:3298-3353): one row per
    CHANNELS() entry in order combined, fuel, fx, rate, revenue, refi, arrears (CHANNELS at app.js:3212).
    Columns (td index): 0 Scenario, 1 Shock, 2 SOEs dropping a zone, 3 "EFC no shock, <year>" (money(eB)),
    4 "EFC stressed" (money(eS), the stressed portfolio expected fiscal cost), 5 Change. Column 4 is compared.
  * World Bank lookup (app.js:1641-1652): GET https://api.worldbank.org/v2/country/<ISO3>/indicator/<NY.GDP.MKTP.CN|CD>
    ?date=<year>&format=json&source=2; parser at app.js:1649-1650 takes data[1].find(r => String(r.date) === year
    && Number.isFinite(r.value)).value. GDP at the horizon follows E.gdpPath(gdp, growth, H)[H] =
    gdp * (1 + growth) ** H (engine.js:584), growth = meta.gdp_growth ?? CFG.DEFAULT_GDP_GROWTH (app.js:542).

    python3 tests/check_simple_view.py      (run from the repo root; needs playwright + chromium)
"""

import csv
import json
import math
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "SOE-Fiscal-Risk-Final.html"

try:
    from playwright.sync_api import sync_playwright
except Exception:  # noqa: BLE001
    print("SKIPPED: playwright is not installed (pip install playwright && playwright install chromium)")
    sys.exit(0)

URL = HTML.resolve().as_uri()
SHORT = 4000          # ms, for elements that should already be there
CHANNEL_KEYS = ["fuel", "fx", "rate", "revenue", "refi", "arrears", "combined"]
REPORT_ORDER = ["combined", "fuel", "fx", "rate", "revenue", "refi", "arrears"]   # CHANNELS() order
SCENARIOS = ["none"] + CHANNEL_KEYS
DATASETS = [("sample", "Example"), ("demo", "Demo portfolio"), ("long", "Long panel")]
TABS = ["Home", "How it works", "KPI Dashboard", "Distress Indicator", "Expected Fiscal Cost", "Shock Scenarios",
        "Early Warning", "Report"]
BANNED = ["PD", "LGD", "EAD", "EFC", "Z″", "Z-EM", "X1", "X2", "X3", "X4", "bps", "s.d.", "std. dev.", "Monte Carlo",
          "P5", "P95", "percentile"]
CASE_INSENSITIVE = {"bps", "std. dev.", "s.d.", "Monte Carlo", "percentile"}

FAILS = []
CHECKS = 0
CTX = {"errors": []}


def check(cond, msg):
    global CHECKS
    CHECKS += 1
    if not cond:
        FAILS.append(msg)
    return bool(cond)


def fail(msg):
    check(False, msg)


def num(s):
    try:
        v = float(s)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def close(a, b, tol=1e-9):
    return a is not None and b is not None and abs(a - b) <= tol * max(abs(a), abs(b), 1e-300)


def money_text(s):
    """Displayed money with whitespace and the currency suffix removed ('1.2 bn FCFA' -> '1.2 bn')."""
    s = re.sub(r"\s+", " ", (s or "").replace(" ", " ")).strip()
    m = re.match(r"^(−?[\d,]+(?:\.\d+)?(?: (?:tn|bn|m))?)(?: [A-Za-z]{2,5})?$", s)
    return m.group(1) if m else s


def new_page(browser, url=URL, **kw):
    ctx = browser.new_context(reduced_motion="reduce", viewport={"width": 1400, "height": 1000}, **kw)
    page = ctx.new_page()
    page.set_default_timeout(SHORT)
    page.on("pageerror", lambda e: CTX["errors"].append(str(e)))
    page.goto(url)
    page.wait_for_load_state("load")
    return page


def present(page, sel, what, timeout=SHORT):
    """True when sel appears; otherwise record one 'cannot check' failure."""
    try:
        page.wait_for_selector(sel, state="attached", timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        fail(f"cannot check {what}: {sel} missing")
        return False


def attr(page, sel, name):
    try:
        return page.locator(sel).first.get_attribute(name, timeout=SHORT)
    except Exception:  # noqa: BLE001
        return None


def text(page, sel):
    try:
        return page.locator(sel).first.text_content(timeout=SHORT) or ""
    except Exception:  # noqa: BLE001
        return None


def visible_count(page, sel):
    return page.locator(sel).evaluate_all(
        "els => els.filter(e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden').length")


def is_visible(page, sel):
    return visible_count(page, sel) > 0


def open_details(page, scope):
    page.evaluate("s => document.querySelectorAll(s + ' details').forEach(d => { d.open = true; })", scope)


def app_data(page):
    return json.loads(page.evaluate("document.getElementById('app-data').textContent"))


def n_soes(ds):
    return len({r[ds["cols"].index("Entity")] for r in ds["data"]})


def load_via_simple(page, key, label, n, show_all=False):
    """Pick a built-in dataset in the Simple view's 'Try example data' fold; True when the table follows."""
    if not present(page, "#sv-data", "example-data fold"):
        return False
    open_details(page, "#sv-data")
    chip = page.locator("#sv-data :is(button, [role=button], label, a)").filter(has_text=re.compile(r"^\s*" + re.escape(label)))
    if chip.count() == 0:
        fail(f"cannot check dataset {label}: no '{label}' control inside #sv-data")
        return False
    chip.first.click()
    want = min(n, 12)
    try:
        page.wait_for_function("w => document.querySelectorAll('#sv-table tbody tr[data-soe]').length === w", arg=want, timeout=20000)
    except Exception:  # noqa: BLE001
        fail(f"{label}: expected {want} rows in #sv-table after loading, found "
             f"{page.locator('#sv-table tbody tr[data-soe]').count()}")
        return False
    if show_all and n > 12:
        btn = page.locator("#simple button").filter(has_text=re.compile(r"^\s*Show all"))
        if btn.count() == 0:
            fail(f"{label}: no 'Show all' toggle in #simple for {n} SOEs")
            return False
        btn.first.click()
        try:
            page.wait_for_function("w => document.querySelectorAll('#sv-table tbody tr[data-soe]').length === w", arg=n, timeout=10000)
        except Exception:  # noqa: BLE001
            fail(f"{label}: 'Show all' did not give {n} rows")
            return False
    return True


# ----------------------------------------------------------------------------------------------- 1
def t1_landing(browser):
    page = new_page(browser)
    ok = present(page, "#simple", "landing state")
    check(page.evaluate("document.body.dataset.mode") == "simple", "1 landing: body[data-mode] is not 'simple'")
    if not ok:
        return
    check(is_visible(page, "#simple"), "1 landing: #simple is not visible on load")
    check(not is_visible(page, "nav.tabs"), "1 landing: tab bar (nav.tabs) is visible in Simple view")
    for sec in ("#simple", "#soe"):
        n = page.locator(f"{sec} input[type=range]").count()
        check(n == 0, f"1 landing: {n} input[type=range] inside {sec} (rule 4)")
    n = page.locator("#simple :is(input:not([type=hidden]), select, textarea)").evaluate_all(
        "els => els.filter(e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden').length")
    check(n <= 8, f"1 landing: {n} visible input/select/textarea in #simple (max 8)")
    page.context.close()


# ----------------------------------------------------------------------------------------------- 2
def t2_totals(browser):
    for key, label in DATASETS:
        page = new_page(browser)
        if not present(page, "#modeSwitch", f"2 totals ({label})"):
            page.context.close()
            return
        n = n_soes(app_data(page)["datasets"][key])
        # switch dataset in the Analyst view's Home tab, as the design prescribes
        page.click("#modeSwitch")
        page.click("#t-home")
        chip = page.locator("#home .lp-chip").filter(has_text=re.compile(r"^\s*" + re.escape(label) + r"\s*$"))
        if chip.count() == 0:
            fail(f"2 totals ({label}): no Home chip '{label}'")
            page.context.close()
            continue
        chip.first.click()
        # Analyst references
        page.click("#t-efc")
        tile = page.locator("#efc .statstrip .tile .tile-value").first
        try:
            tile.wait_for(state="visible", timeout=15000)
            efc_money = money_text(tile.evaluate("e => e.childNodes[0].textContent"))
        except Exception:  # noqa: BLE001
            fail(f"2 totals ({label}): Expected Fiscal Cost tab first tile not found")
            efc_money = None
        page.click("#t-report")
        rows = page.locator("#report .card:has(h3:text-is('Stress by channel')) tbody tr")
        try:
            rows.first.wait_for(state="attached", timeout=20000)
        except Exception:  # noqa: BLE001
            pass
        rep = {}
        if rows.count() == len(REPORT_ORDER):
            for i, k in enumerate(REPORT_ORDER):
                rep[k] = money_text(rows.nth(i).locator("td").nth(4).text_content())
        else:
            fail(f"2 totals ({label}): Report 'Stress by channel' has {rows.count()} rows, expected {len(REPORT_ORDER)}")
        # back to the Simple view; same data
        page.click("#modeSwitch")
        if not (present(page, "#simple", f"2 totals ({label})") and is_visible(page, "#simple")):
            fail(f"2 totals ({label}): #modeSwitch from Analyst view did not show #simple")
            page.context.close()
            continue
        if page.locator("#sv-table").count() == 0:
            fail(f"cannot check 2 totals ({label}) in the Simple view: #sv-table missing")
            page.context.close()
            continue
        try:
            page.wait_for_function("w => document.querySelectorAll('#sv-table tbody tr[data-soe]').length === w",
                                   arg=min(n, 12), timeout=15000)
        except Exception:  # noqa: BLE001
            fail(f"2 totals ({label}): Simple table has {page.locator('#sv-table tbody tr[data-soe]').count()} rows "
                 f"after a dataset switch in the Analyst view, expected {min(n, 12)}")
        if n > 12:
            btn = page.locator("#simple button").filter(has_text=re.compile(r"^\s*Show all"))
            if btn.count():
                btn.first.click()
                page.wait_for_timeout(500)
            else:
                fail(f"2 totals ({label}): no 'Show all' toggle for {n} SOEs")
        # (a) now-total equals the sum of the now cells
        cells = [num(v) for v in page.locator("#sv-table tbody tr[data-soe] td[data-k=now]").evaluate_all(
            "els => els.map(e => e.getAttribute('data-v'))")]
        tot = num(attr(page, '#sv-table [data-k="now-total"]', "data-v"))
        if check(cells and None not in cells and tot is not None,
                 f"2 totals ({label}): now cells or now-total missing a data-v ({len(cells)} cells, total {tot})"):
            check(close(sum(cells), tot), f"2 totals ({label}): now-total {tot} != sum of rows {sum(cells)}")
            if n > 12:
                check(len(cells) == n, f"2 totals ({label}): {len(cells)} rows summed, expected all {n}")
        # (b) displayed now-total contains the Aggregate EFC tile's money string
        shown = text(page, '#sv-table [data-k="now-total"]')
        if efc_money:
            check(shown is not None and efc_money in re.sub(r"\s+", " ", shown),
                  f"2 totals ({label}): now-total shows {shown!r}, Expected Fiscal Cost tile shows {efc_money!r}")
        # (c) scenario cards vs Report 'Stress by channel'
        for k in CHANNEL_KEYS:
            card = page.locator(f'#sv-scen button[data-scen="{k}"] [data-k="total"]')
            if card.count() == 0:
                fail(f"2 totals ({label}): scenario card '{k}' or its [data-k=total] missing")
                continue
            got = re.sub(r"\s+", " ", card.first.text_content() or "")
            want = rep.get(k)
            if want:
                check(want in got, f"2 totals ({label}/{k}): card shows {got.strip()!r}, Report stressed EFC shows {want!r}")
        page.context.close()


# ----------------------------------------------------------------------------------------------- 3
def t3_sizes(browser):
    for key, label in DATASETS:
        page = new_page(browser)
        if not present(page, "#sv-scen", f"3 sizes ({label})"):
            page.context.close()
            return
        n = n_soes(app_data(page)["datasets"][key])
        if not load_via_simple(page, key, label, n):
            page.context.close()
            continue
        gdp_raw = num(attr(page, "#sv-gdp", "data-v"))
        for k in SCENARIOS:
            btn = page.locator(f'#sv-scen button[data-scen="{k}"]')
            if btn.count() == 0:
                fail(f"3 sizes ({label}/{k}): scenario card missing")
                continue
            btn.first.click()
            try:
                page.wait_for_function("k => document.querySelector(`#sv-sizes`)?.getAttribute('data-scen') === k", arg=k, timeout=SHORT)
            except Exception:  # noqa: BLE001
                fail(f"3 sizes ({label}/{k}): #sv-sizes[data-scen={k}] not reached")
                continue
            if k == "none":
                check(page.locator('#sv-sizes[data-empty="1"]').count() == 1, f"3 sizes ({label}/none): data-empty not set")
                check(page.locator("#sv-sizes [data-level]").count() == 0, f"3 sizes ({label}/none): a figure is shown")
                continue
            check(page.locator('#sv-sizes[data-empty="1"]').count() == 0, f"3 sizes ({label}/{k}): data-empty set")
            fut = num(attr(page, '#sv-table [data-k="fut-total"]', "data-v"))
            futg = num(attr(page, '#sv-table [data-k="fut-gdp"]', "data-v"))
            v = {lv: num(attr(page, f'#sv-sizes [data-level="{lv}"]', "data-v")) for lv in ("none", "mild", "standard", "severe")}
            if not check(None not in v.values() and fut is not None, f"3 sizes ({label}/{k}): missing data-v {v}, fut-total {fut}"):
                continue
            none_card = num(attr(page, '#sv-scen button[data-scen="none"] [data-k="total"]', "data-v"))
            check(close(v["standard"], fut), f"3 sizes ({label}/{k}): standard {v['standard']} != fut-total {fut}")
            check(close(v["none"], none_card), f"3 sizes ({label}/{k}): no-shock reference {v['none']} != none card {none_card}")
            check(all(v[lv] > 0 for lv in ("mild", "standard", "severe")), f"3 sizes ({label}/{k}): a size is not positive {v}")
            if futg is not None and fut:
                horizon_gdp = fut / futg
                for lv in ("none", "mild", "standard", "severe"):
                    g = num(attr(page, f'#sv-sizes [data-level="{lv}"]', "data-gdp"))
                    check(close(g, v[lv] / horizon_gdp, 1e-7), f"3 sizes ({label}/{k}/{lv}): data-gdp {g} != data-v / GDP at horizon")
            else:
                check(page.locator("#sv-sizes .sv-sz-gdp").count() == 0, f"3 sizes ({label}/{k}): % of GDP column shown without GDP")
            page.evaluate("document.querySelector('#sv-assume').open = true")
            lo = num(attr(page, '#sv-assume [data-k="state-lo"]', "data-v"))
            hi = num(attr(page, '#sv-assume [data-k="state-hi"]', "data-v"))
            if check(lo is not None and hi is not None, f"3 sizes ({label}/{k}): state-lo/hi missing"):
                # The State's-share range must follow the chosen scenario, and for the built-in data it contains the answer
                # (every sector's high share is above the share assumed; the low shares are below it for most of the cost).
                check(0 < lo <= fut * (1 + 1e-9) and fut <= hi * (1 + 1e-9), f"3 sizes ({label}/{k}): fut-total {fut} outside the State's-share range [{lo}, {hi}]")
        page.context.close()


# ----------------------------------------------------------------------------------------------- 4
def token_re(tok):
    flags = re.I if tok in CASE_INSENSITIVE else 0
    body = re.escape(tok) + ("s?" if tok == "percentile" else "")
    return re.compile(r"(?<![A-Za-z0-9])" + body + r"(?![A-Za-z0-9])", flags)


def t4_banned(browser):
    page = new_page(browser)
    if not present(page, "#simple", "4 banned labels"):
        return
    open_details(page, "#simple")
    page.wait_for_timeout(300)
    texts = {"#simple": page.evaluate("document.querySelector('#simple').innerText")}
    row = page.locator("#sv-table tbody tr[data-soe]").first
    if row.count() == 0:
        fail("cannot check 4 banned labels on #soe: no #sv-table row to open")
    else:
        row.click()
        if present(page, "#soe", "4 banned labels on #soe") and is_visible(page, "#soe"):
            open_details(page, "#soe")
            page.wait_for_timeout(300)
            texts["#soe"] = page.evaluate("document.querySelector('#soe').innerText")
        else:
            fail("4 banned labels: opening a row did not show #soe")
    for sel, t in texts.items():
        check(len(t.strip()) > 50, f"4 banned labels: {sel} has almost no text ({len(t.strip())} chars)")
        for tok in BANNED:
            m = token_re(tok).search(t)
            if m:
                ctx = t[max(0, m.start() - 30):m.end() + 30].replace("\n", " ")
                fail(f"4 banned labels: {tok!r} in visible text of {sel}: ...{ctx}...")
    page.context.close()


# ----------------------------------------------------------------------------------------------- 5
def t5_modes(browser):
    page = new_page(browser)
    if not present(page, "#modeSwitch", "5 mode switch"):
        page.context.close()
        return
    check(not is_visible(page, "#tabs button[role=tab]"), "5 modes: tab buttons visible in Simple view")
    check((text(page, "#modeSwitch") or "").strip() == "Analyst view", f"5 modes: #modeSwitch text in Simple view is {text(page, '#modeSwitch')!r}, expected 'Analyst view'")
    page.click("#modeSwitch")
    check(page.evaluate("document.body.dataset.mode") == "analyst", "5 modes: body[data-mode] not 'analyst' after #modeSwitch")
    check((text(page, "#modeSwitch") or "").strip() == "Simple view", f"5 modes: #modeSwitch text in Analyst view is {text(page, '#modeSwitch')!r}, expected 'Simple view'")
    labels = page.locator("#tabs button[role=tab]").evaluate_all(
        "els => els.filter(e => e.getClientRects().length > 0).map(e => e.textContent.trim())")
    check(labels == TABS, f"5 modes: visible tabs {labels}, expected {TABS}")
    for i, lab in enumerate(TABS):
        before = len(CTX["errors"])
        btn = page.locator("#tabs button[role=tab]").filter(has_text=re.compile(r"^\s*" + re.escape(lab) + r"\s*$"))
        if btn.count() == 0:
            fail(f"5 modes: tab '{lab}' missing")
            continue
        btn.first.click()
        page.wait_for_timeout(250)
        target = btn.first.get_attribute("aria-controls")
        body = page.evaluate("id => { const e = document.getElementById(id); return e && !e.hidden ? e.innerText.trim().length : -1; }", target)
        check(body > 20, f"5 modes: tab '{lab}' shows no content (page #{target}, text length {body})")
        check(len(CTX["errors"]) == before, f"5 modes: page error opening '{lab}': {CTX['errors'][before:]}")
    page.click("#modeSwitch")
    check(is_visible(page, "#simple") and page.evaluate("document.body.dataset.mode") == "simple",
          "5 modes: #modeSwitch from Analyst view did not return to #simple")
    page.context.close()
    # deep link
    page = new_page(browser, URL + "#view-efc")
    check(page.evaluate("document.body.dataset.mode") == "analyst", "5 modes: #view-efc did not open in analyst mode")
    check(is_visible(page, "#efc"), "5 modes: #view-efc did not show the Expected Fiscal Cost page")
    check(page.locator("#t-efc").get_attribute("aria-selected") == "true", "5 modes: #view-efc: tab 'Expected Fiscal Cost' not selected")
    if present(page, "#modeSwitch", "5 modes (deep link)"):
        page.click("#modeSwitch")
        check(is_visible(page, "#simple"), "5 modes: #modeSwitch after #view-efc did not return to #simple")
    page.context.close()


# ----------------------------------------------------------------------------------------------- 6
def t6_upload(browser):
    page = new_page(browser)
    if not present(page, "#sv-file", "6 upload"):
        page.context.close()
        return
    d = app_data(page)["datasets"]["demo"]
    cols = d["cols"]
    ent = cols.index("Entity")
    names = []
    for r in d["data"]:
        if r[ent] not in names:
            names.append(r[ent])
    keep = names[:2]
    rows = [r for r in d["data"] if r[ent] in keep]
    year = max(r[cols.index("Year")] for r in rows)
    growth = app_data(page)["meta"].get("gdp_growth")
    cfg = (ROOT / "config.py").read_text(encoding="utf-8")
    H = int(re.search(r"^MC_HORIZON_YEARS\s*=\s*(\d+)", cfg, re.M).group(1))
    if growth is None:
        growth = float(re.search(r"^DEFAULT_GDP_GROWTH\s*=\s*([\d.]+)", cfg, re.M).group(1))
    tmp = Path(tempfile.mkdtemp(prefix="svtest_")) / "senegal_two.csv"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols + ["Country"])
        for r in rows:
            w.writerow(["" if v is None else v for v in r] + ["Senegal"])
    GDP = 5.0e12
    asked = []

    def wb(route):
        q = parse_qs(urlparse(route.request.url).query)
        yr = (q.get("date") or [""])[0]
        asked.append((route.request.url, yr))
        body = [{"page": 1, "pages": 1, "per_page": 50, "total": 1, "sourceid": "2", "lastupdated": "2026-01-01"},
                [{"indicator": {"id": "NY.GDP.MKTP.CN", "value": "GDP (current LCU)"}, "country": {"id": "SN", "value": "Senegal"},
                  "countryiso3code": "SEN", "date": yr, "value": GDP, "unit": "", "obs_status": "", "decimal": 0}]]
        route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(body))

    page.route("**/api.worldbank.org/**", wb)
    page.set_input_files("#sv-file", str(tmp))
    try:
        page.wait_for_function("document.querySelector('#sv-gdp')?.getAttribute('data-v') > 0", timeout=15000)
    except Exception:  # noqa: BLE001
        fail(f"6 upload: #sv-gdp has no positive data-v after uploading a CSV with a Country column "
             f"(data-v={attr(page, '#sv-gdp', 'data-v')!r}, World Bank requests: {[a[0] for a in asked]})")
        page.context.close()
        return
    check(asked and all(y == str(year) for _, y in asked), f"6 upload: World Bank asked for years {[y for _, y in asked]}, latest year in the file is {year}")
    check(close(num(attr(page, "#sv-gdp", "data-v")), GDP), f"6 upload: #sv-gdp data-v {attr(page, '#sv-gdp', 'data-v')} != stubbed {GDP:g}")
    check(visible_count(page, "#sv-country") == 0, "6 upload: #sv-country select is shown although the file names the country")
    got = page.locator("#sv-table tbody tr[data-soe]").count()
    check(got == 2, f"6 upload: table has {got} rows after uploading 2 SOEs")
    fut = num(attr(page, '#sv-table [data-k="fut-total"]', "data-v"))
    share = num(attr(page, '#sv-table [data-k="fut-gdp"]', "data-v"))
    gdp_h = GDP * (1 + growth) ** H
    if check(fut is not None and share is not None, f"6 upload: fut-total {fut} or fut-gdp {share} has no data-v"):
        check(close(share, fut / gdp_h), f"6 upload: fut-gdp {share} != fut-total / GDP at horizon {fut / gdp_h} "
              f"(fut {fut}, GDP {GDP:g} x (1+{growth})^{H})")
    page.context.close()


# ----------------------------------------------------------------------------------------------- 7
def t7_soe(browser):
    page = new_page(browser)
    if not present(page, "#sv-scen", "7 one-SOE page"):
        page.context.close()
        return
    fx = page.locator('#sv-scen button[data-scen="fx"]')
    if fx.count() == 0:
        fail("7 one-SOE: scenario card 'fx' missing")
    else:
        fx.first.click()
        try:
            page.wait_for_function("document.querySelector('#sv-scen button[data-scen=fx]').getAttribute('aria-pressed') === 'true'", timeout=SHORT)
        except Exception:  # noqa: BLE001
            fail("7 one-SOE: fx card not aria-pressed after click")
        page.wait_for_timeout(300)
    rows = page.locator("#sv-table tbody tr[data-soe]")
    if not check(rows.count() >= 2, f"cannot check 7 one-SOE: #sv-table has {rows.count()} rows with data-soe"):
        page.context.close()
        return
    names = rows.evaluate_all("els => els.map(e => e.getAttribute('data-soe'))")
    fut = num(rows.first.locator('td[data-k="fut"]').get_attribute("data-v"))
    rows.first.click()
    if not (present(page, "#soe", "7 one-SOE") and is_visible(page, "#soe")):
        fail("7 one-SOE: clicking the first row did not show #soe")
        page.context.close()
        return
    check(not is_visible(page, "#simple"), "7 one-SOE: #simple still visible with #soe open")
    check(names[0] in (text(page, "#soe-title") or ""), f"7 one-SOE: #soe-title {text(page, '#soe-title')!r} lacks {names[0]!r}")
    cost = num(attr(page, '#soe-cost [data-scen="fx"]', "data-v"))
    if check(cost is not None and fut is not None, f"7 one-SOE: #soe-cost fx data-v {cost} or table fut {fut} missing"):
        check(close(cost, fut), f"7 one-SOE: #soe-cost fx {cost} != table fut {fut}")
    for sel in ("#soe-next", "#soe-prev", "#soe-back"):
        if page.locator(sel).count() == 0:
            fail(f"cannot check 7 one-SOE navigation: {sel} missing")
            page.context.close()
            return
    page.click("#soe-next")
    check(names[1] in (text(page, "#soe-title") or ""), f"7 one-SOE: after Next, #soe-title {text(page, '#soe-title')!r} lacks {names[1]!r}")
    page.click("#soe-prev")
    check(names[0] in (text(page, "#soe-title") or ""), f"7 one-SOE: after Next, Previous, #soe-title {text(page, '#soe-title')!r} lacks {names[0]!r}")
    page.click("#soe-next")
    check(names[1] in (text(page, "#soe-title") or ""), f"7 one-SOE: Next from the first SOE does not move to the second row's SOE {names[1]!r}")
    page.click("#soe-back")
    check(is_visible(page, "#simple") and not is_visible(page, "#soe"), "7 one-SOE: #soe-back did not return to #simple")
    page.context.close()


def main():
    if not HTML.exists():
        print(f"FAIL: {HTML} not found (python report.py --demo --allow-download --out SOE-Fiscal-Risk-Final.html)")
        return 1
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for fn in (t1_landing, t2_totals, t3_sizes, t4_banned, t5_modes, t6_upload, t7_soe):
            try:
                fn(browser)
            except Exception as e:  # noqa: BLE001 - a broken test must not hide the others
                fail(f"{fn.__name__}: test aborted with {type(e).__name__}: {str(e).splitlines()[0][:200]}")
        browser.close()
    for e in CTX["errors"]:
        fail(f"page error: {e}")
    if FAILS:
        print(f"FAIL: {len(FAILS)} of {CHECKS} checks failed")
        for f in FAILS:
            print("  -", f)
        return 1
    print(f"OK: {CHECKS} Simple-view checks passed (landing, totals vs Analyst view, sizes, banned labels, modes, upload GDP, one-SOE page)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
