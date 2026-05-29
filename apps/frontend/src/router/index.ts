import { createRouter, createWebHistory } from 'vue-router';
import { routes } from './routes';
import { requireAuth, requireRole } from './guards';

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(requireAuth);
router.beforeEach(requireRole);
