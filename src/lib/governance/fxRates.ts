// fxRates.ts — founder-set currency conversion for donation credits.
//
// THE PROBLEM (FOLLOWUPS.md item 4): the budget store holds a balance PER
// CURRENCY, and the spend guard debits ONE (USD). The founder's PayPal is
// CZK-based, so a donation PayPal reports in CZK lands in a CZK balance that AI
// spend cannot draw on — the treasury shows funds while a build refuses as if
// broke.
//
// WHY A FOUNDER-SET RATE, not a live one: this converts REAL MONEY into a real
// spending ceiling. A live rate would put a network dependency (and a silent
// failure mode) inside the money path, and a guessed rate would misstate the
// balance. A rate the founder types in is a deliberate, auditable act — it is
// wrong only if the founder is wrong, and it is recorded alongside the credit.
//
// CONFIGURATION — one env var per currency, named for its direction:
//
//     PAYPAL_FX_CZK_USD=0.0435     # 1 CZK = 0.0435 USD
//
// The suffix is the TARGET: `<FROM>_USD` means "multiply the <FROM> amount by
// this to get USD". Getting the direction backwards (0.0435 vs 23) inflates a
// spending ceiling, so the name carries the direction and every conversion is
// echoed in the API response and recorded with the credit.
//
// INERT BY DEFAULT: with no rate configured for a currency, nothing converts and
// the donation is credited in its own currency exactly as before. Turning this
// on is an explicit founder action, never a silent change to how money is
// counted.
//
// COMPLIANCE.md: this only ever converts an already-received DONATION into the
// upkeep balance. It cannot price a rental, move money, or pay anyone.

import { MICRO } from "./budget";
import { DEFAULT_CURRENCY, type BudgetStore } from "./budgetStore";

// ISO code -> how many USD one unit of that currency is worth.
export type FxRates = Readonly<Record<string, number>>;

const ENV_PATTERN = /^PAYPAL_FX_([A-Z]{3})_USD$/;

// A unit worth more than this is a magnitude typo, not a currency — the
// strongest real currencies sit near 3 USD per unit. Catches a dropped decimal
// point (435 for 0.0435). It cannot catch a plausible-looking INVERSION (23 for
// 0.0435); that is why conversions are echoed and recorded rather than silent.
const MAX_PLAUSIBLE_RATE = 100;

// Read PAYPAL_FX_<CUR>_USD vars into a rate table. A malformed, zero, negative,
// or implausible value is IGNORED rather than applied or treated as zero:
// crediting a donation at a broken rate would misstate real money, and dropping
// to zero would silently discard it. Ignoring falls back to today's behaviour.
export function fxRatesFromEnv(env: Record<string, string | undefined> = process.env): FxRates {
  const rates: Record<string, number> = {};
  for (const [key, raw] of Object.entries(env)) {
    const m = ENV_PATTERN.exec(key);
    if (!m || raw == null) continue;
    const rate = Number.parseFloat(String(raw).trim());
    if (!Number.isFinite(rate) || rate <= 0 || rate > MAX_PLAUSIBLE_RATE) continue;
    const currency = m[1];
    if (currency === DEFAULT_CURRENCY) continue; // USD->USD is not a conversion
    rates[currency] = rate;
  }
  return rates;
}

export interface Conversion {
  fromCurrency: string; // ISO code PayPal reported
  fromMicros: number; // micro-units of fromCurrency, as received
  rate: number; // USD per 1 unit of fromCurrency
  usdMicros: number; // what gets credited
}

// Convert a donation to USD micro-units, or null when no conversion applies —
// the amount is already USD, no rate is configured, or the input is unusable.
// Null means "credit it natively", i.e. exactly the pre-FX behaviour.
export function convertToUsdMicros(
  amountMicros: number,
  currency: string,
  rates: FxRates,
): Conversion | null {
  if (!currency || currency === DEFAULT_CURRENCY) return null;
  if (!Number.isFinite(amountMicros) || amountMicros <= 0) return null;
  const rate = rates[currency];
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const usdMicros = Math.floor(amountMicros * rate);
  // A donation so small it rounds to nothing in USD credits nothing rather than
  // a zero that would look like a successful credit.
  if (usdMicros <= 0) return null;
  return { fromCurrency: currency, fromMicros: amountMicros, rate, usdMicros };
}

// Compact, greppable record of a conversion — stored with the credit's
// idempotency key so the founder can ask "what rate booked this donation?"
// long after the fact.
export function describeConversion(c: Conversion): string {
  return `fx:${(c.fromMicros / MICRO).toFixed(2)}${c.fromCurrency}@${c.rate}=${(c.usdMicros / MICRO).toFixed(6)}USD`;
}

export interface CreditResult {
  applied: boolean; // false = this id was already booked (idempotent re-delivery)
  currency: string; // what the balance was actually credited in
  balanceMicros: number;
  conversion: Conversion | null; // set when a founder rate was applied
  spendable: boolean; // false = sits in a balance AI spend cannot draw on
}

// The single place both credit channels (/api/paypal webhook and
// /api/paypal/reconcile poller) decide what to book. Converts when a rate is
// configured, credits natively when not, and records the conversion with the
// idempotency key either way. Keeping it here means the two paths cannot drift
// into crediting the same donation differently.
export async function creditDonation(
  store: BudgetStore,
  eventId: string,
  amountMicros: number,
  currency: string,
  rates: FxRates,
): Promise<CreditResult> {
  const conversion = convertToUsdMicros(amountMicros, currency, rates);
  const creditCurrency = conversion ? DEFAULT_CURRENCY : currency;
  const creditMicros = conversion ? conversion.usdMicros : amountMicros;
  const memo = conversion ? describeConversion(conversion) : "1";
  const { applied, balanceMicros } = await store.applyDonation(eventId, creditMicros, creditCurrency, memo);
  return {
    applied,
    currency: creditCurrency,
    balanceMicros,
    conversion,
    spendable: creditCurrency === DEFAULT_CURRENCY,
  };
}
