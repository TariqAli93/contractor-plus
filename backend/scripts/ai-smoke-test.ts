/**
 * Phase-1 acceptance check: one REAL OpenRouter call with AI_MODEL_DEFAULT,
 * its `usage` stored in AiRequestLog. Requires OPENROUTER_API_KEY (and
 * AI_MODEL_DEFAULT) in backend/.env — with AI disabled it reports and exits.
 *
 *   pnpm --filter backend ai:smoke
 */
import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env.js';
import { resolveAiRuntime } from '../src/lib/ai/ai-config.js';
import { OpenRouterProvider } from '../src/lib/ai/openrouter.provider.js';
import { AiAssistantRepository } from '../src/modules/ai-assistant/ai-assistant.repository.js';

const runtime = resolveAiRuntime(env);
if (!runtime.enabled) {
  console.log(
    `[ai:smoke] AI is disabled (${runtime.reason}). ` +
      'Set OPENROUTER_API_KEY and AI_MODEL_DEFAULT in backend/.env, then re-run.',
  );
  process.exit(2);
}

const prisma = new PrismaClient();
try {
  // The governance row needs a real user id — take the oldest active user.
  const user = await prisma.user.findFirst({
    where: { deletedAt: null, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, username: true },
  });
  if (!user) throw new Error('no active user in the database — run the seed or setup wizard first');

  const provider = new OpenRouterProvider(runtime.config);
  const startedAt = Date.now();
  const result = await provider.complete({
    model: runtime.config.modelDefault,
    messages: [
      { role: 'system', content: 'أنت فحص تشغيل تقني. أجب بكلمة واحدة فقط.' },
      { role: 'user', content: 'قل: جاهز' },
    ],
    maxTokens: 20,
  });

  // Smoke rides REPORT_NARRATIVE (the Phase-2 read-only operation) — the
  // closed AiOperationType enum has no dedicated smoke value on purpose.
  const log = await new AiAssistantRepository(prisma).createRequestLog({
    userId: user.id,
    operationType: 'REPORT_NARRATIVE',
    modelUsed: result.modelUsed,
    sourceModules: [],
    recordIds: [],
    tokensPrompt: result.usage.promptTokens,
    tokensCompletion: result.usage.completionTokens,
    outputSummary: 'smoke-test: provider connectivity check',
  });

  console.log(`[ai:smoke] ok in ${Date.now() - startedAt}ms`);
  console.log(`  model:   ${result.modelUsed}`);
  console.log(`  content: ${result.content.slice(0, 80)}`);
  console.log(`  usage:   prompt=${result.usage.promptTokens} completion=${result.usage.completionTokens}`);
  console.log(`  logged:  AiRequestLog ${log.id} (user ${user.username})`);
} finally {
  await prisma.$disconnect();
}
