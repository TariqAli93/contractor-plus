// ============================================================
// create_contract handler — the compound, financial intent.
//
// One atomic turn (all steps in a single transaction):
//   find-or-create Customer → match BuildingTemplate → create DRAFT Contract
//   → generateEstimate (Material Intelligence).
//
// Financial discipline (per project rules):
//  • meterPrice is a REQUIRED slot — never defaulted/guessed.
//  • floors is a REQUIRED slot — it drives material + price scaling.
//  • the contract number is auto-generated (V-YYYY-NNNN) and surfaced for review.
//  • pricing/material math is NOT duplicated here — it reuses ContractsService's
//    createWithinTx + generateEstimateWithinTx (the authoritative engine).
//  • the template's suggested meter price is shown DURING confirmation, as a
//    read-only comparison, via ContractsService.previewEstimate.
// ============================================================

import type { Prisma } from '@prisma/client';
import { VoiceIntent, type CreatedEntityRef, type EntityBag } from '@contractor-plus/shared';
import { money, round, toMoneyString } from '../../../../lib/money.js';
import { toJsonValue } from '../../../../shared/utils/json.js';
import type { ContractsService } from '../../../contracts/contracts.service.js';
import type { ContractsRepository } from '../../../contracts/contracts.repository.js';
import type { CustomersRepository } from '../../../customers/customers.repository.js';
import type { TemplatesRepository } from '../../../templates/templates.repository.js';
import { firstNumber, firstScaledMoney } from '../../nlu/entity-extractor.js';
import { ClarifyError } from '../clarify-error.js';
import { matchTemplates } from '../template-matcher.js';
import type {
  CompensationContext,
  IntentHandler,
  Plan,
  PlanInput,
  PlanStep,
  SlotDef,
} from '../voice.types.js';

export interface CreateContractHandlerDeps {
  customers: CustomersRepository;
  templates: TemplatesRepository;
  contracts: ContractsService;
  contractsRepo: ContractsRepository;
}

const PERMS = ['contracts.create', 'customers.create', 'templates.read'];

export class CreateContractHandler implements IntentHandler {
  readonly intent = VoiceIntent.CREATE_CONTRACT;

  readonly requiredSlots: SlotDef[] = [
    {
      name: 'customerName',
      read: (b) => b.customerName,
      question: 'باسم مَن يكون العقد؟',
      fillFromAnswer: (b, u) => {
        const t = u.trim();
        if (t && firstNumber(t) === null) {
          b.customerName = t;
          return true;
        }
        return false;
      },
    },
    {
      name: 'area',
      read: (b) => b.area,
      question: 'ما مساحة البناء بالمتر المربع؟',
      fillFromAnswer: numericFiller((b, n) => (b.area = n)),
    },
    {
      name: 'floors',
      read: (b) => b.floors,
      question: 'كم عدد الطوابق؟',
      fillFromAnswer: numericFiller((b, n) => (b.floors = n)),
    },
    {
      name: 'meterPrice',
      read: (b) => b.meterPrice,
      question: 'ما سعر المتر؟',
      fillFromAnswer: (b, u) => {
        const n = firstScaledMoney(u);
        if (n !== null) {
          b.meterPrice = n;
          return true;
        }
        return false;
      },
    },
  ];

  constructor(private readonly deps: CreateContractHandlerDeps) {}

  async plan(input: PlanInput): Promise<Plan> {
    const { bag } = input;
    const customerName = String(bag.customerName);
    const area = Number(bag.area);
    const floors = Number(bag.floors);
    const meterPrice = Number(bag.meterPrice);

    // ----- Template Matching (المرحلة 5) -----
    const templates = await this.deps.templates.findMany({
      isActive: true,
      skip: 0,
      take: 500,
      sortBy: 'name',
      sortDir: 'asc',
    });
    const match = matchTemplates(bag, templates);
    if (!match.best) {
      throw new ClarifyError(
        'لم أجد قالباً مطابقاً. حدّد نوع المشروع (بيت/عمارة) والمساحة.',
        'template',
      );
    }
    const template = match.best.template;

    // ----- Read-only enrichments for the confirmation -----
    const existing = await this.deps.customers.findByName(customerName);
    const customerExists = existing.length > 0;
    const preview = await this.deps.contracts.previewEstimate(template.id, area, floors, null);
    const totalPrice = round(money(area).times(floors).times(meterPrice));

    const step: PlanStep = {
      description: `إنشاء عقد للعميل "${customerName}" على القالب "${template.name}"`,
      requiredPermissions: PERMS,
      execute: async (ctx) => {
        const created: CreatedEntityRef[] = [];

        // 1. find-or-create customer
        const found = await this.deps.customers.findByName(customerName, ctx.tx);
        let customer = found[0];
        let createdCustomerId: string | undefined;
        if (!customer) {
          customer = await this.deps.customers.create({ name: customerName }, ctx.tx);
          createdCustomerId = customer.id;
          await ctx.audit.log(
            ctx.actor,
            {
              action: 'CREATE',
              entity: 'Customer',
              entityId: customer.id,
              newValues: toJsonValue({ ...customer, source: 'voice' }),
            },
            ctx.tx,
          );
          created.push({ type: 'Customer', id: customer.id, label: customerName });
        }

        // 2. unique contract number (within the same tx)
        const year = new Date().getFullYear();
        const contractNumber = await generateContractNumber(ctx.tx, year);

        // 3. DRAFT contract (authoritative create — totalPrice computed there)
        const contract = await this.deps.contracts.createWithinTx(
          ctx.tx,
          {
            contractNumber,
            customerId: customer.id,
            templateId: template.id,
            buildingArea: area,
            floors,
            meterPrice,
            expectedProfitMargin: null,
            notes: 'أُنشئ عبر الأوامر الصوتية',
          },
          ctx.actor,
        );
        created.push({ type: 'Contract', id: contract.id, label: contractNumber });

        // 4. Material Intelligence — populate items + compute suggestion
        const estimate = await this.deps.contracts.generateEstimateWithinTx(
          ctx.tx,
          contract.id,
          ctx.actor,
        );

        return {
          createdEntities: created,
          outputs: {
            contractId: contract.id,
            contractNumber,
            customerId: customer.id,
            ...(createdCustomerId ? { createdCustomerId } : {}),
          },
          message:
            `تم إنشاء العقد ${contractNumber} للعميل ${customerName} ` +
            `مع ${estimate.itemsReplaced} مادة. ` +
            `سعر مترك: ${meterPrice.toLocaleString('en-US')} | ` +
            `المقترح من القالب: ${estimate.suggestedMeterPrice ?? '—'}.`,
        };
      },
    };

    return {
      intent: this.intent,
      side: 'server',
      mutates: true,
      requiredPermissions: PERMS,
      steps: [step],
      summary: {
        title: 'سيتم إنشاء عقد جديد',
        mutates: true,
        lines: [
          { label: 'العميل', value: `${customerName}${customerExists ? ' (موجود)' : ' (جديد)'}` },
          { label: 'القالب', value: template.name },
          { label: 'المساحة', value: `${area} م²` },
          { label: 'عدد الطوابق', value: String(floors) },
          { label: 'سعر المتر (المُدخل)', value: meterPrice.toLocaleString('en-US') },
          { label: 'السعر الإجمالي', value: toMoneyString(totalPrice) },
          {
            label: 'سعر المتر المقترح من القالب',
            value: preview.suggestedMeterPrice ?? 'غير متوفر',
          },
          { label: 'رقم العقد', value: 'يُولَّد تلقائياً عند التنفيذ' },
        ],
      },
    };
  }

  summarize(bag: EntityBag): string {
    return `إنشاء عقد باسم ${bag.customerName ?? '—'}`;
  }

  async compensate(outputs: Record<string, unknown>, ctx: CompensationContext): Promise<void> {
    const contractId = outputs.contractId;
    if (typeof contractId === 'string') {
      await this.deps.contractsRepo.softDelete(contractId, ctx.tx);
      await ctx.audit.log(
        ctx.actor,
        {
          action: 'DELETE',
          entity: 'Contract',
          entityId: contractId,
          oldValues: toJsonValue({ event: 'voice_workflow_compensation' }),
        },
        ctx.tx,
      );
    }
    // Only undo the customer if THIS intent created it (don't delete a reused one).
    const createdCustomerId = outputs.createdCustomerId;
    if (typeof createdCustomerId === 'string') {
      await this.deps.customers.softDelete(createdCustomerId, ctx.tx);
      await ctx.audit.log(
        ctx.actor,
        {
          action: 'DELETE',
          entity: 'Customer',
          entityId: createdCustomerId,
          oldValues: toJsonValue({ event: 'voice_workflow_compensation' }),
        },
        ctx.tx,
      );
    }
  }
}

function numericFiller(
  assign: (bag: EntityBag, n: number) => void,
): (bag: EntityBag, utterance: string) => boolean {
  return (bag, utterance) => {
    const n = firstNumber(utterance);
    if (n !== null) {
      assign(bag, n);
      return true;
    }
    return false;
  };
}

/** Next sequential contract number for the year: V-YYYY-0001, V-YYYY-0002, … */
async function generateContractNumber(tx: Prisma.TransactionClient, year: number): Promise<string> {
  const prefix = `V-${year}-`;
  const last = await tx.contract.findFirst({
    where: { contractNumber: { startsWith: prefix } },
    orderBy: { contractNumber: 'desc' },
    select: { contractNumber: true },
  });
  let seq = 1;
  if (last) {
    const parsed = Number.parseInt(last.contractNumber.slice(prefix.length), 10);
    if (Number.isFinite(parsed)) seq = parsed + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}
