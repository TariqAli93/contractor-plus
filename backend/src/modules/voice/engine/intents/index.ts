// ============================================================
// Intent registry composition root.
//
// The ONE place that wires concrete handlers + their domain dependencies.
// To add a command: implement an IntentHandler, then register it here. Nothing
// else in the engine changes. (Requirement 10 — maintainability.)
// ============================================================

import type { PrismaClient } from '@prisma/client';
import { ProjectsRepository } from '../../../projects/projects.repository.js';
import { ProjectsService } from '../../../projects/projects.service.js';
import { CustomersRepository } from '../../../customers/customers.repository.js';
import { TemplatesRepository } from '../../../templates/templates.repository.js';
import { ContractsService } from '../../../contracts/contracts.service.js';
import { ContractsRepository } from '../../../contracts/contracts.repository.js';
import { CostsService } from '../../../costs/costs.service.js';
import { CostsRepository } from '../../../costs/costs.repository.js';
import { PaymentsService } from '../../../payments/payments.service.js';
import { PaymentsRepository } from '../../../payments/payments.repository.js';
import { IntentRegistry } from '../intent-registry.js';
import { CreateProjectHandler } from './create-project.handler.js';
import { CreateContractHandler } from './create-contract.handler.js';
import { AddCostHandler } from './add-cost.handler.js';
import { AddPaymentHandler } from './add-payment.handler.js';
import { GenerateMaterialsHandler } from './generate-materials.handler.js';
import { LinkProjectContractHandler } from './link-project-contract.handler.js';
import { NavigateHandler } from './navigate.handler.js';
import { OpenEntityHandler } from './open-entity.handler.js';

export function buildIntentRegistry(prisma: PrismaClient): IntentRegistry {
  const registry = new IntentRegistry();

  const projects = new ProjectsRepository(prisma);
  const projectsService = new ProjectsService(prisma);
  const customers = new CustomersRepository(prisma);
  const templates = new TemplatesRepository(prisma);
  const contracts = new ContractsService(prisma);
  const contractsRepo = new ContractsRepository(prisma);
  const costs = new CostsService(prisma);
  const costsRepo = new CostsRepository(prisma);
  const payments = new PaymentsService(prisma);
  const paymentsRepo = new PaymentsRepository(prisma);

  registry.register(new CreateProjectHandler({ projects }));
  registry.register(new CreateContractHandler({ customers, templates, contracts, contractsRepo }));
  registry.register(new GenerateMaterialsHandler({ contracts }));
  registry.register(
    new LinkProjectContractHandler({ projects: projectsService, projectsRepo: projects, contractsRepo }),
  );
  registry.register(new AddCostHandler({ costs, costsRepo }));
  registry.register(new AddPaymentHandler({ payments, paymentsRepo, projectsRepo: projects }));
  registry.register(new NavigateHandler());
  registry.register(new OpenEntityHandler({ projects, customers, contractsRepo }));

  return registry;
}
