import type { RouteRecordRaw } from 'vue-router';
import { RoleName } from '@/types/enums';

const ALL_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
  RoleName.VIEWER,
];

const WRITE_CUSTOMERS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_MATERIALS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_TEMPLATES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_CONTRACTS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
// Projects diverge: ACCOUNTANT is read-only here. Operations writes only.
const WRITE_PROJECTS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ENGINEER];
const TUNNEL_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];
const COSTS_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT, RoleName.ENGINEER];
const PAYMENTS_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const REPORTS_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT, RoleName.ENGINEER];
const AUDIT_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];
const SETTINGS_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];
const USERS_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];
const RBAC_ROLES: RoleName[] = [RoleName.OWNER];

// Each route declares `meta.access` ({ permissions, roles }). The router guard
// resolves it via useAccess (permission-first, legacy-role fallback, OWNER
// always). Roles are kept as the legacy fallback during the Hybrid RBAC period.
export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/LoginView.vue'),
    meta: { layout: 'login', public: true },
  },
  {
    // First-run setup wizard (desktop/Electron only). The requireSetup guard
    // forces incomplete desktop installs here and blocks it everywhere else.
    path: '/setup',
    name: 'setup',
    component: () => import('@/views/setup/SetupWizardView.vue'),
    meta: { layout: 'setup', public: true },
  },
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/views/dashboard/DashboardView.vue'),
    meta: { layout: 'app', access: { permissions: ['dashboard.read'], roles: ALL_ROLES } },
  },

  // ----- Customers -----
  {
    path: '/customers',
    name: 'customers',
    component: () => import('@/views/customers/CustomersListView.vue'),
    meta: { layout: 'app', access: { permissions: ['customers.read'], roles: ALL_ROLES } },
  },
  {
    path: '/customers/new',
    name: 'customer-new',
    component: () => import('@/views/customers/CustomerEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['customers.create'], roles: WRITE_CUSTOMERS } },
  },
  {
    path: '/customers/:id',
    name: 'customer-edit',
    component: () => import('@/views/customers/CustomerEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['customers.update'], roles: WRITE_CUSTOMERS } },
  },

  // ----- Materials -----
  {
    path: '/materials',
    name: 'materials',
    component: () => import('@/views/materials/MaterialsListView.vue'),
    meta: { layout: 'app', access: { permissions: ['materials.read'], roles: ALL_ROLES } },
  },
  {
    path: '/materials/new',
    name: 'material-new',
    component: () => import('@/views/materials/MaterialEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['materials.create'], roles: WRITE_MATERIALS } },
  },
  {
    path: '/materials/:id',
    name: 'material-edit',
    component: () => import('@/views/materials/MaterialEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['materials.update'], roles: WRITE_MATERIALS } },
  },

  // ----- Templates -----
  {
    path: '/templates',
    name: 'templates',
    component: () => import('@/views/templates/TemplatesListView.vue'),
    meta: { layout: 'app', access: { permissions: ['templates.read'], roles: ALL_ROLES } },
  },
  {
    path: '/templates/new',
    name: 'template-new',
    component: () => import('@/views/templates/TemplateEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['templates.create'], roles: WRITE_TEMPLATES } },
  },
  {
    path: '/templates/:id',
    name: 'template-edit',
    component: () => import('@/views/templates/TemplateEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['templates.update'], roles: WRITE_TEMPLATES } },
  },

  // ----- Contracts -----
  {
    path: '/contracts',
    name: 'contracts',
    component: () => import('@/views/contracts/ContractsWorkspaceView.vue'),
    meta: { layout: 'app', access: { permissions: ['contracts.read'], roles: ALL_ROLES } },
  },
  {
    path: '/contracts/new',
    name: 'contract-new',
    component: () => import('@/views/contracts/ContractEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['contracts.create'], roles: WRITE_CONTRACTS } },
  },
  {
    path: '/contracts/:id',
    name: 'contract-edit',
    component: () => import('@/views/contracts/ContractEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['contracts.update'], roles: WRITE_CONTRACTS } },
  },

  // ----- Projects -----
  // Detail page is readable by all roles (accountants & viewers consult financial summaries).
  // Inside the view, write actions are permission-gated. /new is creation only.
  {
    path: '/projects',
    name: 'projects',
    component: () => import('@/views/projects/ProjectsWorkspaceView.vue'),
    meta: { layout: 'app', access: { permissions: ['projects.read'], roles: ALL_ROLES } },
  },
  {
    path: '/projects/new',
    name: 'project-new',
    component: () => import('@/views/projects/ProjectWizardView.vue'),
    meta: { layout: 'app', access: { permissions: ['projects.create'], roles: WRITE_PROJECTS } },
  },
  {
    path: '/projects/:id',
    name: 'project-edit',
    component: () => import('@/views/projects/ProjectEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['projects.read'], roles: ALL_ROLES } },
  },

  // ----- Tunnel (remote access) -----
  {
    path: '/tunnel',
    name: 'tunnel',
    component: () => import('@/views/tunnel/TunnelView.vue'),
    meta: { layout: 'app', access: { permissions: ['tunnel.manage'], roles: TUNNEL_ROLES } },
  },

  // ----- Costs -----
  {
    path: '/costs',
    name: 'costs',
    component: () => import('@/views/costs/CostsListView.vue'),
    meta: { layout: 'app', access: { permissions: ['costs.read'], roles: COSTS_ROLES } },
  },
  {
    path: '/costs/new',
    name: 'cost-new',
    component: () => import('@/views/costs/CostEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['costs.create'], roles: COSTS_ROLES } },
  },
  {
    path: '/costs/:id',
    name: 'cost-edit',
    component: () => import('@/views/costs/CostEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['costs.update'], roles: COSTS_ROLES } },
  },

  // ----- Payments -----
  {
    path: '/payments',
    name: 'payments',
    component: () => import('@/views/payments/PaymentsListView.vue'),
    meta: { layout: 'app', access: { permissions: ['payments.read'], roles: PAYMENTS_ROLES } },
  },
  {
    path: '/payments/new',
    name: 'payment-new',
    component: () => import('@/views/payments/PaymentEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['payments.create'], roles: PAYMENTS_ROLES } },
  },
  {
    path: '/payments/:id',
    name: 'payment-edit',
    component: () => import('@/views/payments/PaymentEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['payments.update'], roles: PAYMENTS_ROLES } },
  },

  // ----- Reports -----
  {
    path: '/reports',
    name: 'reports',
    component: () => import('@/views/reports/ReportsDashboardView.vue'),
    meta: { layout: 'app', access: { permissions: ['reports.read'], roles: REPORTS_ROLES } },
  },
  {
    path: '/reports/project-profitability',
    name: 'reports-profitability',
    component: () => import('@/views/reports/ProjectProfitabilityReportView.vue'),
    meta: { layout: 'app', access: { permissions: ['reports.read'], roles: REPORTS_ROLES } },
  },
  {
    path: '/reports/cash-flow',
    name: 'reports-cash-flow',
    component: () => import('@/views/reports/CashFlowReportView.vue'),
    meta: { layout: 'app', access: { permissions: ['reports.read'], roles: REPORTS_ROLES } },
  },
  {
    path: '/reports/overdue-payments',
    name: 'reports-overdue',
    component: () => import('@/views/reports/OverduePaymentsReportView.vue'),
    meta: { layout: 'app', access: { permissions: ['reports.read'], roles: REPORTS_ROLES } },
  },
  {
    path: '/reports/delayed-projects',
    name: 'reports-delayed',
    component: () => import('@/views/reports/DelayedProjectsReportView.vue'),
    meta: { layout: 'app', access: { permissions: ['reports.read'], roles: REPORTS_ROLES } },
  },

  // ----- Audit -----
  {
    path: '/audit',
    name: 'audit',
    component: () => import('@/views/audit/AuditLogsView.vue'),
    meta: { layout: 'app', access: { permissions: ['audit.read'], roles: AUDIT_ROLES } },
  },
  {
    path: '/audit/entity/:entity/:entityId',
    name: 'audit-entity',
    component: () => import('@/views/audit/AuditEntityHistoryView.vue'),
    meta: { layout: 'app', access: { permissions: ['audit.read'], roles: AUDIT_ROLES } },
  },
  {
    path: '/audit/user/:userId',
    name: 'audit-user',
    component: () => import('@/views/audit/AuditUserHistoryView.vue'),
    meta: { layout: 'app', access: { permissions: ['audit.read'], roles: AUDIT_ROLES } },
  },

  // ----- Settings -----
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/settings/SettingsView.vue'),
    meta: { layout: 'app', access: { permissions: ['settings.read'], roles: SETTINGS_ROLES } },
  },

  // ----- Users (administration) -----
  {
    path: '/users',
    name: 'users',
    component: () => import('@/views/users/UsersListView.vue'),
    meta: { layout: 'app', access: { permissions: ['users.read'], roles: USERS_ROLES } },
  },
  {
    path: '/users/new',
    name: 'user-new',
    component: () => import('@/views/users/UserEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['users.create'], roles: USERS_ROLES } },
  },
  {
    path: '/users/:id',
    name: 'user-edit',
    component: () => import('@/views/users/UserEditView.vue'),
    meta: { layout: 'app', access: { permissions: ['users.update'], roles: USERS_ROLES } },
  },

  // ----- Profile (self-service, any authenticated user) -----
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/views/profile/ProfileView.vue'),
    meta: { layout: 'app', access: { permissions: ['profile.read'], roles: ALL_ROLES } },
  },

  // ----- RBAC (role & permission management, OWNER only) -----
  {
    path: '/rbac',
    name: 'rbac',
    component: () => import('@/views/rbac/RbacView.vue'),
    meta: { layout: 'app', access: { permissions: ['rbac.manage'], roles: RBAC_ROLES } },
  },

  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { layout: 'app' },
  },
];
