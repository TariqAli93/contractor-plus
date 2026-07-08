// ============================================================
// Business Rules Engine — the ONLY place deterministic math runs.
//
// A registry of pure, side-effect-free RuleFns (Decimal-safe via lib/money.ts —
// never native float, never DB, never LLM). Tools contribute their rules
// (EstimationTool registers estimation.* from the re-homed calc.ts). "The AI
// never performs financial calculations directly" is enforced here + at the
// tool input schemas.
// ============================================================

export interface RuleFn<I = unknown, O = unknown> {
  id: string;
  run: (input: I) => O;
}

export class RuleEngine {
  private readonly rules = new Map<string, RuleFn>();

  register(rule: RuleFn): void {
    this.rules.set(rule.id, rule);
  }

  registerAll(rules: RuleFn[]): void {
    for (const r of rules) this.register(r);
  }

  has(ruleId: string): boolean {
    return this.rules.has(ruleId);
  }

  run<I, O>(ruleId: string, input: I): O {
    const rule = this.rules.get(ruleId);
    if (!rule) throw new Error(`Unknown business rule: ${ruleId}`);
    return rule.run(input) as O;
  }
}
