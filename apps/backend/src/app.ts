import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import { env } from './config/env.js';
import { getStorage } from './lib/storage/storage.service.js';
import prismaPlugin from './plugins/prisma.plugin.js';
import authPlugin from './plugins/auth.plugin.js';
import rbacPlugin from './plugins/rbac.plugin.js';
import errorHandlerPlugin from './plugins/error-handler.plugin.js';
import requestContextPlugin from './plugins/request-context.plugin.js';
import tunnelPlugin from './plugins/tunnel.plugin.js';

import authRoutes from './modules/auth/auth.routes.js';
import customersRoutes from './modules/customers/customers.routes.js';
import materialsRoutes from './modules/materials/materials.routes.js';
import templatesRoutes from './modules/templates/templates.routes.js';
import contractsRoutes from './modules/contracts/contracts.routes.js';
import projectsRoutes from './modules/projects/projects.routes.js';
import { costsRoutes, projectCostsRoutes } from './modules/costs/costs.routes.js';
import {
  paymentsRoutes,
  projectPaymentsRoutes,
} from './modules/payments/payments.routes.js';
import reportsRoutes from './modules/reports/reports.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';
import tunnelRoutes from './modules/tunnel/tunnel.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';
import uploadsRoutes from './modules/uploads/uploads.routes.js';
import {
  contractDocxRoutes,
  documentTemplatesRoutes,
  generatedDocumentsRoutes,
} from './modules/document-templates/document-templates.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'development' ? 'info' : 'warn',
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
    trustProxy: true,
  });

  // Helmet — relax cross-origin resource policy so the SPA on a different
  // origin (vite dev: localhost:5173) can <img src="/uploads/..."> the
  // statically-served company assets.
  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });

  // Multipart parser for file uploads. Limits enforced here apply to every
  // request that uses request.file()/request.files(); the upload service
  // performs additional per-asset mime/extension checks.
  await app.register(multipart, {
    limits: {
      fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
      files: 1,
      fields: 4,
    },
  });

  // Public, read-only static serving for uploaded assets.
  //
  // IMPORTANT: we mount the PUBLIC ROOT only (not the full storage root),
  // so anything written under <root>/private/ is unreachable over HTTP no
  // matter what URL a client guesses. The prefix is `/uploads/public/...`
  // because the bucket name itself starts with "public/" — keeping the
  // disk layout and URL shape one-to-one makes audit traces trivial.
  const storage = getStorage();
  await app.register(fastifyStatic, {
    root: storage.getPublicRoot(),
    prefix: `${storage.getPublicPrefix()}/public/`,
    decorateReply: false,
    index: false,
    list: false,
    // 1 hour cache — assets are immutable per uploaded UUID; replacing an
    // asset writes a new UUID, so a short cache is safe even without
    // content hashes.
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });

  // Storage health surfaced on boot + via /health so operators can verify
  // the disk is writable without round-tripping an upload.
  const storageHealth = await storage.checkHealth();
  if (!storageHealth.ok) {
    app.log.error(
      { storage: storageHealth },
      '[storage] health check failed — uploads will fail until the issue is resolved',
    );
  } else {
    app.log.info(
      { root: storageHealth.root, publicRoot: storageHealth.publicRoot },
      '[storage] ready',
    );
  }

  await app.register(errorHandlerPlugin);
  await app.register(requestContextPlugin);
  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(rbacPlugin);
  await app.register(tunnelPlugin);

  app.get('/health', async () => {
    const health = await getStorage().checkHealth();
    return {
      status: health.ok ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      storage: {
        ok: health.ok,
        root: health.root,
        publicRoot: health.publicRoot,
        privateRoot: health.privateRoot,
        ...(health.error ? { error: health.error } : {}),
      },
    };
  });

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(customersRoutes, { prefix: '/api/v1/customers' });
  await app.register(materialsRoutes, { prefix: '/api/v1/materials' });
  await app.register(templatesRoutes, { prefix: '/api/v1/templates' });
  await app.register(contractsRoutes, { prefix: '/api/v1/contracts' });
  await app.register(projectsRoutes, { prefix: '/api/v1/projects' });
  await app.register(projectCostsRoutes, { prefix: '/api/v1/projects' });
  await app.register(projectPaymentsRoutes, { prefix: '/api/v1/projects' });
  await app.register(costsRoutes, { prefix: '/api/v1/costs' });
  await app.register(paymentsRoutes, { prefix: '/api/v1/payments' });
  await app.register(reportsRoutes, { prefix: '/api/v1/reports' });
  await app.register(auditRoutes, { prefix: '/api/v1/audit' });
  await app.register(tunnelRoutes, { prefix: '/api/v1/tunnel' });
  await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
  await app.register(uploadsRoutes, { prefix: '/api/v1/uploads' });
  // /api/v1/templates is already taken by the building-templates module
  // (used for estimation). Document templates therefore mount under
  // /api/v1/document-templates so neither module needs to be renamed.
  await app.register(documentTemplatesRoutes, { prefix: '/api/v1/document-templates' });
  await app.register(contractDocxRoutes, { prefix: '/api/v1/contracts' });
  await app.register(generatedDocumentsRoutes, { prefix: '/api/v1/generated-documents' });

  return app;
}
