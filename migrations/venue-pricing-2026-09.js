// One-time migration: give each reception venue a `pricing` block of cost lines,
// `links` and `available`, built from the figures the venues gave us (see each
// line's `source`). Existing fields are left untouched. Matched by venue name.
// A missing rate is null ("not stated"), never assumed.

const L = (label, category, basis, amount, o = {}) => ({
  id: o.id || label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
  label, category, basis, amount,
  qty: o.qty ?? 1,
  servicePct: o.servicePct === undefined ? null : o.servicePct,
  serviceTaxable: !!o.serviceTaxable,
  taxPct: o.taxPct === undefined ? null : o.taxPct,
  taxable: o.taxable !== false,
  source: o.source || "",
  status: o.status || (amount === null ? "not_priced" : "quoted"),
  note: o.note || "",
});
const NONE = { servicePct: 0, taxPct: 0 }; // venue stated: no service charge, no tax on this line

export const VENUE_PRICING = {
  "Whittemore House (WNDC)": {
    available: "yes",
    pricing: {
      lines: [
        L("Room rental (main + second floor + setup)", "rental", "flat", 8250, { ...NONE, source: "Ric Marino, Sept 20 email + rate sheet" }),
        L("Labor", "staff", "flat", 6680, { ...NONE, source: "Ric's 180-guest budget, Sept 20" }),
        L("Linens and rentals", "other", "flat", 2350, { ...NONE, source: "Ric's 180-guest budget, Sept 20" }),
        L("Dinner", "food", "per_guest", 75, { servicePct: 20, taxPct: 10, source: "Ric's 180-guest budget, Sept 20" }),
        L("Bar", "bar", "per_guest", 34, { servicePct: 20, taxPct: 10, source: "Ric's 180-guest budget, Sept 20" }),
      ],
      coverage: {}, asOf: "2026-09-20", rateYear: null, notes: "30% tax and service on all F&B = 20% service + 10% DC tax, service not taxed.",
    },
  },
  "The Mayflower Hotel": {
    available: "unknown",
    pricing: {
      lines: [
        L("Wedding package, hotel's all-in figure ($255 + 26% service + 10% tax)", "fb", "per_guest", 353.43, { ...NONE, source: "Mayflower Wedding Package 2026-2027.pdf p.14", note: "$255 package with service and tax already included by the hotel" }),
        L("F&B minimum", "fb", "minimum", null, { source: "Kevin Salmeron — not yet quoted" }),
        L("Venue fee", "rental", "flat", null, { source: "Kevin Salmeron — not yet quoted" }),
      ],
      coverage: {}, asOf: null, rateYear: 2027, notes: "",
    },
  },
  "Patterson Mansion": { available: "unknown", pricing: { lines: [], coverage: { food: "not_priced", bar: "not_priced" }, asOf: null, rateYear: null, notes: "No quote requested (seats only 120)." } },
  "Decatur House": {
    available: "yes",
    pricing: {
      lines: [
        L("12-hour weekend exclusive rental", "rental", "flat", 12500, { ...NONE, source: "DH Rental Guidelines & Application 2027.docx, Sept 22 email", status: "published" }),
        L("Endowment contribution", "other", "flat", 100, { ...NONE, source: "DH Rental Guidelines & Application 2027.docx" }),
      ],
      coverage: { food: "not_included", bar: "not_included", staff: "not_included" }, asOf: "2026-09-22", rateYear: 2027, notes: "Caterer, bar, tent and rentals are outside vendors. 10-hour block is $9,800.",
    },
  },
  "The Hay-Adams": {
    available: "yes",
    pricing: {
      lines: [
        L("F&B minimum", "fb", "minimum", 55000, { servicePct: 21, taxPct: 10, source: "Amanda Aguilar, Sept 22" }),
        L("Room rental", "rental", "flat", 15000, { ...NONE, source: "Amanda Aguilar, Sept 22", note: "No tax or service on the rental" }),
      ],
      coverage: {}, asOf: null, rateYear: null, notes: "",
    },
  },
  "Washington Hilton": {
    available: "no",
    pricing: {
      lines: [
        L("F&B minimum", "fb", "minimum", 20000, { servicePct: 26, taxPct: 10, source: "Victoria Perez", note: "26% = 19.37% gratuity + 6.63% admin" }),
        L("Room rental (waived when the minimum is met)", "rental", "flat", 0, { ...NONE, source: "Victoria Perez" }),
      ],
      coverage: {}, asOf: null, rateYear: null, notes: "",
    },
  },
  "Park Hyatt Washington": { available: "unknown", pricing: { lines: [], coverage: { food: "not_priced", bar: "not_priced" }, asOf: null, rateYear: null, notes: "Intro only on Sept 18; no proposal yet." } },
  "Fairmont Washington, D.C., Georgetown": {
    available: "no",
    pricing: {
      lines: [
        L("F&B minimum (June / Sept dates)", "fb", "minimum", 45000, { servicePct: 26, taxPct: 10, source: "Mia Thoresen", note: "$40,000 on July / Nov dates" }),
        L("Room rental", "rental", "flat", 10000, { ...NONE, source: "Mia Thoresen" }),
      ],
      coverage: {}, asOf: null, rateYear: null, notes: "",
    },
  },
  "Willard InterContinental": {
    available: "no",
    pricing: {
      lines: [
        L("F&B minimum", "fb", "minimum", 50000, { servicePct: 25, taxPct: 10, source: "Michael Deltette" }),
        L("Room rental", "rental", "flat", null, { source: "Michael Deltette — not quoted" }),
      ],
      coverage: {}, asOf: null, rateYear: null, notes: "Ceremony fee $3,000 if on site (not needed).",
    },
  },
  "National Museum of Women in the Arts": {
    available: "no",
    pricing: {
      lines: [L("Great Hall + Mezzanine, peak season", "rental", "flat", 21000, { ...NONE, source: "Social Rates 26-28.pdf", status: "published", note: "$16,000 Jan/Feb/Aug; +$3,000 third-floor galleries; +$1,000 per gallery floor" })],
      coverage: { food: "not_included", bar: "not_included", staff: "not_included" }, asOf: null, rateYear: null, notes: "Space-only venue; caterer from their approved list.",
    },
  },
  "Waldorf Astoria Washington DC": {
    available: "no",
    pricing: {
      lines: [
        L("F&B minimum", "fb", "minimum", 85000, { servicePct: 26, serviceTaxable: true, taxPct: 10, source: "Elisabeth Thomas" }),
        L("Venue fee", "rental", "flat", 10000, { ...NONE, source: "Elisabeth Thomas", note: "No tax or service on the venue fee" }),
        L("Bartenders", "staff", "flat", 450, { ...NONE, qty: 4, source: "Elisabeth Thomas" }),
        L("Coat check attendants", "staff", "flat", 450, { ...NONE, qty: 2, source: "Elisabeth Thomas" }),
      ],
      coverage: {}, asOf: null, rateYear: null, notes: "",
    },
  },
  "Josephine Butler Parks Center": {
    available: "no",
    pricing: {
      lines: [
        L("Peak Saturday rental, 8 hours", "rental", "flat", 9400, { ...NONE, source: "Rate catalog (2025–2026 rates)", status: "published", note: "Off-season July 10 / Nov 27: $6,500" }),
        L("Membership fee", "other", "flat", 25, { ...NONE, source: "Rate catalog" }),
      ],
      coverage: { food: "not_included", bar: "not_included", staff: "not_included" }, asOf: null, rateYear: 2026, notes: "2027 rate not given.",
    },
  },
  "The St. Regis Washington": {
    available: "no",
    pricing: {
      lines: [
        L("F&B minimum", "fb", "minimum", 47000, { servicePct: 26, serviceTaxable: true, taxPct: 10, source: "Alexia Boyd" }),
        L("Room rental", "rental", "flat", 12000, { servicePct: 26, serviceTaxable: true, taxPct: 10, taxable: false, source: "Alexia Boyd", note: "26% service on the rental; 10% tax on the service charge but not on the rental itself" }),
      ],
      coverage: {}, asOf: null, rateYear: null, notes: "Fri / Sun cheaper.",
    },
  },
  "The Ritz-Carlton, Washington DC (West End)": { available: "no", pricing: { lines: [], coverage: { food: "not_priced", bar: "not_priced" }, asOf: null, rateYear: null, notes: "Wedding Presentation with package pricing was not attached to the Sept 22 email; ask Guadalupe to resend." } },
  "Conrad Washington DC": {
    available: "no",
    pricing: {
      lines: [
        L("F&B minimum", "fb", "minimum", 50000, { servicePct: 26, taxPct: 10, source: "Caroline Kennon" }),
        L("Room rental", "rental", "flat", 5000, { ...NONE, source: "Split out of the $73,000 total previously entered ($68,000 F&B with service and tax + $5,000); confirm with Caroline" }),
      ],
      coverage: {}, asOf: null, rateYear: null, notes: "",
    },
  },
  "Hotel Monaco DC — Paris Ballroom": {
    available: "yes",
    pricing: {
      lines: [
        L("Belle package", "fb", "per_guest", 239, { servicePct: 25, serviceTaxable: true, taxPct: 10, source: "Jennifer Wong", note: "5-hr open bar, hors d'oeuvres, 3-course dinner, Chiavari, dance floor, 1 bartender per 50" }),
        L("Room fee", "rental", "flat", 5000, { servicePct: 25, serviceTaxable: true, taxPct: 10, source: "Jennifer Wong" }),
      ],
      coverage: {}, asOf: null, rateYear: 2026, notes: "2027 pricing not locked.",
    },
  },
  "St. Francis Hall — Franciscan Monastery": {
    available: "unknown",
    pricing: {
      lines: [L("Saturday rental, 8 hours (published 2027 rate)", "rental", "flat", 14000, { ...NONE, source: "stfrancishall.com rates page", status: "published", note: "+$1,000 on holiday weekends" })],
      coverage: { food: "not_included", bar: "not_included", staff: "not_included" }, asOf: null, rateYear: 2027, notes: "Approved caterer and BYO bar are outside vendors.",
    },
  },
  "Maggiano's Little Italy — Chevy Chase": {
    available: "unknown",
    pricing: {
      lines: [
        L("Tuscan Family Style & Bar menu", "fb", "per_guest", 105, { servicePct: 20, taxPct: null, source: "Dinner Event Menus PDF", status: "published", note: "20% suggested gratuity; 'state and/or local tax is added' but no rate given" }),
        L("Event minimum", "fb", "minimum", 10000, { servicePct: 20, taxPct: null, source: "Jennifer Saperstein" }),
      ],
      coverage: { rental: "none" }, asOf: null, rateYear: null, notes: "",
    },
  },
  "Woodend Sanctuary & Mansion": {
    available: "unknown",
    pricing: {
      lines: [L("2027 June Saturday rental, 8 hours", "rental", "flat", 11400, { ...NONE, source: "2026-2028 pricing PDF p.4", status: "published", note: "10 hrs $13,500, 12 hrs $15,300; Jul/Aug/Nov $9,300. No sales tax." })],
      coverage: { food: "not_included", bar: "not_included", staff: "not_included" }, asOf: null, rateYear: 2027, notes: "",
    },
  },
};

/* Apply to a plan in place. Returns the number of venues changed. Idempotent. */
export function migratePlan(plan) {
  let changed = 0;
  const list = plan && plan.customOptions && Array.isArray(plan.customOptions.reception) ? plan.customOptions.reception : [];
  for (const o of list) {
    if (!o.pricing && VENUE_PRICING[o.name]) {
      o.pricing = JSON.parse(JSON.stringify(VENUE_PRICING[o.name].pricing));
      if (!o.available) o.available = VENUE_PRICING[o.name].available;
      changed++;
    }
    if (!Array.isArray(o.links)) { o.links = o.link ? [{ label: "Website", url: o.link }] : []; changed++; }
  }
  return changed;
}
