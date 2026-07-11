import { RoleName } from '@contractor-plus/shared';

// ============================================================
// Permission catalog — the single, code-defined source of truth.
//
// Keys are STABLE strings (never generated at runtime). Permissions are seeded
// idempotently from this list. Removing an entry here does NOT delete the row
// from the DB (the seeder marks missing ones inactive instead).
// ============================================================

export interface PermissionDef {
  key: string;
  module: string;
  action: string;
  displayName: string;
}

// Module display order + Arabic labels live on the frontend (permissionGroups.*).
export const PERMISSION_MODULES = [
  'dashboard',
  'customers',
  'materials',
  'templates',
  'contracts',
  'projects',
  'costs',
  'payments',
  'change_orders',
  'reports',
  'audit',
  'tunnel',
  'settings',
  'users',
  'rbac',
  'profile',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

// Build a definition from an explicit key (kept literal for stability).
function p(key: string, module: PermissionModule, action: string, displayName: string): PermissionDef {
  return { key, module, action, displayName };
}

export const PERMISSION_CATALOG: PermissionDef[] = [
  p('dashboard.read', 'dashboard', 'read', 'عرض لوحة التحكم'),

  p('customers.read', 'customers', 'read', 'عرض العملاء'),
  p('customers.create', 'customers', 'create', 'إنشاء عميل'),
  p('customers.update', 'customers', 'update', 'تعديل عميل'),
  p('customers.delete', 'customers', 'delete', 'حذف عميل'),

  p('materials.read', 'materials', 'read', 'عرض المواد'),
  p('materials.create', 'materials', 'create', 'إنشاء مادة'),
  p('materials.update', 'materials', 'update', 'تعديل مادة'),
  p('materials.delete', 'materials', 'delete', 'حذف مادة'),

  p('templates.read', 'templates', 'read', 'عرض القوالب'),
  p('templates.create', 'templates', 'create', 'إنشاء قالب'),
  p('templates.update', 'templates', 'update', 'تعديل قالب'),
  p('templates.delete', 'templates', 'delete', 'حذف قالب'),

  p('contracts.read', 'contracts', 'read', 'عرض العقود'),
  p('contracts.create', 'contracts', 'create', 'إنشاء عقد'),
  p('contracts.update', 'contracts', 'update', 'تعديل عقد'),
  p('contracts.delete', 'contracts', 'delete', 'حذف عقد'),
  p('contracts.approve', 'contracts', 'approve', 'اعتماد عقد'),
  p('contracts.cancel', 'contracts', 'cancel', 'إلغاء عقد'),
  p('contracts.generate_docx', 'contracts', 'generate_docx', 'توليد مستند العقد'),

  p('projects.read', 'projects', 'read', 'عرض المشاريع'),
  p('projects.create', 'projects', 'create', 'إنشاء مشروع'),
  p('projects.update', 'projects', 'update', 'تعديل مشروع'),
  p('projects.delete', 'projects', 'delete', 'حذف مشروع'),
  p('projects.start', 'projects', 'start', 'بدء مشروع'),
  p('projects.pause', 'projects', 'pause', 'إيقاف مؤقت'),
  p('projects.resume', 'projects', 'resume', 'استئناف مشروع'),
  p('projects.complete', 'projects', 'complete', 'إنهاء مشروع'),
  p('projects.cancel', 'projects', 'cancel', 'إلغاء مشروع'),
  p('projects.unlink_contract', 'projects', 'unlink_contract', 'فك ربط عقد عن مشروع'),

  p('costs.read', 'costs', 'read', 'عرض المصاريف'),
  p('costs.create', 'costs', 'create', 'إنشاء مصروف'),
  p('costs.update', 'costs', 'update', 'تعديل مصروف'),
  p('costs.delete', 'costs', 'delete', 'حذف مصروف'),

  p('payments.read', 'payments', 'read', 'عرض الدفعات'),
  p('payments.create', 'payments', 'create', 'إنشاء دفعة'),
  p('payments.update', 'payments', 'update', 'تعديل دفعة'),
  p('payments.delete', 'payments', 'delete', 'حذف دفعة'),
  p('payments.mark_paid', 'payments', 'mark_paid', 'تأكيد دفع'),
  p('payments.cancel', 'payments', 'cancel', 'إلغاء دفعة'),

  p('change_orders.read', 'change_orders', 'read', 'عرض أوامر التغيير'),
  p('change_orders.create', 'change_orders', 'create', 'إنشاء أمر تغيير'),
  p('change_orders.update', 'change_orders', 'update', 'تعديل أمر تغيير'),
  p('change_orders.approve', 'change_orders', 'approve', 'اعتماد/رفض أمر تغيير'),
  p('change_orders.delete', 'change_orders', 'delete', 'حذف أمر تغيير'),

  p('reports.read', 'reports', 'read', 'عرض التقارير'),

  p('audit.read', 'audit', 'read', 'عرض سجل التدقيق'),

  p('tunnel.manage', 'tunnel', 'manage', 'إدارة النفق'),

  p('settings.read', 'settings', 'read', 'عرض الإعدادات'),
  p('settings.manage', 'settings', 'manage', 'إدارة الإعدادات'),
  p('settings.company.manage', 'settings', 'company.manage', 'إدارة بيانات الشركة'),
  p('settings.currency.manage', 'settings', 'currency.manage', 'إدارة العملات'),
  p('settings.contract_templates.manage', 'settings', 'contract_templates.manage', 'إدارة قوالب العقود'),

  p('users.read', 'users', 'read', 'عرض المستخدمين'),
  p('users.create', 'users', 'create', 'إنشاء مستخدم'),
  p('users.update', 'users', 'update', 'تعديل مستخدم'),
  p('users.delete', 'users', 'delete', 'حذف مستخدم'),
  p('users.reset_password', 'users', 'reset_password', 'إعادة تعيين كلمة المرور'),
  p('users.activate', 'users', 'activate', 'تفعيل/إيقاف مستخدم'),

  p('rbac.read', 'rbac', 'read', 'عرض الأدوار والصلاحيات'),
  p('rbac.manage', 'rbac', 'manage', 'إدارة الأدوار والصلاحيات'),

  p('profile.read', 'profile', 'read', 'عرض الملف الشخصي'),
  p('profile.update', 'profile', 'update', 'تعديل الملف الشخصي'),
  p('profile.change_password', 'profile', 'change_password', 'تغيير كلمة المرور'),
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.map((d) => d.key);
const KEY_SET = new Set(ALL_PERMISSION_KEYS);

export function isKnownPermission(key: string): boolean {
  return KEY_SET.has(key);
}

// ----- Default permission assignments per SYSTEM role (seed). -----
// These mirror the current role guards; custom roles start with none.

const PROFILE: string[] = ['profile.read', 'profile.update', 'profile.change_password'];

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, string[]> = {
  [RoleName.OWNER]: [...ALL_PERMISSION_KEYS],
  [RoleName.ADMIN]: [
    'dashboard.read',
    'customers.read', 'customers.create', 'customers.update', 'customers.delete',
    'materials.read', 'materials.create', 'materials.update', 'materials.delete',
    'templates.read', 'templates.create', 'templates.update', 'templates.delete',
    'contracts.read', 'contracts.create', 'contracts.update', 'contracts.delete', 'contracts.approve', 'contracts.cancel', 'contracts.generate_docx',
    'projects.read', 'projects.create', 'projects.update', 'projects.delete', 'projects.start', 'projects.pause', 'projects.resume', 'projects.complete', 'projects.cancel',
    'costs.read', 'costs.create', 'costs.update', 'costs.delete',
    'payments.read', 'payments.create', 'payments.update', 'payments.delete', 'payments.mark_paid', 'payments.cancel',
    'change_orders.read', 'change_orders.create', 'change_orders.update', 'change_orders.approve', 'change_orders.delete',
    'reports.read',
    'audit.read',
    'tunnel.manage',
    'settings.read', 'settings.manage', 'settings.company.manage', 'settings.currency.manage', 'settings.contract_templates.manage',
    'users.read', 'users.create', 'users.update', 'users.delete', 'users.reset_password', 'users.activate',
    'rbac.read', // ADMIN can view, but NOT rbac.manage
    ...PROFILE,
  ],
  [RoleName.ACCOUNTANT]: [
    'dashboard.read',
    'customers.read',
    'contracts.read',
    'projects.read',
    'costs.read', 'costs.create', 'costs.update', 'costs.delete',
    'payments.read', 'payments.create', 'payments.update', 'payments.delete', 'payments.mark_paid', 'payments.cancel',
    'change_orders.read', 'change_orders.create', 'change_orders.update', 'change_orders.approve', 'change_orders.delete',
    'reports.read',
    ...PROFILE,
  ],
  [RoleName.ENGINEER]: [
    'dashboard.read',
    'customers.read',
    'materials.read',
    'templates.read',
    'contracts.read',
    'projects.read', 'projects.create', 'projects.update', 'projects.start', 'projects.pause', 'projects.resume', 'projects.complete', 'projects.cancel',
    'costs.read', 'costs.create', 'costs.update', 'costs.delete',
    'payments.read',
    'change_orders.read',
    'reports.read',
    ...PROFILE,
  ],
  [RoleName.VIEWER]: [
    'dashboard.read',
    'customers.read',
    'materials.read',
    'templates.read',
    'contracts.read',
    'projects.read',
    'costs.read',
    'payments.read',
    'change_orders.read',
    ...PROFILE,
  ],
};
