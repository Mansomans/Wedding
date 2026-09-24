import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { VENUE_PRICING } from "../migrations/venue-pricing-2026-09.js";
const Pricing = createRequire(import.meta.url)("../public/pricing.js");

const GUESTS = 163;
const venue = name => ({ name, pricing: VENUE_PRICING[name].pricing });
const run = (name, opts) => Pricing.compute(venue(name), GUESTS, { today: "2026-09-23", heldYear: 2027, ...opts });
const money = n => Math.round(n * 100) / 100;

test("Whittemore House: $17,280 flat + ($75 + $34) × 1.30 per guest", () => {
  const r = run("Whittemore House (WNDC)");
  assert.equal(money(r.total), 40377.10);
  assert.equal(r.status, "complete");
});
test("Mayflower: $353.43/guest all-in; minimum + venue fee not quoted → Incomplete", () => {
  const r = run("The Mayflower Hotel");
  assert.equal(money(r.total), 57609.09);
  assert.equal(r.status, "incomplete");
  assert.ok(r.missing.some(m => /minimum/i.test(m)));
  assert.ok(r.missing.some(m => /venue fee/i.test(m)));
});
test("Hay-Adams: $55k min × 1.31 + $15k rental, no tax or service on rental", () => {
  const r = run("The Hay-Adams");
  assert.equal(money(r.total), 87050.00);
  assert.equal(r.status, "complete");
  assert.equal(r.minimum.sets, true);
  assert.match(r.math, /\$55,000 min × \(1 \+ 21% \+ 10%\) = \$72,050 \+ \$15,000 = \$87,050/);
});
test("Hotel Monaco: ($239 × 163 + $5,000) × 1.25 × 1.10", () => {
  const r = run("Hotel Monaco DC — Paris Ballroom");
  assert.equal(money(r.total), 60440.88);
  assert.equal(r.status, "complete");
  assert.equal(r.freshness.rateYearMismatch, true, "2026 rates for a 2027 date are flagged");
});
test("St. Regis: ($47k + $12k) + 26% service on both + 10% tax on F&B and service", () => {
  const r = run("The St. Regis Washington");
  assert.equal(money(r.total), 80574.00);
  assert.equal(r.status, "complete");
});
test("Waldorf: $85k × 1.26 × 1.10 + $10k fee + 4 × $450 bartenders + 2 × $450 coat check", () => {
  const r = run("Waldorf Astoria Washington DC");
  assert.equal(money(r.total), 130510.00);
  assert.equal(r.status, "complete");
});
test("Maggiano's: $105 × 1.20 gratuity, tax rate not stated → Incomplete, '+ tax'", () => {
  const r = run("Maggiano's Little Italy — Chevy Chase");
  assert.equal(money(r.total), 20538.00);
  assert.equal(r.status, "incomplete");
  assert.equal(r.suffix, "+ tax");
  assert.ok(r.missing.some(m => /tax rate not stated/i.test(m)));
  assert.equal(r.minimum.sets, false, "$17,115 of spend clears the $10,000 minimum");
});
test("Decatur House: $12,600, venue only", () => {
  const r = run("Decatur House");
  assert.equal(money(r.total), 12600);
  assert.equal(r.status, "venue_only");
  assert.ok(r.missing.includes("Catering not priced"));
  assert.equal(r.suffix, "+ catering");
});
test("Ritz-Carlton, Park Hyatt, Patterson: no price yet, no dollar figure", () => {
  for (const name of ["The Ritz-Carlton, Washington DC (West End)", "Park Hyatt Washington", "Patterson Mansion"]) {
    const r = run(name);
    assert.equal(r.status, "not_priced", name);
    assert.equal(r.total, null, name);
    assert.equal(r.math, "", name);
  }
});

test("minimum crossover: package overtakes the minimum after N guests", () => {
  const v = { pricing: { lines: [
    { label: "F&B minimum", category: "fb", basis: "minimum", amount: 55000, servicePct: 21, taxPct: 10 },
    { label: "Dinner package", category: "fb", basis: "per_guest", amount: 300, servicePct: 21, taxPct: 10 },
  ] } };
  const a = Pricing.compute(v, 163); assert.equal(a.minimum.sets, true); assert.equal(a.minimum.until, 183);
  const b = Pricing.compute(v, 184); assert.equal(b.minimum.sets, false); assert.equal(money(b.total), money(184 * 300 * 1.31));
});
test("venue-only add-ons: $0 add-ons are never added; a real quote is", () => {
  const v = venue("Decatur House");
  const zero = Pricing.compute(v, GUESTS, { addons: [{ label: "Caterer", perGuest: 0 }, { label: "Open bar", perGuest: 0 }] });
  assert.equal(money(zero.total), 12600); assert.ok(zero.missing.includes("Catering not priced"));
  const quoted = Pricing.compute(v, GUESTS, { addons: [{ label: "Caterer", perGuest: 100 }] });
  assert.equal(money(quoted.total), 12600 + 16300); assert.ok(!quoted.missing.includes("Catering not priced")); assert.ok(quoted.missing.includes("Bar not priced"));
});
test("unstated service rate is reported, never assumed", () => {
  const r = Pricing.compute({ pricing: { lines: [{ label: "Dinner", category: "fb", basis: "per_guest", amount: 100, servicePct: null, taxPct: 10 }] } }, 10);
  assert.equal(money(r.total), 1100); assert.equal(r.status, "incomplete"); assert.equal(r.suffix, "+ service");
});
test("legacy fixed/perGuest records convert without inventing rates", () => {
  const r = Pricing.compute({ fixed: 1000, perGuest: 50, cateringIncluded: true }, 10);
  assert.equal(money(r.total), 1500); assert.equal(r.status, "incomplete");
  assert.ok(r.missing.some(m => /service charge rate not stated/i.test(m)));
});
test("stale prices are flagged after 60 days", () => {
  const r = Pricing.compute({ pricing: { lines: [{ label: "Rental", category: "rental", basis: "flat", amount: 100, servicePct: 0, taxPct: 0 }], asOf: "2026-06-01" } }, 10, { today: "2026-09-23" });
  assert.equal(r.freshness.stale, true);
});
