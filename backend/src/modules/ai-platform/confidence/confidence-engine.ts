// ============================================================
// Confidence Engine — every AI turn carries a confidence score; a low score
// gates to a clarification instead of an assumption. Kept deliberately simple
// and deterministic; richer signal-weighting is a later-phase concern.
// ============================================================

const DEFAULT_THRESHOLD = 0.4;

export interface ConfidenceSignals {
  intent: number; // parser confidence
  context?: number; // how well references resolved
  catalogMatch?: number; // how well the target tool/action matched
}

export class ConfidenceEngine {
  score(signals: ConfidenceSignals): number {
    const parts = [signals.intent, signals.context ?? signals.intent, signals.catalogMatch ?? signals.intent];
    const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
    return Math.max(0, Math.min(1, avg));
  }

  gate(confidence: number, threshold = DEFAULT_THRESHOLD): 'proceed' | 'clarify' {
    return confidence < threshold ? 'clarify' : 'proceed';
  }
}
