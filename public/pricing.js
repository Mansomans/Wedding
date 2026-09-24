/* Venue pricing engine. Shared by the page (window.Pricing) and the unit tests (require).
   A venue's `pricing` looks like:
     {
       lines: [{ id, label, category: rental|food|bar|fb|staff|other,
                 basis: flat|per_guest|minimum, amount: number|null, qty: 1,
                 servicePct: number|null, serviceTaxable: bool, taxPct: number|null, taxable: bool,
                 source: "", status: quoted|published|not_priced, note: "" }],
       coverage: { rental|food|bar|staff|other: auto|included|not_included|not_priced|none },
       asOf: "YYYY-MM-DD"|null, rateYear: number|null, notes: ""
     }
   null percentages mean "rate not stated". null amounts mean "not priced yet".
   No number is ever invented: a missing rate is reported, never assumed. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Pricing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
  const FB = new Set(["food", "bar", "fb"]);
  const fmt = n => "$" + round2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, "");
  const pct = p => (Math.round(p * 100) / 100) + "%";

  function priced(line) { return line && isNum(line.amount) && line.status !== "not_priced"; }
  function qtyOf(line) { return isNum(line.qty) && line.qty > 0 ? line.qty : 1; }
  function unitBase(line, guests) { return line.basis === "per_guest" ? line.amount * guests * qtyOf(line) : line.amount * qtyOf(line); }

  function applyRates(base, line) {
    const s = isNum(line.servicePct) ? line.servicePct / 100 : 0;
    const t = isNum(line.taxPct) ? line.taxPct / 100 : 0;
    const service = base * s;
    const baseTaxable = line.taxable !== false;
    const tax = (baseTaxable ? base : 0) * t + (line.serviceTaxable ? service : 0) * t;
    return { base, service, tax, total: base + service + tax };
  }

  function baseText(line, guests, useMin) {
    const q = qtyOf(line);
    if (useMin) return fmt(line.amount) + " min";
    if (line.basis === "per_guest") return fmt(line.amount) + " × " + guests + (q > 1 ? " × " + q : "");
    return fmt(line.amount) + (q > 1 ? " × " + q : "");
  }
  function rateText(line) {
    const s = isNum(line.servicePct) ? line.servicePct : null, t = isNum(line.taxPct) ? line.taxPct : null;
    const baseTaxable = line.taxable !== false;
    if (!s && !t) return "";
    if (s && t && baseTaxable && line.serviceTaxable) return ` × (1 + ${pct(s)}) × (1 + ${pct(t)})`;
    if (s && t && baseTaxable && !line.serviceTaxable) return ` × (1 + ${pct(s)} + ${pct(t)})`;
    if (s && t && !baseTaxable && line.serviceTaxable) return ` + ${pct(s)} service + ${pct(t)} tax on the service`;
    if (s && !t) return ` × (1 + ${pct(s)})`;
    if (!s && t && baseTaxable) return ` × (1 + ${pct(t)})`;
    return "";
  }

  /* Convert an old fixed/perGuest venue record into lines, without inventing rates. */
  function fromLegacy(o) {
    const lines = [];
    if (isNum(o.fixed) && o.fixed > 0) lines.push({ id: "legacy-fixed", label: "Flat amount (as previously entered)", category: "rental", basis: "flat", amount: o.fixed, qty: 1, servicePct: null, serviceTaxable: false, taxPct: null, taxable: true, source: "", status: "quoted" });
    if (isNum(o.perGuest) && o.perGuest > 0) lines.push({ id: "legacy-per-guest", label: "Per-guest amount (as previously entered)", category: "fb", basis: "per_guest", amount: o.perGuest, qty: 1, servicePct: null, serviceTaxable: false, taxPct: null, taxable: true, source: "", status: "quoted" });
    const coverage = {};
    if (o.cateringIncluded === false) coverage.food = "not_included";
    if (o.barIncluded === false) coverage.bar = "not_included";
    return { lines, coverage, asOf: null, rateYear: null, notes: "", legacy: true };
  }
  function pricingOf(o) { return o && o.pricing && Array.isArray(o.pricing.lines) ? o.pricing : fromLegacy(o || {}); }

  const ROW_LABELS = { rental: "Venue rental", food: "Food", bar: "Bar", staff: "Staff / labor", service: "Service charge", tax: "Tax", other: "Other required fees" };

  /* opts: { addons: [{label, perGuest, flat}], today: Date, heldYear: number } */
  function compute(venue, guests, opts) {
    opts = opts || {};
    const p = pricingOf(venue);
    const lines = (p.lines || []).map((l, i) => ({ ...l, id: l.id || "l" + i }));
    const cov = p.coverage || {};
    const pricedLines = lines.filter(priced);
    const unpriced = lines.filter(l => !priced(l));
    const missing = [];
    const computed = [];

    // ---- Food & bar with a minimum floor
    const fbLines = pricedLines.filter(l => FB.has(l.category));
    const minLines = fbLines.filter(l => l.basis === "minimum");
    const spendLines = fbLines.filter(l => l.basis !== "minimum");
    const minLine = minLines.length ? minLines.reduce((a, b) => (b.amount * qtyOf(b) > a.amount * qtyOf(a) ? b : a)) : null;
    const spendBase = spendLines.reduce((s, l) => s + unitBase(l, guests), 0);
    let minimum = null;
    if (minLine) {
      const minBase = unitBase(minLine, guests);
      const sets = spendBase < minBase;
      const perGuestSum = spendLines.filter(l => l.basis === "per_guest").reduce((s, l) => s + l.amount * qtyOf(l), 0);
      const flatSpend = spendLines.filter(l => l.basis !== "per_guest").reduce((s, l) => s + unitBase(l, guests), 0);
      const until = perGuestSum > 0 ? Math.floor((minBase - flatSpend) / perGuestSum) : null;
      minimum = { amount: minBase, sets, until, spendBase };
      if (sets) {
        const r = applyRates(minBase, minLine);
        computed.push({ id: minLine.id, label: minLine.label || "F&B minimum", category: "fb", ...r, setsPrice: true, text: baseText(minLine, guests, true) + rateText(minLine), line: minLine });
        spendLines.forEach(l => computed.push({ id: l.id, label: l.label, category: l.category, base: 0, service: 0, tax: 0, total: 0, covered: true, text: baseText(l, guests) + " (under the minimum)", line: l }));
      } else {
        spendLines.forEach(l => { const b = unitBase(l, guests); computed.push({ id: l.id, label: l.label, category: l.category, ...applyRates(b, l), setsPrice: true, text: baseText(l, guests) + rateText(l), line: l }); });
        computed.push({ id: minLine.id, label: minLine.label || "F&B minimum", category: "fb", base: 0, service: 0, tax: 0, total: 0, covered: true, text: fmt(minBase) + " minimum is met", line: minLine });
      }
    } else {
      spendLines.forEach(l => { const b = unitBase(l, guests); computed.push({ id: l.id, label: l.label, category: l.category, ...applyRates(b, l), text: baseText(l, guests) + rateText(l), line: l }); });
    }
    // ---- Everything that is not food & bar
    pricedLines.filter(l => !FB.has(l.category)).forEach(l => { const b = unitBase(l, guests); computed.push({ id: l.id, label: l.label, category: l.category, ...applyRates(b, l), text: baseText(l, guests) + rateText(l), line: l }); });

    // ---- Coverage per component
    const has = cat => pricedLines.some(l => l.category === cat || (cat !== "rental" && cat !== "staff" && cat !== "other" && l.category === "fb" && FB.has(cat)));
    const explicit = cat => (cov[cat] && cov[cat] !== "auto") ? cov[cat] : null;
    const state = {};
    for (const cat of ["rental", "food", "bar", "staff", "other"]) {
      const ex = explicit(cat);
      if (has(cat)) state[cat] = "included";
      else if (ex) state[cat] = ex;
      else if (unpriced.some(l => l.category === cat || (l.category === "fb" && FB.has(cat)))) state[cat] = "not_priced";
      else if (cat === "other") state[cat] = "none";
      else if (cat === "staff") state[cat] = (has("food") && pricedLines.some(l => FB.has(l.category) && isNum(l.servicePct) && l.servicePct > 0)) ? "included" : (explicit("food") === "not_included" ? "not_included" : "not_priced");
      else state[cat] = "not_priced";
    }
    const rateLines = pricedLines;
    const svcUnstated = rateLines.filter(l => !isNum(l.servicePct));
    const taxUnstated = rateLines.filter(l => !isNum(l.taxPct));
    const svcRates = [...new Set(rateLines.filter(l => isNum(l.servicePct) && l.servicePct > 0).map(l => l.servicePct))];
    const taxRates = [...new Set(rateLines.filter(l => isNum(l.taxPct) && l.taxPct > 0).map(l => l.taxPct))];
    state.service = rateLines.length === 0 ? "not_priced" : svcUnstated.length ? "rate_not_stated" : svcRates.length ? "included" : "none";
    state.tax = rateLines.length === 0 ? "not_priced" : taxUnstated.length ? "rate_not_stated" : taxRates.length ? "included" : "none";

    // ---- Missing list
    if (pricedLines.length) {
      unpriced.forEach(l => missing.push((l.label || "A line") + " not quoted"));
      if (state.rental === "not_priced" && !unpriced.some(l => l.category === "rental")) missing.push("Room rental not quoted");
      if (state.food === "not_priced" && !unpriced.some(l => FB.has(l.category))) missing.push("Food not priced");
      if (state.bar === "not_priced" && !unpriced.some(l => FB.has(l.category))) missing.push("Bar not priced");
      if (state.staff === "not_priced") missing.push("Staff / labor not priced");
      if (state.other === "not_priced") missing.push("Other required fees not priced");
      if (svcUnstated.length) missing.push("Service charge rate not stated" + (svcUnstated.length < rateLines.length ? " (" + svcUnstated.map(l => l.label).join(", ") + ")" : ""));
      if (taxUnstated.length) missing.push("Tax rate not stated" + (taxUnstated.length < rateLines.length ? " (" + taxUnstated.map(l => l.label).join(", ") + ")" : ""));
    }

    // ---- Status
    const venueOnly = state.food === "not_included" && !has("food");
    let status;
    if (!pricedLines.length) status = "not_priced";
    else if (venueOnly) status = "venue_only";
    else if (missing.length) status = "incomplete";
    else status = "complete";

    // ---- Add-ons entered by the couple for venue-only places (never $0)
    const addons = [];
    if (venueOnly) {
      (opts.addons || []).forEach(a => {
        const amt = (isNum(a.perGuest) ? a.perGuest * guests : 0) + (isNum(a.flat) ? a.flat : 0);
        if (amt > 0) { addons.push({ label: a.label, total: amt, text: [isNum(a.perGuest) && a.perGuest > 0 ? fmt(a.perGuest) + " × " + guests : null, isNum(a.flat) && a.flat > 0 ? fmt(a.flat) : null].filter(Boolean).join(" + ") }); }
      });
      if (state.food === "not_included" && !addons.some(a => /cater|food/i.test(a.label))) missing.push("Catering not priced");
      if (state.bar === "not_included" && !addons.some(a => /bar/i.test(a.label))) missing.push("Bar not priced");
    }

    const venueTotal = computed.reduce((s, c) => s + c.total, 0);
    const addonTotal = addons.reduce((s, a) => s + a.total, 0);
    const total = status === "not_priced" ? null : round2(venueTotal + addonTotal);
    const parts = { rental: 0, fb: 0, staff: 0, other: 0, service: 0, tax: 0 };
    computed.forEach(c => { parts[FB.has(c.category) ? "fb" : c.category === "rental" ? "rental" : c.category === "staff" ? "staff" : "other"] += c.base; parts.service += c.service; parts.tax += c.tax; });
    parts.addons = addonTotal;

    const suffix = [];
    if (status !== "not_priced") {
      if (state.service === "rate_not_stated") suffix.push("+ service");
      if (state.tax === "rate_not_stated") suffix.push("+ tax");
      if (venueOnly && missing.some(m => /Catering not priced/.test(m))) suffix.push("+ catering");
      else if (venueOnly && missing.some(m => /^Bar not priced/.test(m))) suffix.push("+ bar");
    }

    // ---- Math string
    const mathParts = computed.filter(c => !c.covered).map(c => c.text + (c.service || c.tax ? " = " + fmt(c.total) : ""));
    addons.forEach(a => mathParts.push(a.text + " (" + a.label + ", our quote)"));
    const math = status === "not_priced" ? "" : mathParts.length > 1 ? mathParts.join(" + ") + " = " + fmt(total) : (mathParts[0] || "");

    // ---- Rows for the "what's included" table
    const rows = [];
    const amountFor = cats => computed.filter(c => cats.includes(c.category)).reduce((s, c) => s + c.base, 0);
    rows.push({ key: "rental", label: ROW_LABELS.rental, state: state.rental, amount: state.rental === "included" ? amountFor(["rental"]) : null });
    const fbIncludedAmount = amountFor(["food", "bar", "fb"]);
    rows.push({ key: "food", label: ROW_LABELS.food, state: state.food, amount: state.food === "included" ? (has("fb") && !has("bar") ? fbIncludedAmount : amountFor(["food", "fb"])) : null, addon: addons.find(a => /cater|food/i.test(a.label)) });
    rows.push({ key: "bar", label: ROW_LABELS.bar, state: state.bar, amount: state.bar === "included" ? (pricedLines.some(l => l.category === "bar") ? amountFor(["bar"]) : null) : null, addon: addons.find(a => /bar/i.test(a.label)) });
    rows.push({ key: "staff", label: ROW_LABELS.staff, state: state.staff, amount: state.staff === "included" && pricedLines.some(l => l.category === "staff") ? amountFor(["staff"]) : null, viaService: state.staff === "included" && !pricedLines.some(l => l.category === "staff") });
    rows.push({ key: "service", label: ROW_LABELS.service, state: state.service, amount: state.service === "included" ? parts.service : null, rates: svcRates });
    rows.push({ key: "tax", label: ROW_LABELS.tax, state: state.tax, amount: state.tax === "included" ? parts.tax : null, rates: taxRates });
    rows.push({ key: "other", label: ROW_LABELS.other, state: state.other, amount: state.other === "included" ? amountFor(["other"]) : null, addon: addons.find(a => /misc|other|rental/i.test(a.label)) });

    // ---- Freshness
    const today = opts.today ? new Date(opts.today) : new Date();
    let freshness = { asOf: p.asOf || null, days: null, stale: false, rateYear: p.rateYear || null, rateYearMismatch: false };
    if (p.asOf && /^\d{4}-\d{2}-\d{2}$/.test(p.asOf)) {
      const d = new Date(p.asOf + "T12:00:00");
      freshness.days = Math.floor((today - d) / 86400000);
      freshness.stale = freshness.days > 60;
    }
    if (isNum(p.rateYear) && isNum(opts.heldYear) && p.rateYear < opts.heldYear) freshness.rateYearMismatch = true;

    return { status, total, suffix: suffix.join(" "), parts, rows, computed, addons, missing, minimum, math, state, freshness, legacy: !!p.legacy, guests };
  }

  const STATUS_LABEL = { complete: "Complete", venue_only: "Venue only", incomplete: "Incomplete", not_priced: "No price yet" };
  const ROW_STATE_LABEL = { included: "✓ included", not_included: "✗ not included", not_priced: "not priced yet", rate_not_stated: "rate not stated", none: "— none" };

  return { compute, pricingOf, fromLegacy, applyRates, round2, fmt, STATUS_LABEL, ROW_STATE_LABEL, ROW_LABELS };
});
