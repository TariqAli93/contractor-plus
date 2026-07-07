import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import csrfProtection from '@fastify/csrf-protection';
import fastifyStatic from '@fastify/static';
import { PROTOCOL_VERSION } from '@contractor-plus/shared';

import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { getStorage } from './lib/storage/storage.service.js';

/** Backend package version, read once from package.json next to dist/. */
const APP_VERSION: string = (() => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url)); // .../dist
    const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
import prismaPlugin from './plugins/prisma.plugin.js';
import authPlugin from './plugins/auth.plugin.js';
import rbacPlugin from './plugins/rbac.plugin.js';
import errorHandlerPlugin from './plugins/error-handler.plugin.js';
import requestContextPlugin from './plugins/request-context.plugin.js';
import tunnelPlugin from './plugins/tunnel.plugin.js';

import authRoutes from './modules/auth/auth.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import profileRoutes from './modules/profile/profile.routes.js';
import rbacRoutes from './modules/rbac/rbac.routes.js';
import customersRoutes from './modules/customers/customers.routes.js';
import materialsRoutes from './modules/materials/materials.routes.js';
import templatesRoutes from './modules/templates/templates.routes.js';
import estimationTemplatesRoutes from './modules/estimation-templates/estimation-templates.routes.js';
import contractsRoutes from './modules/contracts/contracts.routes.js';
import projectsRoutes from './modules/projects/projects.routes.js';
import { costsRoutes, projectCostsRoutes } from './modules/costs/costs.routes.js';
import {
  changeOrdersRoutes,
  contractChangeOrdersRoutes,
} from './modules/change-orders/change-orders.routes.js';
import {
  paymentsRoutes,
  projectPaymentsRoutes,
} from './modules/payments/payments.routes.js';
import reportsRoutes from './modules/reports/reports.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';
import aiCommandRoutes from './modules/ai-command-workflow/ai-command-workflow.routes.js';
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

  // Rate limiting — a blanket per-IP ceiling on every route (a cheap DoS guard),
  // with far tighter per-route buckets layered on the auth endpoints (see
  // auth.routes.ts). `trustProxy` is enabled above, so behind the Cloudflare
  // tunnel the limiter keys on the real client IP (X-Forwarded-For), not the
  // loopback address the tunnel connects from. The 429 body is shaped like every
  // other API error so the SPA's axios error normalizer handles it uniformly.
  await app.register(rateLimit, {
    global: true,
    max: 1000,
    timeWindow: '1 minute',
    errorResponseBuilder: (request, context) => ({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: `Too many requests — please retry after ${context.after}.`,
      reqId: request.id,
    }),
  });

  // Cookies — required for the HttpOnly refresh-token cookie and the CSRF
  // double-submit secret. Registered before csrf-protection (its dependency).
  await app.register(cookie);

  // CSRF protection (double-submit). reply.generateCsrf() stores the validating
  // secret in this HttpOnly `_csrf` cookie; the matching token is mirrored into a
  // readable XSRF-TOKEN cookie the SPA echoes back in X-XSRF-TOKEN. Only the
  // cookie-authenticated endpoints opt in (auth.routes.ts) — Bearer-authenticated
  // routes carry the token in a header an attacker cannot forge, so they are not
  // CSRF-exposed.
  await app.register(csrfProtection, {
    cookieKey: '_csrf',
    cookieOpts: {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    },
    getToken: (req) => {
      const header = req.headers['x-xsrf-token'];
      return Array.isArray(header) ? header[0] : header;
    },
  });

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

  // Version handshake — consumed by the desktop client BEFORE it loads the app
  // to gate on a frontend⇄backend version match (the standard's "prevent Version
  // Mismatch" rule). Public + cheap; `schema` is best-effort so it still answers
  // when the DB is unreachable.
  app.get('/version', async () => {
    let schema: string | null = null;
    try {
      const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL
        ORDER BY finished_at DESC
        LIMIT 1`;
      schema = rows[0]?.migration_name ?? null;
    } catch {
      schema = null;
    }
    return { app: APP_VERSION, schema, protocol: PROTOCOL_VERSION };
  });

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(usersRoutes, { prefix: '/api/v1/users' });
  await app.register(profileRoutes, { prefix: '/api/v1/profile' });
  await app.register(rbacRoutes, { prefix: '/api/v1/rbac' });
  await app.register(customersRoutes, { prefix: '/api/v1/customers' });
  await app.register(materialsRoutes, { prefix: '/api/v1/materials' });
  await app.register(templatesRoutes, { prefix: '/api/v1/templates' });
  await app.register(estimationTemplatesRoutes, { prefix: '/api/v1/estimation-templates' });
  await app.register(contractsRoutes, { prefix: '/api/v1/contracts' });
  await app.register(contractChangeOrdersRoutes, { prefix: '/api/v1/contracts' });
  await app.register(projectsRoutes, { prefix: '/api/v1/projects' });
  await app.register(projectCostsRoutes, { prefix: '/api/v1/projects' });
  await app.register(projectPaymentsRoutes, { prefix: '/api/v1/projects' });
  await app.register(costsRoutes, { prefix: '/api/v1/costs' });
  await app.register(paymentsRoutes, { prefix: '/api/v1/payments' });
  await app.register(changeOrdersRoutes, { prefix: '/api/v1/change-orders' });
  await app.register(reportsRoutes, { prefix: '/api/v1/reports' });
  await app.register(auditRoutes, { prefix: '/api/v1/audit' });
  await app.register(aiCommandRoutes, { prefix: '/api/v1/ai-command' });
  await app.register(tunnelRoutes, { prefix: '/api/v1/tunnel' });
  await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
  await app.register(uploadsRoutes, { prefix: '/api/v1/uploads' });
  // /api/v1/templates is already taken by the building-templates module
  // (used for estimation). Document templates therefore mount under
  // /api/v1/document-templates so neither module needs to be renamed.
  await app.register(documentTemplatesRoutes, { prefix: '/api/v1/document-templates' });
  await app.register(contractDocxRoutes, { prefix: '/api/v1/contracts' });
  await app.register(generatedDocumentsRoutes, { prefix: '/api/v1/generated-documents' });

  // Serve the built SPA (Electron / standalone production). FRONTEND_DIST is an
  // absolute path to the compiled frontend `dist`. When unset (Vite dev), this
  // block is skipped entirely and Vite serves the SPA + proxies /api — so dev
  // behavior is unchanged.
  //
  // `wildcard: false` globs the dist and registers one route per real file
  // (index.html, hashed assets, …). Anything that doesn't map to a file falls
  // through to the not-found handler below, which returns the SPA shell so that
  // vue-router's history-mode deep links (e.g. /customers) resolve. API,
  // uploads, and health paths still return JSON 404s.
  const frontendDist = env.FRONTEND_DIST;
  if (frontendDist && existsSync(frontendDist)) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      wildcard: false,
      index: ['index.html'],
    });

    app.setNotFoundHandler((request, reply) => {
      const url = request.url;
      const isApiLike =
        request.method !== 'GET' ||
        url.startsWith('/api') ||
        url.startsWith('/uploads') ||
        url.startsWith('/health');
      if (isApiLike) {
        return reply.code(404).send({
          statusCode: 404,
          code: 'NOT_FOUND',
          message: `Route ${request.method}:${url} not found`,
          reqId: request.id,
        });
      }
      // SPA shell — vue-router takes over client-side routing.
      return reply.sendFile('index.html');
    });

    app.log.info({ frontendDist }, '[spa] serving built frontend');
  }

  return app;
}
