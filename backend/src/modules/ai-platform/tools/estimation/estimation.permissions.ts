// ============================================================
// EstimationTool permissions — the SINGLE definition of the permissions this
// tool needs, consumed by BOTH the tool's contributePermissions() and the RBAC
// catalog (via tool-permissions.ts). Kept in its own service-free module so the
// RBAC catalog can import it without pulling the estimation service graph (which
// reaches AccessService → rbac.catalog and would form an import cycle).
// ============================================================

import type { PermissionDef } from '../../../rbac/rbac.catalog.js';

const p = (key: string, module: string, action: string, displayName: string): PermissionDef => ({
  key,
  module,
  action,
  displayName,
});

export const ESTIMATION_PERMISSIONS: PermissionDef[] = [
  p('estimation_templates.read', 'estimation_templates', 'read', 'عرض قوالب التقدير'),
  p('estimation_templates.create', 'estimation_templates', 'create', 'إنشاء قالب تقدير'),
  p('estimation_templates.update', 'estimation_templates', 'update', 'تعديل قالب تقدير'),
  p('estimation_templates.delete', 'estimation_templates', 'delete', 'حذف قالب تقدير'),
  p('estimation_templates.ai_generate', 'estimation_templates', 'ai_generate', 'توليد قالب تقدير عبر المساعد الذكي'),
  p('materials.create_from_assistant', 'materials', 'create_from_assistant', 'إنشاء مادة عبر المساعد الذكي'),
];
