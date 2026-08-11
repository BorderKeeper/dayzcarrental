// aiClient.ts — a budget-gated wrapper around the Claude Messages API.
//
// Every AI call the bot makes goes through here, and every call is bounded by
// the BudgetLedger (budget.ts): the client estimates the worst-case cost, and
// if the bank can't afford it the call is REFUSED — never made, never
// overdrawn. After a successful call it debits the *actual* token usage. The
// bot therefore spends only what donations have funded, and stops when the
// balance hits zero.
//
// No SDK dependency (package.json is locked): this talks to the API over raw
// `fetch`, which is the sanctioned raw-HTTP path. The API key comes from the
// environment (ANTHROPIC_API_KEY) and is NEVER read from or written to the
// repo (CLAUDE.md rule 2). Model + pricing follow the claude-api reference.

import { BudgetLedger, InsufficientBudgetError, MICRO } from "./budget";

// Pricing in micro-USD per token (per-1M rates ÷ 1e6). Opus 5 = $5 in / $25 out
// per million tokens; cache reads bill at ~0.1× input. Keep in sync with the
// model below if it changes.
export interface ModelPricing {
  model: string;
  inputPerToken: number; // µ$ per input token
  outputPerToken: number; // µ$ per output token
  cacheReadPerToken: number; // µ$ per cached input token
}

export const OPUS_5_PRICING: ModelPricing = {
  model: "claude-opus-5",
  inputPerToken: 5, // $5 / 1M = 5 µ$/token
  outputPerToken: 25, // $25 / 1M = 25 µ$/token
  cacheReadPerToken: 0.5, // ~0.1× input
};

export interface AiCallOptions {
  system?: string;
  maxTokens?: number; // hard output cap; also drives the pre-spend estimate
  model?: string;
  pricing?: ModelPricing;
}

export interface AiCallResult {
  text: string;
  stopReason: string | null;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  costMicros: number;
}

// The transport is injected so the whole thing is testable without a network.
// In production this is `fetch`; in tests it's a stub returning a canned body.
export type FetchLike = (url: string, init: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}>;

// Worst-case cost of a call before we know the real usage: assume the full
// output budget is produced, plus the estimated input. Used for the
// affordability pre-check so we never start a call we can't pay for.
export function estimateMaxCostMicros(
  estInputTokens: number,
  maxOutputTokens: number,
  pricing: ModelPricing,
): number {
  return Math.ceil(estInputTokens * pricing.inputPerToken + maxOutputTokens * pricing.outputPerToken);
}

// Actual cost from a response's usage block.
export function actualCostMicros(
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number },
  pricing: ModelPricing,
): number {
  return Math.ceil(
    usage.inputTokens * pricing.inputPerToken +
      usage.outputTokens * pricing.outputPerToken +
      usage.cacheReadTokens * pricing.cacheReadPerToken,
  );
}

export class BudgetExhaustedError extends Error {
  readonly balanceMicros: number;
  readonly estimateMicros: number;
  constructor(balanceMicros: number, estimateMicros: number) {
    super(
      `AI call refused: budget too low (balance ${(balanceMicros / MICRO).toFixed(4)} USD, ` +
        `estimated need ${(estimateMicros / MICRO).toFixed(4)} USD). The bot waits for more ` +
        `donations rather than overspending.`,
    );
    this.name = "BudgetExhaustedError";
    this.balanceMicros = balanceMicros;
    this.estimateMicros = estimateMicros;
  }
}

export class BudgetedClaudeClient {
  private apiKey: string;
  private fetchImpl: FetchLike;
  private ledger: BudgetLedger;
  // Rough token-per-char estimate for the input pre-check (Claude tokenizes
  // ~3.5–4 chars/token; 4 is conservative-low so we lean toward *over*-
  // estimating cost, which is the safe direction for a budget guard).
  private static CHARS_PER_TOKEN = 4;

  constructor(opts: { apiKey: string; ledger: BudgetLedger; fetchImpl?: FetchLike }) {
    if (!opts.apiKey) throw new Error("Missing Anthropic API key (set ANTHROPIC_API_KEY; never commit it).");
    this.apiKey = opts.apiKey;
    this.ledger = opts.ledger;
    // Default to the global fetch; injectable for tests.
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
  }

  private estimateInputTokens(prompt: string, system?: string): number {
    const chars = prompt.length + (system?.length ?? 0);
    return Math.ceil(chars / BudgetedClaudeClient.CHARS_PER_TOKEN);
  }

  // Make one budgeted call. Order matters:
  //   1. estimate worst-case cost,
  //   2. refuse if the bank can't afford it (no call is made),
  //   3. call the API,
  //   4. debit the ACTUAL usage from the ledger.
  async complete(prompt: string, opts: AiCallOptions = {}): Promise<AiCallResult> {
    const pricing = opts.pricing ?? OPUS_5_PRICING;
    const model = opts.model ?? pricing.model;
    const maxTokens = opts.maxTokens ?? 1024;

    const estInput = this.estimateInputTokens(prompt, opts.system);
    const estimate = estimateMaxCostMicros(estInput, maxTokens, pricing);

    // (2) Hard gate. If we can't afford the worst case, don't call at all.
    if (!this.ledger.canAfford(estimate)) {
      throw new BudgetExhaustedError(this.ledger.balanceMicros, estimate);
    }

    // (3) The call. Raw HTTP; adaptive thinking left at the model default.
    const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const usage = {
      inputTokens: data?.usage?.input_tokens ?? 0,
      outputTokens: data?.usage?.output_tokens ?? 0,
      cacheReadTokens: data?.usage?.cache_read_input_tokens ?? 0,
    };
    const text = Array.isArray(data?.content)
      ? data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
      : "";

    // (4) Debit actual usage. spend() itself hard-stops at zero as a backstop,
    // but the pre-check should mean this never throws for a normal call.
    const cost = actualCostMicros(usage, pricing);
    try {
      this.ledger.spend(cost, `AI call (${model}): ${usage.inputTokens} in / ${usage.outputTokens} out`);
    } catch (e) {
      if (e instanceof InsufficientBudgetError) {
        // Actual usage exceeded the estimate AND drained the bank — record the
        // whole remaining balance so the ledger still can't go negative.
        this.ledger.spend(this.ledger.balanceMicros, `AI call (${model}): partial debit at zero`);
      } else {
        throw e;
      }
    }

    return { text, stopReason: data?.stop_reason ?? null, usage, costMicros: cost };
  }
}
