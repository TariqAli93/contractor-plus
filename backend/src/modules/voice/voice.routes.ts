import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
import { VoiceService } from './voice.service.js';
import { VoiceController } from './voice.controller.js';
import { VoiceLlmStore } from './nlu/llm/voice-llm.store.js';
import { VoiceSettingsController } from './voice-settings.controller.js';

// Entry to the assistant is gated by `voice.use`. Anything the command actually
// DOES is gated again, per action, inside the engine's PermissionEngine — so a
// VIEWER may open the assistant and navigate, but a create_project plan is
// rejected unless they also hold projects.create.
const VOICE_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
  RoleName.VIEWER,
];

// The LLM settings panel is an admin surface, gated like the rest of Settings.
const SETTINGS_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];

const voiceRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new VoiceService(fastify.prisma);
  const controller = new VoiceController(service);
  const settings = new VoiceSettingsController(new VoiceLlmStore(fastify.prisma));

  const guard = {
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({ permissions: ['voice.use'], roles: VOICE_ROLES }),
    ],
  };
  const settingsRead = {
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({ permissions: ['settings.read'], roles: SETTINGS_ROLES }),
    ],
  };
  const settingsManage = {
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({ permissions: ['settings.voice_ai.manage'], roles: SETTINGS_ROLES }),
    ],
  };

  fastify.post('/interpret', guard, controller.interpret);
  fastify.post('/decision', guard, controller.decide);

  // Settings → AI → Voice Assistant
  fastify.get('/settings', settingsRead, settings.get);
  fastify.patch('/settings', settingsManage, settings.update);
  fastify.post('/settings/test', settingsManage, settings.test);
};

export default voiceRoutes;
