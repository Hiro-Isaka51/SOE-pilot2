  /* =====================================================================
     SIMPLE VIEW — the default, plain-language view (overview + one SOE)
     Inlined into app.js at the SIMPLE_JS marker, INSIDE the app's closure: it uses the helpers
     defined above (el, pageHead, stressAll, CHANNELS, E, CFG, S, showTab ...). No IIFE, no imports.
     See docs/DESIGN-simple-view.md for the rules and the DOM contract.
     ===================================================================== */

  /* ===== SIMPLE VIEW · A · data layer ===== */
  // Every figure in the Simple view comes from the functions and state the Analyst view already uses
  // (standardStress, CHANNELS, evalTriggers, E.efcRow, S.efc.*, S.gdp, S.growth), so it cannot disagree with
  // Home, Report or Early Warning. Nothing is typed in here: shock sizes and spreads are read from CFG.
  const SV = {};
  SV.H = () => CFG.MC_HORIZON_YEARS;
  SV.D = () => CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years;
  const svPts = (bps) => fmt(bps / 100, Number.isInteger(bps / 10) ? 1 : 2); // basis points → percentage points
  /** plain name and size line of each scenario; sizes are formatted from the magnitudes, never typed */
  SV.COPY = {
    none: ["No shock", () => `the accounts rolled forward ${SV.H()} years, nothing going wrong`],
    combined: ["All six at once", () => "the standard stress: every shock below, together"],
    fuel: ["Fuel price rises", (m) => `by ${fmt(m.fuel_shock_pct * 100, 0)}%`],
    fx: ["Currency falls", (m) => `by ${fmt(m.fx_shock_pct * 100, 0)}%`],
    rate: ["Interest rates rise", (m) => `by ${svPts(m.rate_shock_bps)} percentage points`],
    revenue: ["Revenue falls", (m) => { const k = Math.abs(m.revenue_shock_std_devs), y = "a bad year of each SOE's own record"; return k === 1 ? `as in ${y}` : k === 0.5 ? `half as much as in ${y}` : k === 2 ? `twice as much as in ${y}` : `${fmt(k, 1)} times as much as in ${y}`; }],
    refi: ["Refinancing costs more", (m) => `${svPts(m.refinancing_spread_bps)} percentage points more on debt coming due`],
    arrears: ["The State pays late", (m) => `unpaid bills worth ${fmt(m.arrears_pct_of_revenue * 100, 0)}% of revenue a year`],
  };
  /** "none" plus the Report's stress channels (CHANNELS), in the Report's order */
  SV.scenarios = () => [["none", "No shock", ZERO_MAG], ...CHANNELS()].map(([key, label, mags]) => {
    const c = SV.COPY[key] || [label, () => ""];
    return { key, mags, name: c[0], size: c[1](mags) };
  });
  /** the settings the results depend on; when one changes, cached runs and ranges are dropped */
  SV.sig = () => [S.efc.lgd, S.efc.ead, S.efc.basis, S.efc.mode, JSON.stringify(S.efc.per || {}), S.gdp || "", S.growth].join("|");
  SV.cache = () => { const c = S.simple; if (c.sig !== SV.sig()) { c.sig = SV.sig(); c.runs = {}; c.sizes = {}; c.warn = null; } return c; };
  /** loss share behind "cost now": as the Expected Fiscal Cost tab and the Report apply it */
  SV.lgdNow = (r) => (S.efc.mode === "per" ? S.efc.per[r.Entity] ?? S.efc.lgd : S.efc.lgd);
  /** every SOE under one scenario: cost now (latest accounts) and cost at the horizon, largest first */
  SV.run = (key) => {
    const c = SV.cache();
    if (c.runs[key]) return c.runs[key];
    const all = SV.scenarios(), sc = all.find((s) => s.key === key) || all[0];
    const res = standardStress(allRows(), sc.mags); // the same call as Home, Report and Early Warning
    const items = res.map((x) => {
      const f = last(x.str);
      return { r: x.row, name: x.row.Entity, now: E.efcRow(x.row, SV.lgdNow(x.row), S.efc.ead, S.efc.basis).EFC, fut: f.EFC,
        zoneNow: x.row.Zone, zoneFut: f.Zone, drop: x.drop, x };
    }).sort((a, b) => (b.fut || 0) - (a.fut || 0) || String(a.name).localeCompare(String(b.name)));
    const years = uniq(res.map((x) => last(x.str)["Calendar Year"])), f0 = res.length ? last(res[0].str) : null;
    const out = { key: sc.key, name: sc.name, size: sc.size, mags: sc.mags, H: SV.H(), D: SV.D(), items,
      year: years.length === 1 ? years[0] : null, // SOEs whose latest accounts differ end in different years
      gdpH: f0 && ok(f0.GDP) ? f0.GDP : null,
      nowTotal: sum(items.map((i) => i.now)), futTotal: sum(items.map((i) => i.fut)) };
    out.nowGdp = S.gdp ? out.nowTotal / S.gdp : null;
    out.futGdp = out.gdpH ? out.futTotal / out.gdpH : null;
    return (c.runs[key] = out);
  };
  /** portfolio cost at the horizon under each scenario, for the scenario cards */
  SV.totals = () => Object.fromEntries(SV.scenarios().map((s) => [s.key, SV.run(s.key).futTotal]));
  /** the tool's own size guide for each shock (config.SHOCK_TYPES[].guide: mild / standard / severe), by magnitude key.
      Refinancing has no guide of its own; in the Analyst view it sits under "Interest rates", so it takes that
      guide's proportions around its standard size. */
  SV.guide = () => {
    const g = {};
    (CFG.SHOCK_TYPES || []).forEach((t) => { if (t.guide && t.key) g[t.key] = t.guide; });
    const r = g.rate_shock_bps, s = STD_MAG.refinancing_spread_bps;
    if (r && r.standard && ok(s) && !g.refinancing_spread_bps) g.refinancing_spread_bps = { mild: (s * r.mild) / r.standard, standard: s, severe: (s * r.severe) / r.standard };
    return g;
  };
  SV.LEVELS = [["mild", "Milder"], ["standard", "As assumed"], ["severe", "More severe"]];
  /** a scenario's magnitudes at another level of the size guide: every shock the scenario switches on moves to that level */
  SV.magsAt = (mags, level) => {
    const g = SV.guide(), out = Object.assign({}, mags);
    Object.keys(g).forEach((k) => { if (mags[k] && ok(g[k][level])) out[k] = g[k][level]; });
    return out;
  };
  SV.sizeText = (key, mags, level) => (key === "combined"
    ? { mild: "every shock at its milder size", standard: "every shock at the size assumed", severe: "every shock at its more severe size" }[level]
    : (SV.COPY[key] || [key, () => ""])[1](mags));
  /** What if the shock is smaller or bigger? The chosen scenario at the milder and the more severe size of the tool's
      guide, next to the size assumed and to no shock. Same call as every other figure (standardStress); no likelihoods.
      For "none" there is nothing to vary. by = cost at the horizon for each SOE. */
  SV.sizes = (key) => {
    const c = SV.cache();
    if (c.sizes[key]) return c.sizes[key];
    const run = SV.run(key), b = SV.run("none");
    const base = { total: b.futTotal, gdp: b.futGdp, by: Object.fromEntries(b.items.map((i) => [i.name, i.fut])) };
    if (run.key === "none") return (c.sizes[key] = { key: run.key, none: true, base, gdpH: run.gdpH, year: run.year, levels: [] });
    const levels = SV.LEVELS.map(([level, label]) => {
      const mags = level === "standard" ? run.mags : SV.magsAt(run.mags, level);
      const by = level === "standard" ? Object.fromEntries(run.items.map((i) => [i.name, i.fut]))
        : Object.fromEntries(standardStress(allRows(), mags).map((x) => [x.row.Entity, last(x.str).EFC]));
      const total = sum(Object.values(by));
      return { level, label, mags, size: SV.sizeText(run.key, mags, level), by, total, gdp: run.gdpH ? total / run.gdpH : null };
    });
    return (c.sizes[key] = { key: run.key, none: false, name: run.name, base, gdpH: run.gdpH, year: run.year, levels });
  };
  /** low and high share of the loss the State bears for a sector: the ends of the reference table the
      Expected Fiscal Cost tab shows (E.recoveryScenarios) */
  SV.stateShare = (sector) => { const sc = E.recoveryScenarios(sector); return [sc[0][1], sc[sc.length - 1][1]]; };
  /** the cost at the horizon if the State bore the low or the high share for each SOE's sector, not the share assumed.
      above = SOEs whose sector's low figure is higher than the share assumed (their own range starts above their cost). */
  SV.stateRange = (key) => {
    const run = SV.run(key), k = S.efc.lgd / 100, by = {};
    run.items.forEach((it) => { const [lo, hi] = SV.stateShare(it.r.Sector); by[it.name] = { lo: (it.fut * lo) / k, hi: (it.fut * hi) / k, share: [lo, hi] }; });
    const lo = sum(run.items.map((it) => by[it.name].lo)), hi = sum(run.items.map((it) => by[it.name].hi));
    return { key: run.key, share: k, lo, hi, loGdp: run.gdpH ? lo / run.gdpH : null, hiGdp: run.gdpH ? hi / run.gdpH : null, gdpH: run.gdpH, by,
      above: run.items.filter((it) => by[it.name].share[0] > k).map((it) => it.name) };
  };
  /** warnings as the Early Warning tab evaluates them: latest accounts, with the standard stress for the stress rule */
  SV.warnings = () => {
    const c = SV.cache();
    if (c.warn) return c.warn;
    const rows = latestOf(allRows()), stress = Object.fromEntries(SV.run("combined").items.map((i) => [i.name, i.x]));
    return (c.warn = evalTriggers(rows, stress));
  };
  /** SOEs for which at least one exposure share is a default, not a figure from their own file */
  SV.exposureDefaults = () => {
    const names = ["fuel_cost_share", "fx_cost_share", "fx_revenue_share", "fx_debt_share", "floating_debt_share", "near_term_maturity_share"];
    const rows = latestOf(allRows());
    return { n: rows.length, k: rows.filter((r) => { const e = E.soeExposures(r); return names.some((nm) => e[nm] && !/^(Observed|Derived)/.test(e[nm][1])); }).length };
  };
  SV.defaults = () => ({ lgd: M.lgd_pct ?? CFG.LGD_SLIDER_DEFAULT, ead: CFG.EAD_SHARE_DEFAULT, basis: "total_liabilities", mode: "single", growth: M.gdp_growth ?? CFG.DEFAULT_GDP_GROWTH });
  /** the read-only list under "Assumptions behind these numbers"; changed = differs from the tool's default */
  SV.assumptions = () => {
    const d = SV.defaults(), m = STD_MAG, ex = SV.exposureDefaults(), pc = (v) => fmt(v * 100, 0) + "%";
    return [
      { label: "Share of the loss the State bears", changed: S.efc.lgd !== d.lgd || S.efc.mode !== d.mode,
        value: S.efc.mode === "per" ? `set SOE by SOE for the cost now; ${fmt(S.efc.lgd, 0)}% for the scenarios` : `${fmt(S.efc.lgd, 0)}%, the same for every SOE` },
      { label: "Debt at stake", changed: S.efc.ead !== d.ead || S.efc.basis !== d.basis,
        value: `${pc(S.efc.ead)} of total liabilities` + (S.efc.basis === "guaranteed_debt" ? "; for the cost now, government-guaranteed debt where the file reports it" : "") },
      { label: "Years projected ahead", changed: false, value: `${SV.H()}; each shock lasts ${SV.D()} years` },
      { label: "Chance of distress", changed: false, value: "read from the indicative rating that goes with the distress score" },
      { label: "Shock sizes", changed: false, value: ["fuel", "fx", "rate", "refi", "revenue", "arrears"].map((k) => `${SV.COPY[k][0]} (${SV.COPY[k][1](m)})`).join("; ") },
      { label: "Exposure to each shock", changed: false, value: `from the SOE's own file where it has the figures, otherwise a default (${ex.k} of ${ex.n} SOEs use at least one default)` },
      { label: "Growth of GDP", changed: S.growth !== d.growth, value: `${fmt(S.growth * 100, 1)}% a year, for the share of GDP in later years` },
    ];
  };
  SV.changed = () => SV.assumptions().filter((a) => a.changed).length;

  /* ===== SIMPLE VIEW · B · overview page ===== */
  // Reads top to bottom: your data → pick a scenario → the answer → how sure it is. Every figure comes from SV
  // (section A). GDP reuses the Analyst routine (gdpFetch, gdpCurrencyStatus) and is stored in S.gdp / S.gdpSrc exactly
  // as the Analyst GDP field stores it, so both views show the same GDP.
  const svCountry = (c) => GDP_COUNTRIES.find((x) => x[0] === c) || [c, c, null];
  const svBy = (run) => (run.year ? `by ${run.year}` : `in ${run.H} years`);
  const svNum = (v) => v !== null && v !== undefined && ok(v);
  /** the World Bank series in the statements' currency, as the Analyst GDP field picks it by default */
  const svSeries = () => (stmtCurrency() === "USD" ? "CD" : "CN");
  const svGdpYear = () => String(S.gdpYear || last(S.years));
  /** a section heading with its step number */
  const svHead = (n, id, title, sub) => el("div", { class: "sv-head" },
    n ? el("span", { class: "sv-n num", "aria-hidden": "true" }, String(n)) : null,
    el("div", {}, el("h3", { id }, title), sub ? el("p", { class: "sv-sub" }, sub) : null));
  /** opens the Analyst view where the reader left it, as the header's mode button does */
  const svAnalyst = (label) => el("a", { href: "#view-home", onclick: (e) => { e.preventDefault(); showTab(S.lastAnalyst || "home"); window.scrollTo({ top: 0 }); } }, label);
  const svChange = (v, ref, more, less, same) => {
    const d = ref > 0 ? v / ref - 1 : NaN;
    if (!ok(d)) return "";
    if (Math.abs(d) < 0.005) return same;
    return `${fmt(Math.abs(d) * 100, 0)}% ${d > 0 ? more : less}`;
  };

  const SV_STATE_ROW = "Share of the loss the State bears"; // the row of SV.assumptions() the State's-share doubt sits under

  pages.simple = {
    build(root) {
      const U = (this.U = {});
      // 1. your data
      U.file = el("input", { type: "file", id: "sv-file", accept: ".csv,.xlsx,.xls,.txt", hidden: true, "aria-label": "Upload SOE financial statements, CSV or Excel" });
      U.msg = el("div", { class: "lp-msg sv-msg" });
      U.file.addEventListener("change", () => { const f = U.file.files[0]; if (f) readUpload(f, U.msg); U.file.value = ""; });
      const tplLabel = canDownload ? "Download the template" : "Copy the template";
      const tpl = el("button", { type: "button", class: "sv-link" }, tplLabel);
      tpl.addEventListener("click", async () => { // the same CSV as Home's "Template (CSV)"
        if (canDownload) { download("soe_tool_template.csv", templateCSV()); return; }
        try { await navigator.clipboard.writeText(templateCSV()); tpl.textContent = "Copied"; setTimeout(() => (tpl.textContent = tplLabel), 1500); } catch (e) { showTab("about"); }
      });
      U.summary = el("p", { id: "sv-summary", class: "sv-summary" });
      U.gdpSel = el("div", { class: "sv-gdp-sel" });
      U.gdpYearSel = el("div", { class: "sv-gdp-year-sel" });
      U.gdp = el("div", { class: "sv-gdp-box" });
      U.gdpLine = el("div", { class: "sv-gdp-line", "aria-live": "polite" });
      U.gdp.append(U.gdpLine);
      U.loaded = el("div", { class: "sv-loaded" });
      U.examples = el("div");
      const data = el("section", { id: "sv-data", class: "card sv-sec sv-data", "aria-labelledby": "sv-h-data" },
        el("div", { class: "sv-data-top" },
          el("div", { class: "sv-data-what" }, svHead(1, "sv-h-data", "Your data"), U.summary),
          el("div", { class: "sv-data-act" }, el("button", { type: "button", class: "btn primary", onclick: () => U.file.click() }, "Upload your file"), tpl, U.file)),
        el("div", { class: "sv-gdp-row" }, U.gdpSel, U.gdpYearSel, U.gdp),
        U.loaded, U.msg, U.examples);
      data.addEventListener("dragover", (e) => { e.preventDefault(); data.classList.add("over"); });
      data.addEventListener("dragleave", (e) => { if (!data.contains(e.relatedTarget)) data.classList.remove("over"); });
      data.addEventListener("drop", (e) => { e.preventDefault(); data.classList.remove("over"); if (e.dataTransfer.files[0]) readUpload(e.dataTransfer.files[0], U.msg); });
      // 2. scenario
      U.scen = el("div", { id: "sv-scen", class: "sv-cards", role: "group", "aria-label": "Scenario" });
      U.scenLine = el("p", { class: "sv-line" });
      const scen = el("section", { class: "sv-sec sv-scen", "aria-labelledby": "sv-h-scen" },
        svHead(2, "sv-h-scen", "Scenario", "Pick what could go wrong. Each card shows what your SOEs could cost the budget under it."), U.scen, U.scenLine);
      // 3. answer
      U.answer = el("div", { class: "sv-answer", "aria-live": "polite" });
      U.hint = el("p", { class: "sv-hint" });
      U.table = el("div", { class: "tbl-wrap sv-tbl" });
      U.tools = el("div", { class: "btn-row sv-tools" });
      const ans = el("section", { class: "card sv-sec sv-ans", "aria-labelledby": "sv-h-ans" }, svHead(3, "sv-h-ans", "Answer"), U.answer, U.hint, U.table, U.tools);
      // 4. what if the shock is smaller or bigger
      U.sizesBody = el("div", { class: "sv-sz-body" });
      U.sizes = el("section", { id: "sv-sizes", class: "card sv-sec", "aria-labelledby": "sv-h-sizes" },
        svHead(4, "sv-h-sizes", "What if the shock is smaller or bigger?"), U.sizesBody);
      // 5. assumptions, 6. links
      U.assume = el("div");
      const links = el("nav", { class: "sv-links", "aria-label": "More" }, go("how", "How this works"), svAnalyst("Analyst view"));
      root.replaceChildren(el("div", { class: "sv" },
        pageHead("Simple view", "What could your SOEs cost the budget?", "Load the accounts, pick a scenario, read the answer. A first screen, not a forecast."),
        data, scen, ans, U.sizes, U.assume, links));
    },
    render() {
      this.renderData();
      this.renderScen();
      this.renderAnswer();
      this.renderSizes();
      this.renderAssume();
    },

    /* ---------- 1. your data ---------- */
    renderData() {
      const U = this.U, yrs = S.years.length > 1 ? `${S.years[0]}–${last(S.years)}` : String(S.years[0] ?? "");
      put(U.summary, el("b", {}, S.label || "Loaded data"), el("span", { class: "sv-facts" }, [pl(S.names.length, "SOE"), yrs, CUR].filter(Boolean).join(" · ")));
      // after an upload: Home's confirmation line and its column-mapping fold
      put(U.loaded, S.key === "upload" && S.uploadNote ? el("p", { class: "lp-loaded" }, S.uploadNote) : null, S.mapping ? mappingDetails(S.mapping) : null);
      // the built-in datasets, under the labels Home uses
      const copyOf = DATASETS.report ? ["sample", "demo", "long"].find((k) => DATASETS[k] && DATASETS[k].label === DATASETS.report.label) : null;
      const active = S.key === "report" && copyOf ? copyOf : S.key;
      const ds = (key, label, sub) => DATASETS[key] ? el("button", { type: "button", class: "chip sv-ds", "aria-pressed": String(active === key),
        onclick: () => loadDataset(DATASETS[key].rows, DATASETS[key].label, DATASETS[key].example, key) }, label, el("small", {}, sub)) : null;
      put(U.examples, fold(S.simple.open, "examples", "Try example data", [el("div", { class: "sv-ex" },
        DATASETS.report && !copyOf ? ds("report", "Report data", DATASETS.report.label) : null,
        ds("sample", "Example", "SOE A and B, 2020–2024"), ds("demo", "Demo portfolio", "8 SOEs in 7 sectors"), ds("long", "Long panel", "30 SOEs, 20 years"))]));
      this.renderCountry();
      this.renderYear();
      this.renderGdp();
    },
    /** Country and year are visible in Simple view; the World Bank GDP lookup uses both. */
    renderCountry() {
      const U = this.U, dc = dataCountry();
      if (dc && !S.gdpCountry) S.gdpCountry = dc;
      const opts = [["", "Select a country…"], ...GDP_COUNTRIES.slice().sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => [c, n])];
      put(U.gdpSel, fSelect("Country", opts, S.gdpCountry || "", (v) => this.pickCountry(v), { id: "sv-country" }));
    },
    renderYear() {
      const U = this.U, topYear = Math.max(new Date().getFullYear() - 1, last(S.years) || 0);
      if (!S.gdpYear) S.gdpYear = String(last(S.years) || topYear);
      const opts = [];
      for (let yr = topYear; yr >= 1960; --yr) opts.push([String(yr), String(yr)]);
      put(U.gdpYearSel, fSelect("GDP year", opts, svGdpYear(), (v) => this.pickYear(v), { id: "sv-gdp-year" }));
    },
    pickCountry(v) {
      S.gdpCountry = v;
      S.gdp = null; S.gdpSrc = null;
      S.simple.gdpKey = "";
      if (v) this.lookup(true);
      this.gdpChanged();
    },
    pickYear(v) {
      S.gdpYear = v;
      S.gdp = null; S.gdpSrc = null;
      S.simple.gdpKey = "";
      if (S.gdpCountry && v) this.lookup(true);
      this.gdpChanged();
    },
    /** World Bank WDI GDP in the statements' currency, shared with Analyst view. */
    lookup(force) {
      const st = S.simple, country = S.gdpCountry, year = svGdpYear(), series = svSeries();
      if (!country || !year) return;
      const key = gdpKey(series, country, year);
      st.gdpTry = st.gdpTry || {};
      if (S.gdpSrc && S.gdpSrc.kind === "wb" && gdpKey(S.gdpSrc.series, S.gdpSrc.country, S.gdpSrc.year) === key) return;
      if (!force && st.gdpKey === key && st.gdpTry[key]) return;
      st.gdpTry[key] = { s: "busy" };
      st.gdpKey = key;
      // Never retain a GDP from another country/year while a new figure is loading.
      S.gdp = null; S.gdpSrc = null;
      const done = (o) => {
        if (S.simple !== st || st.gdpKey !== key || S.gdpCountry !== country || svGdpYear() !== year) return;
        st.gdpTry[key] = o;
        if (o.s === "ok") {
          const r = o.res;
          S.gdp = r.value / SC; S.gdpSrc = r;
          S.gdpCountry = r.country; S.gdpYear = r.year; S.gdpSeries = r.series;
        } else { S.gdp = null; S.gdpSrc = null; }
        if (S.tab === "simple") this.gdpChanged();
      };
      gdpFetch(series, country, year).then((value) => {
        if (!(value > 0)) { done({ s: "none" }); return; }
        const res = { kind: "wb", series, country, year, value, cur: series === "CD" ? "USD" : svCountry(country)[2] || null };
        done(gdpCurrencyStatus(res.cur) === "mismatch" ? { s: "mismatch", res } : { s: "ok", res });
      }, () => done({ s: "fail" }));
    },
    gdpChanged() { this.renderGdp(); this.renderAnswer(); this.renderSizes(); this.renderAssume(); },
    /** Read-only GDP: no manual-entry path in Simple view. */
    renderGdp() {
      const U = this.U, st = S.simple, year = svGdpYear(), country = S.gdpCountry, src = S.gdpSrc;
      this.lookup(false);
      const tr = country ? (st.gdpTry || {})[gdpKey(svSeries(), country, year)] : null;
      const cname = svCountry(country)[1];
      const line = el("p", { id: "sv-gdp", class: "sv-gdp", "data-v": S.gdp ? S.gdp * SC : "" });
      const key = gdpKey(svSeries(), country, year);
      if (!country) {
        put(line, el("span", { class: "muted" }, "Select a country and GDP year to load GDP automatically."));
      } else if (S.gdp && src && src.kind === "wb" && gdpKey(src.series, src.country, src.year) === key) {
        const same = gdpCurrencyStatus(src.cur) === "match";
        put(line, el("span", { class: "sv-gdp-lbl" }, "GDP"), " ", `${svCountry(src.country)[1]}, ${src.year}: `,
          el("b", { class: "num" }, same ? money(S.gdp, true) : `${gdpBig(src.value)} ${src.cur || ""}`),
          el("span", { class: "muted" }, " (World Bank WDI · automatically loaded)"),
          same ? null : ` Check that your accounts are in ${gdpCurName(src.cur)}.`,
          String(year) === String(last(S.years)) ? null : ` Note: GDP year differs from the latest financial statement year (${last(S.years)}).`);
      } else if (country && (!tr || tr.s === "busy")) {
        put(line, el("span", { class: "sv-gdp-lbl" }, "GDP"), " ", el("span", { class: "muted" }, `Looking up ${cname}, ${year}…`));
      } else if (country && tr) {
        const r = tr.res;
        const msg = tr.s === "none" ? `World Bank GDP is unavailable for ${cname} in ${year}. Choose a different year.`
          : tr.s === "mismatch" ? `World Bank GDP is in ${gdpCurName(r.cur)}, but financial statements use ${CUR}. The GDP share is not calculated to avoid mixing currencies.`
          : "World Bank GDP lookup is unavailable. Re-select the country or year to retry.";
        put(line, el("span", { class: "sv-gdp-lbl" }, "GDP"), " ", el("span", { class: "muted" }, msg));
      }
      put(U.gdpLine, line);
    },
    gdpHint() {
      if (!S.gdpCountry) return "choose a country to load GDP automatically";
      const tr = (S.simple.gdpTry || {})[gdpKey(svSeries(), S.gdpCountry, svGdpYear())];
      if (!tr || tr.s === "busy") return "looking up GDP to show the share of GDP";
      if (tr.s === "mismatch") return "GDP and financial statement currencies do not match";
      if (tr.s === "none") return "GDP is unavailable for this year; choose another GDP year";
      return "GDP lookup is unavailable; re-select the country or year to retry";
    },

    /* ---------- 2. scenario ---------- */
    renderScen() {
      const U = this.U, tot = SV.totals(), base = tot.none, run0 = SV.run("none"), by = svBy(run0);
      put(U.scen, SV.scenarios().map((s) => {
        const v = tot[s.key];
        return el("button", { type: "button", class: "sv-card", "data-scen": s.key, "aria-pressed": String(s.key === S.simple.scen), onclick: () => this.pick(s.key) },
          el("span", { class: "sv-card-name" }, s.name),
          el("span", { class: "sv-card-size" }, s.size),
          el("span", { class: "sv-card-cap" }, `Cost ${by}`),
          el("span", { class: "sv-card-total" }, el("b", { class: "num", "data-k": "total", "data-v": v }, money(v)), CUR ? el("small", {}, CUR) : null),
          el("span", { class: "sv-card-ch" }, s.key === "none" ? "the starting point" : svChange(v, base, "more than no shock", "less than no shock", "about the same as no shock")));
      }));
      U.scenLine.textContent = `Each shock lasts ${SV.D()} years. Costs are shown for ${run0.year || "the year"}, ${SV.H()} years after the latest accounts.`;
    },
    pick(key) {
      S.simple.scen = key;
      this.U.scen.querySelectorAll("button[data-scen]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scen === key)));
      this.renderAnswer();
      this.renderSizes();
      this.renderAssume(); // the State's-share sentence follows the scenario
    },

    /* ---------- 3. answer ---------- */
    renderAnswer() {
      const U = this.U, st = S.simple, run = SV.run(st.scen), w = SV.warnings(), n = run.items.length, by = svBy(run);
      const hasGdp = svNum(run.futGdp);
      const lead = run.key === "none" ? "With no shock" : `Under “${run.name}”`;
      put(U.answer,
        el("p", { class: "sv-big" }, `${lead}, your ${pl(n, "SOE")} could cost the budget `, el("b", { class: "num" }, money(run.futTotal, true)), ` ${by}`,
          hasGdp ? [", ", el("b", { class: "num" }, `${pctS(run.futGdp)} of GDP`)] : null, "."),
        el("p", { class: "sv-big-sub" }, `From the latest accounts, the cost to the budget today is ${money(run.nowTotal, true)}` +
          (svNum(run.nowGdp) ? `, ${pctS(run.nowGdp)} of GDP.` : ".") + (hasGdp ? "" : ` ${this.gdpHint().replace(/^./, (c) => c.toUpperCase())}.`)));
      U.hint.textContent = "Largest first. Select an SOE to see why, and what to do." + (CUR ? ` Amounts in ${CUR}.` : "");
      const open = (name) => { st.soe = name; showTab("soe"); window.scrollTo({ top: 0 }); };
      const rows = clipRows(run.items, st.all).map((it) => {
        const wv = w.by[it.name] || { level: "ok", rules: [] }, nr = wv.rules.filter((id) => id !== "routine").length;
        return el("tr", { class: "pick", tabindex: "0", "data-soe": it.name, "aria-label": `${it.name}: open the page for this SOE`,
          onclick: () => open(it.name), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(it.name); } } },
          nameCell(it.name, it.r.Sector),
          el("td", { class: "sv-health", "data-label": "Health now" }, zoneChip(it.zoneNow), el("span", { class: "sv-why" }, distressWhy(it.r))),
          el("td", { class: "r", "data-k": "now", "data-v": it.now, "data-label": "Cost now" }, el("span", { class: "sv-amt" }, money(it.now))),
          el("td", { class: "r", "data-k": "fut", "data-v": it.fut, "data-label": `Cost ${by}` }, el("span", { class: "sv-amt strong" }, money(it.fut)),
            el("span", { class: "sv-chg" }, svChange(it.fut, it.now, "more than now", "less than now", "same as now"), zoneChip(it.zoneFut))),
          el("td", { "data-k": "warn", "data-v": nr, "data-level": wv.level, "data-label": "Warnings" }, el("span", { class: "sv-warn" }, stChip(wv.level), el("span", { class: "sv-rules" }, nr ? pl(nr, "warning") : "none"))));
      });
      const futHead = `Cost ${by}: ${run.name}`;
      const t = el("table", { id: "sv-table", class: "sv-table" },
        el("thead", {}, el("tr", {}, el("th", {}, "SOE"), el("th", {}, "Health now"),
          el("th", { class: "r" }, "Cost to the budget now", el("small", {}, "expected fiscal cost, from the latest accounts")),
          el("th", { class: "r" }, futHead, el("small", {}, "change against now, and health then")), el("th", {}, "Warnings"))),
        el("tbody", {}, rows),
        el("tfoot", {}, el("tr", {},
          el("td", { colspan: "2" }, el("b", {}, n > 1 ? `All ${n} SOEs` : "All SOEs")),
          el("td", { class: "r", "data-label": "Cost now" }, el("b", { class: "num", "data-k": "now-total", "data-v": run.nowTotal }, money(run.nowTotal, true)),
            svNum(run.nowGdp) ? el("small", {}, `${pctS(run.nowGdp)} of GDP`) : null),
          el("td", { class: "r", "data-label": `Cost ${by}` }, el("b", { class: "num sv-foot-fut", "data-k": "fut-total", "data-v": run.futTotal }, money(run.futTotal, true)),
            el("small", { "data-k": "fut-gdp", "data-v": hasGdp ? run.futGdp : "" }, hasGdp ? `${pctS(run.futGdp)} of GDP` : this.gdpHint())),
          el("td", {}))));
      put(U.table, t);
      const csv = () => toCSV(["SOE", "Sector", "Health now", "Cost to the budget now", futHead, "Health then", "Warning level", "Rules"],
        run.items.map((it) => { const wv = w.by[it.name] || { level: "ok", rules: [] }; return [it.name, it.r.Sector, it.zoneNow, it.now, it.fut, it.zoneFut, STLABEL[wv.level] || wv.level, wv.rules.filter((id) => id !== "routine").length]; }));
      put(U.tools, moreToggle(n, st.all, (v) => { st.all = v; this.renderAnswer(); }, `Show the ${LIMIT} largest only`), dataButtons(csv, `soe_cost_${run.key}.csv`));
    },

    /* ---------- 4. what if the shock is smaller or bigger ---------- */
    renderSizes() {
      const U = this.U, key = S.simple.scen, g = SV.sizes(key);
      U.sizes.setAttribute("data-scen", key);
      if (g.none) {
        U.sizes.setAttribute("data-empty", "1");
        put(U.sizesBody, el("p", { class: "sv-sz-empty" }, "No shock is chosen, so there is nothing to make smaller or bigger. Pick a scenario above to see how its size changes the answer."));
        return;
      }
      U.sizes.removeAttribute("data-empty");
      svSizeBars(U.sizesBody, svSizesOf(g, (m) => m.total, (m) => m.gdp), {});
    },

    /* ---------- 5. assumptions ---------- */
    /** the doubt about the share of the loss the State bears, shown under that assumption (it is not doubt about the scenario) */
    stateLines() {
      const g = SV.stateRange(S.simple.scen), run = SV.run(S.simple.scen), m = Object.keys(g.by).length;
      const gdp = ok(g.loGdp) && ok(g.hiGdp) ? ` (${pctS(g.loGdp)} to ${pctS(g.hiGdp)} of GDP)` : "";
      return el("div", { class: "sv-asm-state" },
        el("p", {}, `If the State bore the low or the high share for each SOE's sector (from past defaults on public loans), the cost ${svBy(run)} would be between `,
          el("b", { class: "num", "data-k": "state-lo", "data-v": g.lo }, money(g.lo)), " and ", el("b", { class: "num", "data-k": "state-hi", "data-v": g.hi }, money(g.hi)), gdp + "."),
        g.above.length ? el("p", { class: "sv-above" }, `For ${g.above.length} of ${m} SOEs the low figure for their sector is above the ${fmt(g.share * 100, 0)}% assumed.`) : null);
    },
    renderAssume() {
      const st = S.simple, n = SV.changed();
      const d = el("details", { id: "sv-assume", class: "card sv-assume", open: st.open.assume ? true : null },
        el("summary", {}, el("span", { class: "sv-assume-t" }, "Assumptions behind these numbers"),
          el("span", { id: "sv-changed", class: "st watch", hidden: n ? null : true }, `${n} changed in Analyst view`)),
        el("dl", { class: "sv-asm" }, SV.assumptions().map((a) => el("div", { class: "sv-asm-row" + (a.changed ? " changed" : "") },
          el("dt", {}, a.label), el("dd", {}, a.value, a.changed ? el("span", { class: "sv-tag" }, "changed") : null,
            a.label === SV_STATE_ROW ? this.stateLines() : null)))),
        el("p", { class: "note" }, "These can be changed in the Analyst view. Changes made there show here. ", svAnalyst("Open the Analyst view")));
      d.addEventListener("toggle", () => { st.open.assume = d.open; });
      put(this.U.assume, d);
    },
  };

  /** SV.sizes() of the portfolio (pick = total, gdp) or of one SOE, as the shape svSizeBars() draws:
      { base: { value, gdp }, levels: [{ level, label, size, value, gdp }], year, scenarioName } */
  function svSizesOf(g, val, gdpOf) {
    return { base: { value: val(g.base), gdp: gdpOf(g.base) }, year: g.year, scenarioName: g.name,
      levels: g.levels.map((l) => ({ level: l.level, label: l.label, size: l.size, value: val(l), gdp: gdpOf(l) })) };
  }
  /** What if the shock is smaller or bigger? Three bars on one linear scale from zero (milder, as assumed, more severe)
      with a dashed reference line at the no-shock cost. Each bar = no-shock part (quiet) + part added by the shock (blue);
      a value below no shock simply stops short of the line. A list, every value in text; the % of GDP column exists only
      when GDP is known. Used by the Overview (portfolio) and the One-SOE page (one SOE).
      opts.of = what the cost belongs to ("the cost" or "this SOE's cost"). */
  function svSizeBars(box, z, opts) {
    opts = opts || {};
    const L = z.levels, hasGdp = ok(z.base.gdp) && L.every((l) => ok(l.gdp));
    const top = Math.max(z.base.value, ...L.map((l) => l.value), 1e-12), at = (v) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`;
    const xb = (z.base.value / top) * 100;
    const when = z.year ? `by ${z.year}` : `in ${SV.H()} years`;
    const std = L.find((l) => l.level === "standard") || L[0];
    const gdpTxt = (g) => (hasGdp ? `${pctS(g)} of GDP` : null);
    const seg = (cls, left, right) => el("i", { class: "sv-sz-seg " + cls, style: `left:${left};right:${right}` });
    const row = (l) => {
      const ans = l.level === "standard", v = l.value, b = z.base.value, above = v > b;
      const chg = svChange(v, b, "more than no shock", "less than no shock", "about the same as no shock");
      const bars = above
        ? [b > 0 ? seg("sv-sz-base", "0", `calc(100% - ${at(b)} + 1px)`) : null, seg("sv-sz-add" + (ans ? " ans" : ""), `calc(${at(b)} + 1px)`, `calc(100% - ${at(v)})`)]
        : [v > 0 ? seg("sv-sz-base end", "0", `calc(100% - ${at(v)})`) : null];
      return el("div", { class: "sv-sz-row" + (ans ? " ans" : ""), role: "listitem", "data-level": l.level, "data-v": l.value, "data-gdp": hasGdp ? l.gdp : "" },
        el("div", { class: "sv-sz-lab" },
          el("span", { class: "sv-sz-name" }, l.label, ans ? el("span", { class: "sv-sz-tag" }, "the answer") : null),
          el("span", { class: "sv-sz-size" }, l.size)),
        el("div", { class: "sv-sz-track", role: "img", "aria-label": `${l.label}: ${money(v, true)}` }, bars, el("b", { class: "sv-sz-ref", style: `left:${xb}%`, "aria-hidden": "true" })),
        el("span", { class: "sv-sz-money num" }, money(v)),
        hasGdp ? el("span", { class: "sv-sz-gdp num" }, gdpTxt(l.gdp)) : null,
        el("span", { class: "sv-sz-chg" }, chg));
    };
    const flip = xb > 55; // the reference label sits beside the line, on the side with room
    const ref = el("div", { class: "sv-sz-row sv-sz-none", role: "listitem", "data-level": "none", "data-v": z.base.value, "data-gdp": hasGdp ? z.base.gdp : "" },
      el("div", { class: "sv-sz-lab" }),
      el("div", { class: "sv-sz-track sv-sz-head" },
        el("span", { class: "sv-sz-reflab" + (flip ? " flip" : ""), style: `left:${xb}%` }, el("span", {}, "No shock"), " ", el("b", { class: "num" }, money(z.base.value)), hasGdp ? ` · ${gdpTxt(z.base.gdp)}` : "", ),
        el("b", { class: "sv-sz-ref", style: `left:${xb}%`, "aria-hidden": "true" })),
      el("span", { class: "sv-sz-pad", "aria-hidden": "true" }), hasGdp ? el("span", { class: "sv-sz-pad", "aria-hidden": "true" }) : null, el("span", { class: "sv-sz-pad", "aria-hidden": "true" }));
    put(box,
      el("p", { class: "sv-sub sv-sz-lead" }, `The answer assumes “${z.scenarioName}” (${std.size}). This is ${opts.of || "the cost"} ${when} if the shock turns out milder or more severe.`),
      el("div", { class: "sv-sz" + (hasGdp ? "" : " nogdp"), role: "list" }, ref, L.map(row)),
      el("p", { class: "sv-sz-legend" },
        el("span", {}, el("i", { class: "sv-sz-sw sv-sz-base", "aria-hidden": "true" }), "cost with no shock"),
        el("span", {}, el("i", { class: "sv-sz-sw sv-sz-add", "aria-hidden": "true" }), "added by the shock")),
      el("div", { class: "sv-sz-note" },
        el("p", {}, "Milder and more severe are the tool's own guide sizes for this shock. They show how much the answer depends on the size of the shock, not how likely each size is."),
        el("p", {}, "The cost moves in steps: it rises when a shock pushes an SOE down a rating step. A row that barely moves does not mean the shock does no harm. An SOE's finances can weaken within its step, and one already at the lowest rating cannot be marked down further.")));
  }

  /* ===== SIMPLE VIEW · C · one-SOE page ===== */
  // Reads top to bottom: what state is this SOE in → why (health checks, ratios) → what it could cost → what to do.
  // Every figure is read from the same places as the Overview (SV.run, SV.sizes, SV.warnings) and the Analyst tabs
  // (enriched rows, HEALTH/WHY/STRONG, kpiStatus, RULE_BY); nothing is typed in.
  const SV_SEV = { alert: 0, watch: 1, ok: 2 };
  /** the app's own texts, with the one technical label that a rule's follow-up text can carry put in plain words */
  const svPlain = (t) => String(t).replace(/Z″(-EM)?/g, "distress score");
  /** a small line of one series, no axes; a missing value breaks the line, a single point is a dot */
  function svSpark(vals, years, fmtV, label) {
    const W = 104, H = 28, P = 4, pts = vals.map((v, i) => [i, v]).filter(([, v]) => ok(v));
    const svg = svgEl("svg", { class: "sv-spark", viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": "" });
    if (!pts.length) { svg.setAttribute("aria-label", `${label}: no values`); return svg; }
    const lo = Math.min(...pts.map((q) => q[1])), hi = Math.max(...pts.map((q) => q[1])), n = vals.length;
    const x = (i) => (n > 1 ? P + (i / (n - 1)) * (W - 2 * P) : W / 2), y = (v) => (hi - lo < 1e-12 ? H / 2 : H - P - ((v - lo) / (hi - lo)) * (H - 2 * P));
    let d = "", prev = -2;
    pts.forEach(([i, v]) => { d += `${i === prev + 1 ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; prev = i; });
    if (pts.length > 1) svgEl("path", { d, class: "sv-spark-ln" }, svg);
    const [li, lv] = last(pts), [fi, fv] = pts[0];
    svgEl("circle", { cx: x(li).toFixed(1), cy: y(lv).toFixed(1), r: 3, class: "sv-spark-dot" }, svg);
    svg.setAttribute("aria-label", pts.length > 1 ? `${label}: ${fmtV(fv)} in ${years[fi]}, ${fmtV(lv)} in ${years[li]}` : `${label}: ${fmtV(lv)} in ${years[li]}`);
    return svg;
  }

  pages.soe = {
    build(root) {
      const U = (this.U = {});
      const back = () => { showTab("simple"); window.scrollTo({ top: 0 }); };
      U.back = el("button", { type: "button", class: "btn", id: "soe-back", onclick: back }, "← Back to all SOEs");
      U.prev = el("button", { type: "button", class: "btn", id: "soe-prev", onclick: () => this.step(-1) }, "← Previous");
      U.next = el("button", { type: "button", class: "btn", id: "soe-next", onclick: () => this.step(1) }, "Next →");
      U.pos = el("span", { class: "sv-pos", id: "soe-pos", "aria-live": "polite" });
      U.title = el("h2", { id: "soe-title" });
      U.sub = el("p", { id: "soe-sub" });
      const sec = (id, hid, title, sub) => { const body = el("div", { class: "sv-soe-body" }); return { body, root: el("section", { id, class: "card sv-sec", "aria-labelledby": hid }, svHead(null, hid, title, sub), body) }; };
      U.verdict = el("section", { id: "soe-verdict", class: "card sv-sec sv-verdict", "aria-label": "Verdict" });
      U.health = sec("soe-health", "soe-h-health", "Four health checks", "Each bar shows how much one check adds to (right) or takes from (left) the distress score. The longer the bar, the bigger the effect.");
      U.ratios = sec("soe-ratios", "soe-h-ratios", "Health ratios", "The latest accounts, read against the cut-offs the tool uses.");
      U.cost = sec("soe-cost", "soe-h-cost", "What it could cost the budget");
      U.actions = sec("soe-actions", "soe-h-actions", "What to do", "The follow-up the tool calls for, from this SOE's latest accounts.");
      U.links = sec("soe-links", "soe-h-links", "Look closer in Analyst view");
      U.links.root.classList.add("sv-soe-links");
      root.replaceChildren(el("div", { class: "sv sv-soe" },
        el("nav", { class: "sv-soe-nav", "aria-label": "SOE pages" }, U.back, el("div", { class: "sv-soe-step" }, U.prev, U.pos, U.next)),
        el("div", { class: "page-head" }, el("div", {}, el("div", { class: "eyebrow" }, "One SOE"), U.title, U.sub)),
        U.verdict, U.health.root, U.ratios.root, U.cost.root, U.actions.root, U.links.root));
    },
    /** the SOE shown: the reader's choice, else the one with the largest cost; order = the Overview table's */
    items() { return SV.run(S.simple.scen).items; },
    index() {
      const items = this.items(), st = S.simple;
      let i = items.findIndex((x) => x.name === st.soe);
      if (i < 0) { i = 0; st.soe = items[0] ? items[0].name : null; }
      return i;
    },
    step(d) {
      const items = this.items(), i = this.index() + d;
      if (i < 0 || i >= items.length) return;
      S.simple.soe = items[i].name;
      this.render();
      window.scrollTo({ top: 0 });
    },
    render() {
      const U = this.U, items = this.items();
      if (!items.length) { put(U.title, "No SOEs loaded"); put(U.sub); return; }
      const i = this.index(), it = items[i], r = it.r, name = it.name;
      this.cur = name;
      const hist = byYearAsc(allRows().filter((q) => q.Entity === name));
      put(U.title, name);
      put(U.sub, [r.Sector, ok(r.Year) ? `latest accounts: ${r.Year}` : ""].filter(Boolean).join(" · "));
      U.prev.disabled = i <= 0;
      U.next.disabled = i >= items.length - 1;
      put(U.pos, `${i + 1} of ${items.length}`);
      this.renderVerdict(it);
      this.renderHealth(it, hist);
      this.renderRatios(it, hist);
      this.renderCost(it);
      this.renderActions(it);
      this.renderLinks(it);
    },

    /* ---------- verdict ---------- */
    renderVerdict(it) {
      const r = it.r, zl = String(ZLABEL[zk(r.Zone)] || r.Zone).toLowerCase().replace(/ zone$/, ""), why = distressWhy(r);
      if (!ok(r.Z_EM)) { put(this.U.verdict, el("p", { class: "sv-big" }, `${it.name}: the accounts do not have enough figures to work out a distress score, so there is no zone or rating.`)); return; }
      put(this.U.verdict, el("p", { class: "sv-big" }, `${it.name} is in the ${zl} zone${why ? ", " + why : ""}. Its indicative rating is ${r.Rating || "n/a"}. `, zoneChip(r.Zone)));
    },

    /* ---------- four health checks ---------- */
    renderHealth(it, hist) {
      const U = this.U, r = it.r, ks = ["X1", "X2", "X3", "X4"], C = CFG.ZEM_COEFFICIENTS;
      const vals = ks.map((k) => r[k] * C[k]), mx = Math.max(1e-9, ...vals.filter(ok).map(Math.abs));
      const rows = ks.map((k, j) => {
        const v = vals[j], has = ok(v), w = has ? (Math.abs(v) / mx) * 50 : 0;
        const mean = !has ? "no figure for this check in the accounts" : v >= 0 ? `Good: ${STRONG[k]}` : `Weak: ${WHY[k]}`;
        return el("li", { class: "sv-hc-row", "data-check": HEALTH[k] },
          el("span", { class: "sv-hc-name" }, HEALTH[k]),
          el("span", { class: "sv-hc-bar", role: "img", "aria-label": has ? `${HEALTH[k]}: ${sgn(v, 2)}` : `${HEALTH[k]}: no figure` },
            has ? el("i", { class: v >= 0 ? "pos" : "neg", style: v >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%` }) : null),
          el("span", { class: "sv-hc-val num", "data-v": has ? v : "" }, has ? sgn(v, 2) : "—"),
          el("span", { class: "sv-hc-mean" }, mean));
      });
      const box = el("div", { class: "chart sv-hist" });
      put(U.health.body, el("ul", { class: "sv-hc", role: "list" }, rows),
        el("figure", { class: "sv-fig" }, box, el("figcaption", {}, "Distress score by year")));
      const z = hist.map((q) => q.Z_EM);
      if (!z.some(ok)) { put(box, el("p", { class: "sv-wait" }, "No distress score could be worked out for this SOE.")); return; }
      const W = widthOf(box);
      lines(box, hist.map((q) => q.Year), [{ vals: z, cls: "ln-med", dot: "now", label: "Distress score" }], {
        h: 200, R: W < 420 ? 78 : 88, maxDots: 12,
        hlines: [{ y: CFG.Z_SAFE_CUTOFF, cls: "thr-warn sv-faint", label: "safe above", include: true }, { y: CFG.Z_DISTRESS_CUTOFF, cls: "thr-crit sv-faint", label: "distress below", include: true }],
        tipTitle: (k) => `${it.name} · ${hist[k].Year}`, tip: (k) => [[fmt(z[k], 2), "distress score"], [ZLABEL[zk(hist[k].Zone)] || hist[k].Zone, "zone"]],
        endLabel: { series: 0, fmt: (v) => fmt(v, 2) } });
    },

    /* ---------- health ratios ---------- */
    renderRatios(it, hist) {
      const body = this.U.ratios.body, r = it.r;
      const avail = E.availableKpis(hist), keys = CFG.REPORT_HEADLINE_KPIS.filter((k) => avail.includes(k));
      if (!keys.length) { put(body, el("p", { class: "sv-wait" }, "The file has no figures for the ratios the tool reads, so none can be shown for this SOE.")); return; }
      const years = hist.map((q) => q.Year);
      const rows = keys.map((k) => {
        const s = kpiStatus(r, k), v = r[k];
        return el("tr", { "data-kpi": k },
          el("th", { scope: "row", class: "sv-rt-name", "data-label": "Ratio" }, SPEC[k].label),
          el("td", { class: "r num sv-rt-val", "data-label": "Latest", "data-v": ok(v) ? v : "" }, kpiFmt(k, v), s.why ? el("small", {}, s.why) : null),
          el("td", { class: "sv-rt-st", "data-label": "Status" }, s.st ? stChip(s.st) : el("span", { class: "muted" }, "no data")),
          el("td", { class: "sv-rt-cut", "data-label": "Cut-off" }, cutText(k)),
          el("td", { class: "sv-rt-tr", "data-label": "Over the years" }, svSpark(hist.map((q) => q[k]), years, (x) => kpiFmt(k, x), SPEC[k].label)));
      });
      put(body, el("div", { class: "tbl-wrap sv-tbl" }, el("table", { class: "sv-rt" },
        el("thead", {}, el("tr", {}, el("th", {}, "Ratio"), el("th", { class: "r" }, "Latest"), el("th", {}, "Status"), el("th", {}, "Cut-off"), el("th", {}, years.length > 1 ? `${years[0]}–${last(years)}` : "Year"))),
        el("tbody", {}, rows))));
    },

    /* ---------- what it could cost ---------- */
    renderCost(it) {
      const U = this.U, st = S.simple, name = it.name, scs = SV.scenarios();
      const vals = scs.map((s) => { const x = SV.run(s.key).items.find((q) => q.name === name); return x ? x.fut : NaN; });
      const mx = Math.max(1e-9, ...vals.filter(ok));
      const run = SV.run(st.scen), by = svBy(run);
      const rows = scs.map((s, j) => {
        const sel = s.key === st.scen, v = vals[j];
        return el("button", { type: "button", class: "sv-srow" + (sel ? " sel" : ""), "data-scen": s.key, "data-v": ok(v) ? v : "", "aria-pressed": String(sel),
          onclick: () => { st.scen = s.key; this.renderCost(this.items()[this.index()]); } },
          el("span", { class: "sv-sr-name" }, el("b", {}, s.name), sel ? el("span", { class: "sv-sr-sel" }, "selected") : null, el("small", {}, s.size)),
          el("span", { class: "sv-sr-bar", "aria-hidden": "true" }, el("i", { style: `width:${ok(v) ? Math.max(0, (v / mx) * 100) : 0}%` })),
          el("span", { class: "sv-sr-amt num" }, money(v)));
      });
      const g = SV.sizes(st.scen), sr = SV.stateRange(st.scen), b = sr.by[name], sizes = el("div", { id: "soe-sizes", class: "sv-soe-sizes", "data-scen": st.scen });
      const gdpOf = (v) => (g.gdpH ? v / g.gdpH : null);
      if (g.none) { sizes.setAttribute("data-empty", "1"); put(sizes, el("h4", { class: "sv-h4" }, "What if the shock is smaller or bigger?"), el("p", { class: "sv-sz-empty" }, "No shock is chosen, so there is nothing to make smaller or bigger. Pick a scenario above to see how its size changes the answer.")); }
      else {
        const body = el("div", { class: "sv-sz-body" });
        put(sizes, el("h4", { class: "sv-h4" }, "What if the shock is smaller or bigger?"), body);
        svSizeBars(body, svSizesOf(g, (m) => m.by[name], (m) => gdpOf(m.by[name])), { of: "this SOE's cost" });
      }
      const gdp = g.gdpH && b ? ` (${pctS(b.lo / g.gdpH)} to ${pctS(b.hi / g.gdpH)} of GDP)` : "";
      const state = el("div", { id: "soe-state", class: "sv-soe-state" }, b ? [
        el("p", {}, `If the State bore the low or the high share for ${it.r.Sector} SOEs (from past defaults on public loans), the cost ${by} would be between `,
          el("b", { class: "num", "data-k": "state-lo", "data-v": b.lo }, money(b.lo)), " and ", el("b", { class: "num", "data-k": "state-hi", "data-v": b.hi }, money(b.hi)), gdp + "."),
        b.share[0] > sr.share ? el("p", { class: "sv-above" }, `For ${it.r.Sector} SOEs the low figure (${fmt(b.share[0] * 100, 0)}%) is above the ${fmt(sr.share * 100, 0)}% assumed, so this range starts above the cost shown.`) : null] : null);
      put(U.cost.body,
        el("p", { class: "sv-now" }, "Now, from the latest accounts: ", el("b", { class: "num", "data-k": "now", "data-v": it.now }, money(it.now, true))),
        el("p", { class: "sv-hint" }, `Cost to the budget ${by} under each scenario. Select one to see how its size changes the cost below.` + (CUR ? ` Amounts in ${CUR}.` : "")),
        el("div", { class: "sv-srows", role: "group", "aria-label": "Scenario" }, rows),
        el("div", { class: "sv-soe-range" }, sizes, state));
    },

    /* ---------- what to do ---------- */
    renderActions(it) {
      const w = SV.warnings().by[it.name] || { level: "ok", rules: [] };
      const rules = w.rules.map((id) => RULE_BY[id]).filter(Boolean).sort((a, b) => SV_SEV[a.level] - SV_SEV[b.level]);
      const real = rules.filter((q) => q.id !== "routine");
      put(this.U.actions.body,
        el("p", { class: "sv-lead" }, stChip(w.level), " ", real.length ? `${pl(real.length, "warning")} for this SOE, the most severe first.` : "No warning fires for this SOE. Routine monitoring is enough."),
        rules.map((q) => el("div", { class: "sv-rule", "data-rule": q.id },
          el("h4", { class: "sv-h4" }, stChip(q.level, q.short)),
          el("ol", {}, (q.steps || [q.action]).map((t) => el("li", {}, svPlain(t)))))));
    },

    /* ---------- links to the Analyst view ---------- */
    renderLinks(it) {
      const name = it.name, r = it.r;
      const link = (tab, label, text, fn) => el("li", {}, el("a", { href: "#view-" + tab, onclick: (e) => { e.preventDefault(); fn(); showTab(tab); window.scrollTo({ top: 0 }); } }, label), el("span", {}, text));
      put(this.U.links.body, el("ul", { class: "sv-lk" },
        // exactly what Early Warning's "Open in Shock Scenarios" button does for the SOE in focus
        link("shock", "Shock Scenarios", "Test one shock on this SOE and watch its accounts and health checks change.",
          () => { S.sh.soe = name; S.sh.year = r.Year; S.sh.view = "single"; S.sh.mode = "standard"; Object.assign(S.sh.mags, STD_MAG, { fuel_shock_path: [] }); S.built.shock = false; }),
        link("kpi", "KPI Dashboard", "Every ratio for this SOE, year by year.", () => { S.kpi.soe = name; S.kpi.view = "trend"; S.built.kpi = false; }),
        link("altman", "Distress Indicator", "The four health checks and the distress score in detail.", () => { S.alt.soe = name; S.alt.view = "components"; S.built.altman = false; })));
    },
  };
