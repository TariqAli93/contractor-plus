import type { PrismaClient } from '@prisma/client';
import { AuditService, type AuditActor } from '../../audit/audit.service.js';
import { AccessService } from '../../rbac/access.service.js';
import { CustomersService } from '../../customers/customers.service.js';
import { ProjectsService } from '../../projects/projects.service.js';
import { ContractsService } from '../../contracts/contracts.service.js';
import { CostsService } from '../../costs/costs.service.js';
import { PaymentsService } from '../../payments/payments.service.js';
import { TemplatesService } from '../../templates/templates.service.js';
import { UsersService } from '../../users/users.service.js';
import { ReportsService } from '../../reports/reports.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import type { AiAssistantRepository } from '../ai-assistant.repository.js';
import type { AiSettingsService } from '../services/ai-settings.service.js';
import type { AiBudgetService } from '../services/ai-budget.service.js';
import { AiPendingActionRepository } from './ai-pending-action.repository.js';
import { AiToolExecutorService } from './ai-tool-executor.service.js';
import { AiToolConfirmationService } from './ai-tool-confirmation.service.js';
import { AiToolAgentService } from './ai-tool-agent.service.js';
import type { AgentTurnResult, PendingActionDto, ToolResultDto, ToolServices } from './ai-tool.types.js';

export interface ToolCaller {
  id: string;
  role: string;
}

export interface AiToolsServiceDeps {
  prisma: PrismaClient;
  settings: AiSettingsService;
  budget: AiBudgetService;
  aiRepo: AiAssistantRepository;
}

// Facade of the AI-tools layer. Owns the wiring: the domain services a tool may
// call (through their PUBLIC APIs only), the executor, the confirmation
// lifecycle, and the tool-calling agent. Every public method resolves the
// caller into a permission-scoped actor first.
export class AiToolsService {
  private readonly executor: AiToolExecutorService;
  private readonly confirmation: AiToolConfirmationService;
  private readonly agent: AiToolAgentService;

  constructor(deps: AiToolsServiceDeps) {
    const { prisma } = deps;
    const audit = new AuditService(prisma);
    const services: ToolServices = {
      customers: new CustomersService(prisma),
      projects: new ProjectsService(prisma),
      contracts: new ContractsService(prisma),
      costs: new CostsService(prisma),
      payments: new PaymentsService(prisma),
      templates: new TemplatesService(prisma),
      users: new UsersService(prisma),
      reports: new ReportsService(prisma),
      settings: new SettingsService(prisma),
      access: new AccessService(prisma),
      prisma,
    };
    this.executor = new AiToolExecutorService(services);
    this.confirmation = new AiToolConfirmationService({
      repo: new AiPendingActionRepository(prisma),
      aiRepo: deps.aiRepo,
      executor: this.executor,
      audit,
    });
    this.agent = new AiToolAgentService({
      settings: deps.settings,
      budget: deps.budget,
      aiRepo: deps.aiRepo,
      audit,
      executor: this.executor,
      confirmation: this.confirmation,
    });
  }

  // Shared with the conversational chat surface (ai-chat.service): a chat turn
  // reuses these to propose write tools through the SAME confirm→execute
  // lifecycle, so there is one write path, not two.
  get toolExecutor(): AiToolExecutorService {
    return this.executor;
  }

  get toolConfirmation(): AiToolConfirmationService {
    return this.confirmation;
  }

  async message(text: string, caller: ToolCaller, audit: AuditActor): Promise<AgentTurnResult> {
    const actor = await this.executor.resolveActor(caller, audit);
    return this.agent.run(text, actor);
  }

  async confirm(
    actionId: string,
    secrets: Record<string, string> | undefined,
    caller: ToolCaller,
    audit: AuditActor,
  ): Promise<ToolResultDto> {
    const actor = await this.executor.resolveActor(caller, audit);
    return this.confirmation.confirm(actionId, secrets, actor);
  }

  async reject(actionId: string, caller: ToolCaller, audit: AuditActor): Promise<void> {
    const actor = await this.executor.resolveActor(caller, audit);
    return this.confirmation.reject(actionId, actor);
  }

  async listPending(caller: ToolCaller, audit: AuditActor): Promise<PendingActionDto[]> {
    const actor = await this.executor.resolveActor(caller, audit);
    return this.confirmation.listPending(actor.userId);
  }
}
