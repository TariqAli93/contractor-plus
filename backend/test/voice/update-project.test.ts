import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceIntent } from '@contractor-plus/shared';
import { UpdateProjectHandler } from '../../src/modules/voice/engine/intents/update-project.handler.js';
import { RuleBasedNluProvider } from '../../src/modules/voice/nlu/rule-based.provider.js';
import type { SessionContext } from '../../src/modules/voice/engine/voice.types.js';

const actor = { userId: 'u1', role: 'OWNER', ipAddress: '127.0.0.1', userAgent: 'test' };

function makeHandler(project: { id: string; name: string; status: string; startDate: Date | null }) {
  return new UpdateProjectHandler({
    projects: {},
    projectsRepo: {
      findFirstByName: async () => project,
      findById: async () => project,
    },
  } as unknown as ConstructorParameters<typeof UpdateProjectHandler>[0]);
}
const runPlan = (h: UpdateProjectHandler, transcript: string, context: SessionContext = {}) =>
  h.plan({ intent: 'update_project', bag: {}, context, actor, transcript });

test('complete an in-progress project → mutating, confirmable plan (projects.update)', async () => {
  const h = makeHandler({ id: 'p1', name: 'فيلا أحمد', status: 'IN_PROGRESS', startDate: new Date() });
  const plan = await runPlan(h, 'أنجز مشروع فيلا أحمد');
  assert.equal(plan.side, 'server');
  assert.equal(plan.mutates, true);
  assert.deepEqual(plan.requiredPermissions, ['projects.update']);
  assert.ok(plan.summary.lines.some((l) => l.value === 'إنجاز'));
});

test('completing a PLANNED project is rejected at plan time (no pointless confirm)', async () => {
  const h = makeHandler({ id: 'p2', name: 'دار', status: 'PLANNED', startDate: null });
  await assert.rejects(() => runPlan(h, 'أنجز المشروع', { lastProjectId: 'p2' }), /لا يمكن إنجاز/);
});

test('pause an in-progress project', async () => {
  const h = makeHandler({ id: 'p3', name: 'عمارة', status: 'IN_PROGRESS', startDate: new Date() });
  const plan = await runPlan(h, 'أوقف المشروع', { lastProjectId: 'p3' });
  assert.ok(plan.summary.lines.some((l) => l.value === 'إيقاف'));
});

test('a vague verb with no concrete action → clarify', async () => {
  const h = makeHandler({ id: 'p4', name: 'x', status: 'IN_PROGRESS', startDate: new Date() });
  await assert.rejects(() => runPlan(h, 'عدّل المشروع', { lastProjectId: 'p4' }), /ما التغيير/);
});

test('rule-based NLU routes "أنجز المشروع" to UPDATE_PROJECT', async () => {
  const nlu = new RuleBasedNluProvider();
  const r = await nlu.interpret('أنجز المشروع', { locale: 'ar' });
  assert.equal(r.intent, VoiceIntent.UPDATE_PROJECT);
});
