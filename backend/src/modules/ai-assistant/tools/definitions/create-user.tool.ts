import { createUserSchema, type CreateUserInput } from '../../../users/users.schemas.js';
import { ForbiddenError } from '../../../../shared/errors/forbidden.error.js';
import { ValidationError } from '../../../../shared/errors/validation.error.js';
import type { AiTool } from '../ai-tool.types.js';
import { parseArgs, fmtText } from '../tool-utils.js';

// The model NEVER sees or supplies a password — it is omitted from the schema
// the tool validates, supplied via ctx.secrets at confirm time, and never stored
// or logged. Privilege escalation is blocked precisely: the target role's
// effective permissions must be a SUBSET of the actor's (OWNER bypasses).
const userArgsSchema = createUserSchema.omit({ password: true });
type CreateUserArgs = Omit<CreateUserInput, 'password'>;

export const createUserTool: AiTool<CreateUserArgs> = {
  name: 'create_user',
  description: 'إنشاء مستخدم جديد باسم مستخدم ودور. كلمة المرور تُدخَل في نافذة التأكيد ولا تُرسل للنموذج.',
  requiredPermissions: ['ai.use', 'ai.apply-suggestions', 'users.create'],
  requiresConfirmation: true,
  requiredSecrets: ['password'],
  parametersSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['username', 'fullName', 'roleName'],
    properties: {
      username: { type: 'string', description: 'اسم المستخدم للدخول' },
      fullName: { type: 'string', description: 'الاسم الكامل' },
      email: { type: ['string', 'null'], description: 'البريد الإلكتروني' },
      phone: { type: ['string', 'null'], description: 'الهاتف' },
      roleName: { type: 'string', description: 'اسم الدور (لا يتجاوز صلاحيات المستخدم الحالي)' },
      isActive: { type: 'boolean', description: 'مفعّل', default: true },
    },
  },

  async validate(rawArgs, ctx) {
    const args = parseArgs(userArgsSchema, rawArgs) as CreateUserArgs;
    // Privilege escalation guard: a non-owner may only create a user whose role
    // grants no permission the actor lacks.
    if (!ctx.actor.isOwner) {
      const targetPerms = await ctx.services.access.permissionsForRole(args.roleName);
      const escalates = targetPerms.some((p) => !ctx.actor.permissions.has(p));
      if (escalates) {
        throw new ForbiddenError(
          'لا يمكنك إنشاء مستخدم بدور يمنح صلاحيات تتجاوز صلاحياتك.',
          'AI_ROLE_ESCALATION',
        );
      }
    }
    return args;
  },

  async preview(args) {
    return {
      title: 'إنشاء مستخدم جديد',
      summary: `سيتم إنشاء المستخدم «${args.username}» بدور «${args.roleName}».`,
      fields: [
        { label: 'اسم المستخدم', value: fmtText(args.username) },
        { label: 'الاسم الكامل', value: fmtText(args.fullName) },
        { label: 'الدور', value: fmtText(args.roleName) },
        { label: 'البريد', value: fmtText(args.email) },
        { label: 'مفعّل', value: args.isActive === false ? 'لا' : 'نعم' },
      ],
      warnings: ['أدخل كلمة مرور آمنة (٨ أحرف على الأقل) في نافذة التأكيد — لن تُرسل للنموذج ولا تُسجَّل.'],
    };
  },

  async execute(args, ctx) {
    const password = ctx.secrets?.password;
    if (!password || password.length < 8) {
      throw new ValidationError('كلمة المرور مطلوبة (٨ أحرف على الأقل) وتُدخَل في نافذة التأكيد.', {
        password: ['كلمة المرور مطلوبة'],
      });
    }
    const acting = { id: ctx.actor.userId, role: ctx.actor.role, actor: ctx.actor.audit };
    const created = await ctx.services.users.create({ ...args, password }, acting);
    return {
      recordId: created.id,
      module: 'users',
      summary: `تم إنشاء المستخدم «${created.username}».`,
      // The UserDto already excludes the hash; we still pick a safe subset.
      data: {
        id: created.id,
        username: created.username,
        fullName: created.fullName,
        isActive: created.isActive,
      },
    };
  },

  sanitizeResult(result) {
    return result.data;
  },
};
