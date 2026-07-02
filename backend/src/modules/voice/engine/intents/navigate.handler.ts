// ============================================================
// navigate handler — a CLIENT intent (no DB write).
//
// Demonstrates the other half of the protocol: the plan carries a clientAction
// the frontend performs (router.push). It never confirms and never executes a
// transaction. Page-level RBAC is enforced by the SPA route guards, so no
// per-step permission is required here.
// ============================================================

import { VoiceIntent } from '@contractor-plus/shared';
import type { IntentHandler, Plan, PlanInput, SlotDef } from '../voice.types.js';

export class NavigateHandler implements IntentHandler {
  readonly intent = VoiceIntent.NAVIGATE;

  readonly requiredSlots: SlotDef[] = [
    {
      name: 'route',
      read: (bag) => bag.route,
      question: 'إلى أي صفحة تريد الذهاب؟ (المشاريع، العملاء، العقود، المواد...)',
    },
  ];

  plan(input: PlanInput): Plan {
    const to = String(input.bag.route);
    return {
      intent: this.intent,
      side: 'client',
      mutates: false,
      requiredPermissions: [],
      steps: [],
      clientActions: [{ type: 'navigate', to }],
      summary: {
        title: 'فتح الصفحة',
        mutates: false,
        lines: [{ label: 'الوجهة', value: to }],
      },
    };
  }
}
