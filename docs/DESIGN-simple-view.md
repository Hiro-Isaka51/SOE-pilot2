# Simple view: design and contract

17 November 2026. Base: `origin/main` `1de6f6a`. Branch `feature/simple-view`.

## Why

The tool's user is a country economist with little finance background. Today the tool shows 8 tabs, 9 sub-views, about 73 controls on arrival and about 125 one click away. The economist cannot judge most of them. The Simple view answers the four Home questions with no slider and at most five decisions (file, country, scenario, which SOE to open, mode). Everything that exists today stays, unchanged, behind an Analyst view switch.

## Hard rules

1. No formula, calibration or default changes. `templates/engine.js`, `shocks.py`, `calculations.py` are not edited.
2. The Analyst view (the existing pages) is not edited. Changes to `templates/app.js` are limited to the hooks in "Plumbing" below.
3. Simple-view numbers come from the same functions and state as Home, Report and Early Warning: `stressAll`, `CHANNELS()`, `evalTriggers`, `E.efcRow`, and `S.efc.lgd`, `S.efc.ead`, `S.efc.basis`, `S.gdp`, `S.growth`. No number is typed into the Simple view.
4. Simple view contains no `input[type=range]`, no method choice, no sector-specific panel.
5. These labels never appear in Simple-view text: `PD`, `LGD`, `EAD`, `EFC`, `Z″`, `Z-EM`, `X1`–`X4`, `bps`, `s.d.`, `std. dev.`, `Monte Carlo`, `P5`/`P95`, `percentile`. Use the plain words in "Copy" below.
6. Open team decisions are not settled here: zone cut-offs, the definition of the default probability, the term "distress score", the loss-share convention. Values and names come from config as they stand.
7. New code goes in `templates/simple.js` and `templates/simple.css`. Never hand-edit `SOE-Fiscal-Risk-Final.html`; rebuild it with `python report.py --demo --allow-download --out SOE-Fiscal-Risk-Final.html`.

## Plumbing

- `report.py`: inline `templates/simple.js` at `/*__SIMPLE_JS__*/` in `app.js` (same way as `explainer.js`), and `templates/simple.css` at `/*__SIMPLE_CSS__*/` at the end of `app.css`.
- `templates/app.js`: the `/*__SIMPLE_JS__*/` marker sits after `pages.report` and `CHANNELS` are defined and before the boot section, inside the closure.
- `templates/app.html`: `<section class="page" id="simple" hidden>` and `<section class="page" id="soe" hidden>` in `<main>`; a button `#modeSwitch` in the header band, left of `#bandUpload`.
- Mode: `const SIMPLE_TABS = new Set(["simple", "soe"])`. In `showTab(id)`: `document.body.dataset.mode = SIMPLE_TABS.has(id) ? "simple" : "analyst"`; remember the last analyst tab in `S.lastAnalyst`.
- `#modeSwitch`: in simple mode its text is `Analyst view` and it opens `S.lastAnalyst || "home"`; in analyst mode its text is `Simple view` and it opens `simple`.
- CSS (in `simple.css`): `body[data-mode="simple"] nav.tabs, body[data-mode="simple"] #filterbar, body[data-mode="simple"] #bandUpload { display: none }`.
- Start page: `simple`, unless the URL hash names an existing page (so `#view-efc` still opens the Analyst view).
- `initPageState()` adds `S.simple = { scen: "none", soe: null, all: false, range: {}, open: {} }` (reset on every dataset load, which clears the range cache).
- After an upload or a built-in dataset switch made from the Simple view, the user stays in the Simple view.
- `#view-soe` with no SOE chosen opens the SOE with the largest cost now.

## Data layer (`templates/simple.js`, section A, written by the main session)

```
SV.scenarios()            -> [{ key, mags, name, size }]            // "none" + the seven CHANNELS() entries
SV.run(key)               -> { key, H, year, items: [{ r, now, fut, zoneNow, zoneFut, drop }], nowTotal, futTotal, gdpFut }
SV.totals()               -> { key: futTotal }                       // for the scenario cards
SV.sizes(key)             -> { key, none, name, year, gdpH, base: { total, gdp, by }, levels: [{ level: 'mild'|'standard'|'severe', label, size, total, gdp, by }] }
SV.stateRange(key)        -> { share, lo, hi, loGdp, hiGdp, by: { entity: { lo, hi, share: [lo, hi] } }, above: [names] }
SV.assumptions()          -> [{ label, value, changed }]
SV.changed()              -> number of settings that differ from their defaults
SV.warnings()             -> { by, hits }                           // evalTriggers on the latest accounts with the standard stress, as Early Warning does
```

- `now` = `E.efcRow(r, S.efc.lgd, S.efc.ead, S.efc.basis).EFC` (equals the Expected Fiscal Cost tab).
- `fut` = last year of `stressAll(allRows(), mags, expoFor, D, H, S.efc.lgd, S.gdp, S.growth, S.efc.ead)` with `D = CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years`, `H = CFG.MC_HORIZON_YEARS` (equals Report › Stress by channel). For `none`, `fut` is the no-shock path.
- Sizes = the chosen scenario re-run with `standardStress` at the milder and the more severe size of the tool's own guide (`CFG.SHOCK_TYPES[].guide`), next to the size assumed and to no shock. Refinancing has no guide; it takes the interest-rate guide's proportions (half and twice its standard size). No likelihood is attached to a size. For `none` there is nothing to vary.
- State range = each SOE's `fut` scaled to its sector's low and high share from `E.recoveryScenarios(sector)` (first and last entries). It is doubt about an assumption, not about the scenario, so it is shown with the assumptions. For some sectors the low share is above the share assumed (`above` lists those SOEs); say so in one plain line.

## DOM contract (tests rely on it)

Every figure cell carries `data-v` with the raw number: money in the tool's internal units (the value passed to `money()`), shares as fractions (`fut-gdp`), and `#sv-gdp` as GDP in full currency units. `tr[data-soe]` holds the SOE's name. 

Overview, `section#simple`:

| Element | Selector |
|---|---|
| Data strip | `#sv-data`; file input `#sv-file`; summary text `#sv-summary`; country select `#sv-country` (absent when the file names the country); GDP line `#sv-gdp` (`data-v` = GDP or empty) |
| Scenario cards | `#sv-scen button[data-scen]`, `aria-pressed`, each with a child `[data-k="total"][data-v]` |
| Answer table | `#sv-table`; rows `tbody tr[data-soe]`; cells `td[data-k="now"]`, `td[data-k="fut"]`, `td[data-k="warn"]`; footer `[data-k="now-total"]`, `[data-k="fut-total"]`, `[data-k="fut-gdp"]` |
| Sizes block | `#sv-sizes[data-scen]`; `data-empty="1"` when the scenario is `none`; otherwise a reference `[data-level="none"]` and three rows `[data-level="mild"]`, `[data-level="standard"]`, `[data-level="severe"]`, each with `data-v` (cost) and `data-gdp` (share of GDP, empty without GDP) |
| Assumptions | `details#sv-assume`; chip `#sv-changed` (hidden when 0); inside it `[data-k="state-lo"]` and `[data-k="state-hi"]` with `data-v` |

One SOE, `section#soe`: `#soe-title`, `#soe-back`, `#soe-prev`, `#soe-next`, and blocks `#soe-verdict`, `#soe-health`, `#soe-ratios`, `#soe-cost` (rows `[data-scen][data-v]`), `#soe-sizes` (same attributes as `#sv-sizes`, for this SOE), `#soe-state` (`[data-k="state-lo"]`, `[data-k="state-hi"]`), `#soe-actions`, `#soe-links`.

## Screens

### Overview

1. **Your data.** One line: dataset label, number of SOEs, years, currency. Button "Upload your file" (reuses `readUpload()` and its messages), link "Download the template". A closed fold "Try example data" holds the built-in datasets. Country: taken from the file's `Country` column when present; otherwise one select. GDP is looked up with the existing World Bank routine for the latest year in the data, in the statements' currency. A typed GDP box appears only when the lookup fails.
2. **Scenario.** Eight cards in one group. Each shows its name, its size, and the portfolio cost by the horizon year, so the choice is a comparison. Default `none`.
3. **Answer.** Table sorted by `fut`, largest first; the existing 12-row limit and "show all" toggle apply. Columns: SOE (name, sector) · Health now (zone chip and `distressWhy`) · Cost to the budget now · Cost by <year> under the chosen scenario (amount, change against now, zone chip at the horizon) · Warnings (level chip and number of rules). Footer: totals and % of GDP. A row opens the One-SOE page. Copy / CSV via `dataButtons()`.
4. **What if the shock is smaller or bigger?** For the chosen scenario: the cost at the horizon at the milder size, the size assumed and the more severe size, as three horizontal bars on one scale from zero, with a reference line at the no-shock cost. Each row gives its size in words, the cost, the share of GDP and the change against no shock. The row "As assumed" is the answer above and is marked as such. With `none` chosen the block says there is nothing to vary.
5. **Assumptions behind these numbers.** Closed fold, read-only list, with a link to the Analyst view. A chip says how many settings differ from their defaults. Under the State's-share row: the cost at the horizon if the State bore the low or the high share for each SOE's sector, in money and % of GDP.
6. Links: "How this works" (opens the How it works page), "Analyst view".

### One SOE

Previous / Next (same order as the table) and Back. No other picker.

1. Verdict sentence.
2. Four health checks: the tool's plain names (`HEALTH`), each with its weighted contribution to the score, a good/weak mark, and the score's history by year.
3. Health ratios: `CFG.REPORT_HEADLINE_KPIS` available for this SOE: latest value, status (`kpiStatus`), cut-off (`cutText`), small trend line.
4. What it could cost the budget: now, then one bar per scenario with the selected one marked; then the same three-sizes block for this SOE under the selected scenario, and one line with this SOE's cost at the low and high State share.
5. What to do: the rules this SOE fires (level chip, short name, follow-up steps). The rule's `condition` text is not shown (it carries technical labels).
6. Look closer in Analyst view: Shock Scenarios (opens it for this SOE as the Early Warning button does), KPI Dashboard, Distress Indicator.

## Copy

Sizes in `{}` are read from config and formatted; nothing is typed.

| Key | Name | Size line |
|---|---|---|
| `none` | No shock | the accounts rolled forward {H} years, nothing going wrong |
| `combined` | All six at once | the standard stress: every shock below, together |
| `fuel` | Fuel price rises | by {25}% |
| `fx` | Currency falls | by {30}% |
| `rate` | Interest rates rise | by {2.0} percentage points |
| `revenue` | Revenue falls | as in a bad year of each SOE's own record |
| `refi` | Refinancing costs more | {1.5} percentage points more on debt coming due |
| `arrears` | The State pays late | unpaid bills worth {5}% of revenue a year |

Under the cards: "Each shock lasts {D} years. Costs are shown for {year}, {H} years after the latest accounts."

Headings and labels:

- Page title: "What could your SOEs cost the budget?" Lead: "Load the accounts, pick a scenario, read the answer. A first screen, not a forecast."
- Section titles: "Your data", "Scenario", "Answer", "What if the shock is smaller or bigger?", "Assumptions behind these numbers".
- Table heads: "SOE", "Health now", "Cost to the budget now", "Cost by {year}: {scenario name}", "Warnings".
- Under "Cost to the budget now": "expected fiscal cost, from the latest accounts".
- Footer: "All SOEs", and "{x}% of GDP" or, with no GDP, "choose a country to see the share of GDP".
- Sizes block. Lead: "The answer assumes: {scenario name} {size}. This is the cost by {year} if the shock turns out milder or more severe." Row labels: "Milder", "As assumed" (tagged "the answer"), "More severe"; reference line: "No shock". Each row: "{money}", "{x}% of GDP", "{n}% more than no shock" / "{n}% less than no shock" / "about the same as no shock". Legend: "cost with no shock", "added by the shock". Note: "Milder and more severe are the tool's own guide sizes for this shock. They show how much the answer depends on the size of the shock, not how likely each size is." With no shock chosen: "No shock is chosen, so there is nothing to make smaller or bigger. Pick a scenario above to see how its size changes the answer." State's share (in the assumptions, under its row): "If the State bore the low or the high share for each SOE's sector (from past defaults on public loans), the cost by {year} would be between {lo} and {hi} ({x}% to {y}% of GDP)." and, when it applies, "For {n} of {m} SOEs the low figure for their sector is above the {70}% assumed."
- Assumption rows: "Share of the loss the State bears: {70}%, the same for every SOE" · "Debt at stake: {100}% of total liabilities" (or "government-guaranteed debt where reported") · "Years projected ahead: {H}; each shock lasts {D} years" · "Chance of distress: read from the indicative rating that goes with the distress score" · "Shock sizes: fuel {..}, currency {..}, interest rates {..}, refinancing {..}, revenue {..}, State arrears {..}" · "Exposure to each shock: from the SOE's own file where it has the figures, otherwise the sector default ({k} of {n} SOEs use at least one default)". Closing line: "These can be changed in the Analyst view. Changes made there show here."
- Chip: "{n} changed in Analyst view".
- One-SOE verdict: "{SOE} is in the {zone} zone, {why}. Its indicative rating is {rating}." Block titles: "Four health checks", "Health ratios", "What it could cost the budget", "What to do", "Look closer in Analyst view".
- Mode button: "Analyst view" / "Simple view".

## Tests (`tests/check_simple_view.py`)

Playwright against the built HTML; exits 0 with a "skipped" line when Playwright is not installed.

1. Loads in Simple view: `body[data-mode="simple"]`, tab bar not visible, 0 `input[type=range]` inside `#simple` and `#soe`, at most 8 `input, select, textarea` visible in `#simple`.
2. For each built-in dataset: `now-total` equals the sum of the `now` cells and equals the Expected Fiscal Cost tab's "Aggregate EFC" tile text when formatted the same way; for each scenario key except `none`, the card total equals the Report's Stress-by-channel figure for that channel (compare displayed text).
3. For each built-in dataset and scenario except `none`: the `standard` row's `data-v` equals `fut-total`; the `none` reference equals the `none` card's total; `mild`, `standard`, `severe` are all present with positive `data-v`; with GDP set, each `data-gdp` equals `data-v / GDP at the horizon`. For `none`: `#sv-sizes[data-empty="1"]`. In the assumptions fold: `state-lo ≤ fut-total ≤ state-hi`.
4. None of the banned labels appears in the visible text of `#simple` or `#soe`.
5. `#modeSwitch` shows the 8 tabs; each of the 8 tabs opens with no page error; loading `#view-efc` opens the Analyst view; switching back returns to the Simple view.
6. A CSV with the required columns and a `Country` column fills `#sv-gdp` with no further input (World Bank call stubbed with a fixed value) and `fut-gdp` then equals `fut-total / GDP at the horizon`.
7. Opening a table row shows `#soe` for that SOE; Previous/Next walk the table order; its `#soe-cost` value for the selected scenario equals the table's `fut` cell.

## Not in this build

Findings for the repository owner, reported in `NOTE_for_Hyunju.md`, not changed here: loss share and exposure stored twice (`S.efc.*`, `S.sh.*`); Monte Carlo uses a different curve from every headline; default loss share below every sector average in the reference table; utility panels shown for every sector; GDP blank by default; Government Support and `classic.py` unreachable from the live site; Portfolio macro shock has no fuel or currency shock.
