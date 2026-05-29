import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@prisma/client';
import { DocumentTemplatesService } from './document-templates.service.js';
import { DocumentTemplatesController } from './document-templates.controller.js';

// Template management is OWNER/ADMIN-only — same gate as the rest of
// Settings. Contract generation + download are allowed for the wider
// finance/operations roles so engineers can produce a contract DOCX.
const MANAGE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];
const GENERATE_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
];

// Cached so the contract-scoped and generated-document routes share one
// controller instance (and thus one Service / Repository).
let cachedController: DocumentTemplatesController | null = null;

function getController(prisma: import('@prisma/client').PrismaClient): DocumentTemplatesController {
  if (!cachedController) {
    cachedController = new DocumentTemplatesController(new DocumentTemplatesService(prisma));
  }
  return cachedController;
}

// Mounted at /api/v1/templates
export const documentTemplatesRoutes: FastifyPluginAsync = async (fastify) => {
  const controller = getController(fastify.prisma);
  const manage = { preHandler: [fastify.authenticate, fastify.authorize(MANAGE_ROLES)] };
  const generate = { preHandler: [fastify.authenticate, fastify.authorize(GENERATE_ROLES)] };

  fastify.get('/', manage, controller.list);
  fastify.post('/', manage, controller.create);
  fastify.patch('/:id', manage, controller.update);
  fastify.delete('/:id', manage, controller.remove);
  fastify.post('/:id/set-default', manage, controller.setDefault);
  // Downloads gated to the wider GENERATE_ROLES so an engineer can preview
  // the template they're about to render against.
  fastify.get('/:id/download', generate, controller.downloadTemplate);
};

// Mounted at /api/v1/contracts — adds the generation endpoint that lives
// next to the existing contract routes for a cleaner URL hierarchy.
export const contractDocxRoutes: FastifyPluginAsync = async (fastify) => {
  const controller = getController(fastify.prisma);
  const generate = { preHandler: [fastify.authenticate, fastify.authorize(GENERATE_ROLES)] };

  fastify.post('/:id/generate-docx', generate, controller.generateContractDocx);
  fastify.get('/:id/generated-documents', generate, controller.listGeneratedForContract);
};

// Mounted at /api/v1/generated-documents
export const generatedDocumentsRoutes: FastifyPluginAsync = async (fastify) => {
  const controller = getController(fastify.prisma);
  const generate = { preHandler: [fastify.authenticate, fastify.authorize(GENERATE_ROLES)] };
  fastify.get('/:id/download', generate, controller.downloadGenerated);
};
