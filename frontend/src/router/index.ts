import { createRouter, createWebHistory } from 'vue-router';
import { routes } from './routes';
import { requireSetup, requireAuth, requireRole } from './guards';

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

// Order matters: setup gate (desktop) → auth → role/permission.
router.beforeEach(requireSetup);
router.beforeEach(requireAuth);
router.beforeEach(requireRole);
