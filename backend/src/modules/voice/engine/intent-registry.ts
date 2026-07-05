// ============================================================
// Intent registry — maps a VoiceIntent to its handler.
//
// The open/closed core: the engine asks the registry for a handler and never
// knows any concrete intent. Registering a new handler is the ONLY change
// needed to teach the system a new command.
// ============================================================

import type { VoiceIntent } from '@contractor-plus/shared';
import type { IntentHandler } from './voice.types.js';

export class IntentRegistry {
  private readonly handlers = new Map<VoiceIntent, IntentHandler>();

  register(handler: IntentHandler): this {
    if (this.handlers.has(handler.intent)) {
      throw new Error(`Duplicate voice intent handler: ${handler.intent}`);
    }
    this.handlers.set(handler.intent, handler);
    return this;
  }

  get(intent: VoiceIntent): IntentHandler | undefined {
    return this.handlers.get(intent);
  }

  has(intent: VoiceIntent): boolean {
    return this.handlers.has(intent);
  }

  intents(): VoiceIntent[] {
    return [...this.handlers.keys()];
  }
}
