import { apiPost } from './client';
import type {
  DecisionRequest,
  InterpretRequest,
  VoiceTurnResponse,
} from '@contractor-plus/shared';

export const voiceApi = {
  interpret: (body: InterpretRequest): Promise<VoiceTurnResponse> =>
    apiPost('/voice/interpret', body),

  decide: (body: DecisionRequest): Promise<VoiceTurnResponse> =>
    apiPost('/voice/decision', body),
};
