# Simple view in front of the existing tabs (November 2026)

Base: `1de6f6a`. Design and contract: `docs/DESIGN-simple-view.md`.

## Problem

The tool's user is a country economist with little finance background. On `1de6f6a` the tool has 8 tabs and 9 sub-views, about 73 controls visible on arrival and about 125 one click away (about 80 of them in Shock Scenarios). The tabs follow the method (ratios, score, cost, shocks, warnings), and each asks the user to set that method's parameters. The economist's question is about the country: which SOEs are in trouble, what could they cost the budget, what if a shock hits, what needs action.

## Change

The tool now opens in a **Simple view** with two screens. The existing tabs are unchanged and one click away behind **Analyst view** (header button). No formula, calibration or default changed; `templates/engine.js`, `shocks.py` and `calculations.py` are untouched.

**Overview** (`pages.simple`): four numbered steps.

1. *Your data.* Upload (same reader and messages as Home), template, built-in examples in a fold. The country comes from the file's `Country` column, or one drop-down; GDP is then looked up and shared with the Analyst tabs.
2. *Scenario.* Eight cards: no shock, the six standard shocks one at a time, and all six together. Sizes are the standard-stress sizes in `config.DEFAULT_SHOCK_PARAMS`. Each card already shows the portfolio cost under it.
3. *Answer.* One sentence with the portfolio cost at the horizon and its share of GDP, then a table: health now, cost now, cost at the horizon under the chosen scenario, warnings. A row opens the One-SOE screen.
4. *What if the shock is smaller or bigger?* The chosen scenario at the milder size, the size assumed and the more severe size of the tool's own guide (`SHOCK_TYPES[].guide`), as three bars on one scale against the no-shock cost, in money and % of GDP. It follows the scenario card; with no shock chosen there is nothing to vary.

Under them, a read-only fold lists the assumptions behind the numbers and says how many were changed in the Analyst view. The doubt about the State's share of the loss sits there, under that assumption: the cost if the State bore the low or the high share for each SOE's sector.

**One SOE** (`pages.soe`): the verdict in one sentence, the four health checks in plain words with the score's history, the headline ratios, the cost under every scenario with the same three-sizes view and the State's-share range for that SOE, the warnings that fire with their follow-up steps, and links into the Analyst tabs for that SOE.

Simple view has no slider and no method choice: one drop-down (country), the scenario cards, and the upload.

## Where the numbers come from

Simple view calls what the Analyst view already uses, so the two cannot disagree:

| Figure | Source |
|---|---|
| Cost now | `E.efcRow` with `S.efc.*`: equals the Expected Fiscal Cost tab |
| Cost at the horizon, by scenario | `standardStress(allRows(), mags)` with the `CHANNELS()` magnitudes: equals Report › Stress by channel |
| Warnings | `evalTriggers` with the standard stress: equals Early Warning |
| Smaller or bigger shock | `standardStress` again with the scenario's shocks at the guide's `mild` and `severe` sizes (refinancing, which has no guide, at half and twice its standard size, the interest-rate guide's proportions) |
| State's share, low to high | each SOE's cost scaled to the low and high figures of `E.recoveryScenarios(sector)` |

The three sizes carry no likelihood. A first version of step 4 showed a simulated range from `E.monteCarlo`; it was dropped because the default spreads vary only fuel prices and the currency (both marked placeholder in the parameter register), so the range did not follow the scenario chosen.

Because the cost is read from rating steps, some rows barely move (demo, "The State pays late": 96.6, 96.7, 96.7, 105.3 bn at no shock, milder, assumed, more severe). The block says so in one line, so that a flat row is not read as a harmless shock.

## Files

- New: `templates/simple.js` (data layer `SV`, the two pages), `templates/simple.css`, `tests/check_simple_view.py`, `docs/DESIGN-simple-view.md`.
- `report.py`: inlines the two new templates at `/*__SIMPLE_JS__*/` and `/*__SIMPLE_CSS__*/`.
- `templates/app.js`: start page is `simple`; `showTab()` sets `body[data-mode]`; `#modeSwitch`; `S.simple` in `initPageState()`; an upload made in the Simple view stays there; the World Bank request moved out of `gdpField()` into `gdpFetch()` so both views share it (behaviour unchanged).
- `templates/app.html`: two sections and the mode button. `templates/app.css`: the marker line. `config.py` is unchanged.
- `SOE-Fiscal-Risk-Final.html` rebuilt with `python report.py --demo --allow-download --out SOE-Fiscal-Risk-Final.html`.

Deep links are unchanged: `#view-efc` and the other tab links open the Analyst view.

## Checks

- `tests/check_simple_view.py` (Playwright; prints SKIPPED and exits 0 without it): 254 checks. Landing state; totals equal to the Expected Fiscal Cost tile and to Report › Stress by channel for the three built-in datasets; the three sizes, their shares of GDP and the State's-share range for every dataset and scenario; no technical label in Simple-view text; the eight tabs open with no page error; a file with a `Country` column fills GDP with no further input; the One-SOE screen.
- The 15 existing `tests/check_*.py` pass, including parity (64,173 checks) and the snapshot check.
- Analyst view, demo data, 1440 px: Home, KPI Dashboard, Distress Indicator, Shock Scenarios, Early Warning and Report are pixel-identical to `1de6f6a`. Expected Fiscal Cost differs in 29 pixels by at most 2 of 255 beside the country drop-down.

## Not verified

- A live World Bank request (the tests stub it), an Excel upload and drag-and-drop in the Simple view.
- A screen reader. Controls are native buttons, one select and `<details>`.
- The page inside the Streamlit frame on the deployed site.

## Left as they are (for the owner to decide)

1. Loss share and exposure are stored twice (`S.efc.*` and `S.sh.*`), so the Expected Fiscal Cost and Shock tabs can show different costs for the same SOE. Simple view reads `S.efc.*`, as Home, Report and Early Warning do.
2. Monte Carlo uses a different curve from every headline figure. On the four built-in datasets and eight scenarios its 5th–95th percentile range never contains the single-run cost; the middle of that range is 1.5 to 2.4 times it. The single-run figures move in rating steps (see above); the smooth curve would move at every size but would roughly double every headline.
3. The default loss share (70%) is below every sector average in `SECTOR_RECOVERY_DATA` (80–93%); for Transport and Industry it is below the low figure (81%). Simple view says so with the assumptions.
4. The payment-priority, power-producer and tariff panels show for every sector.
5. GDP is blank until a country is chosen; the built-in data has no `Country` column.
6. Government Support cannot be reached inside the Streamlit frame; `classic.py` is not served.
7. Portfolio macro shock has no fuel or currency shock.
