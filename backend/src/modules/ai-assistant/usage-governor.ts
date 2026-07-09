// ============================================================
// Usage governor — cumulative per-user cost/usage control, measured at the ONE
// unified orchestrator (not three). Distinct from the per-request 20/min burst
// limiter (lib/rate-limit.ts): this is a daily/monthly ceiling on real AI turns.
//
// Derived from the indexed AiExecution trail (userId + createdAt) — NO new table,
// NO migration. Only real tool turns write an AiExecution, so the deterministic
// pre-router replies (help/greeting/status) are free and never count.
// ============================================================

import type { PrismaClient } from '@prisma/client';

export interface QuotaConfig {
  daily: number;
  monthly: number;
}

export interface QuotaVerdict {
  allowed: boolean;
  reason?: string;
  message?: string;
}

/** Configurable via env (AI_QUOTA_DAILY / AI_QUOTA_MONTHLY); generous defaults.
 *  A future per-subscription-plan limit can override via the constructor. */
function defaultQuota(): QuotaConfig {
  const daily = Number(process.env.AI_QUOTA_DAILY);
  const monthly = Number(process.env.AI_QUOTA_MONTHLY);
  return {
    daily: Number.isFinite(daily) && daily > 0 ? daily : 200,
    monthly: Number.isFinite(monthly) && monthly > 0 ? monthly : 3000,
  };
}

export class UsageGovernor {
  private readonly quota: QuotaConfig;

  constructor(private readonly prisma: PrismaClient, quota?: Partial<QuotaConfig>) {
    this.quota = { ...defaultQuota(), ...quota };
  }

  /** Check the caller's cumulative usage. Call only on a real (passthrough) turn. */
  async check(userId: string): Promise<QuotaVerdict> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [daily, monthly] = await Promise.all([
      this.prisma.aiExecution.count({ where: { userId, createdAt: { gte: startOfDay } } }),
      this.prisma.aiExecution.count({ where: { userId, createdAt: { gte: startOfMonth } } }),
    ]);

    if (daily >= this.quota.daily) {
      return {
        allowed: false,
        reason: 'quota_daily_exceeded',
        message: `وصلت الحد اليومي لاستخدام المساعد الذكي (${this.quota.daily} طلب). جرّب باچر أو راجع الإدارة لرفع الحد.`,
      };
    }
    if (monthly >= this.quota.monthly) {
      return {
        allowed: false,
        reason: 'quota_monthly_exceeded',
        message: `وصلت الحد الشهري لاستخدام المساعد الذكي (${this.quota.monthly} طلب). راجع الإدارة لرفع الحد.`,
      };
    }
    return { allowed: true };
  }
}
