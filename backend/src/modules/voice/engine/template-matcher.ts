// ============================================================
// Template Matcher — المرحلة الخامسة (Template Matching).
//
// Selects the BuildingTemplate that best fits a spoken project spec. Templates
// carry no structured area/frontage/depth columns — those live inside the
// template NAME (e.g. "بيت 100 متر طابقين — واجهة 5 نزال 20"). So we reuse the
// very same entity extractor on the template's name+description (DRY), then
// score each template against the spoken spec.
//
// NOTE: dimensions are used ONLY to *select* a template here. Material
// quantities are still computed downstream by ContractsService.generateEstimate
// (area × floors / 100m² baseline) — this matcher never invents financial data.
// ============================================================

import type { EntityBag } from '@contractor-plus/shared';
import { extractEntities } from '../nlu/entity-extractor.js';

export interface TemplateLike {
  id: string;
  name: string;
  description?: string | null;
}

export interface TemplateMatch<T extends TemplateLike = TemplateLike> {
  template: T;
  score: number;
  parsedSpec: EntityBag;
}

export interface TemplateMatchResult<T extends TemplateLike = TemplateLike> {
  ranked: TemplateMatch<T>[];
  best: TemplateMatch<T> | null;
  /** True when the top two candidates tie — the caller should ask which one. */
  ambiguous: boolean;
}

function scoreTemplate(spec: EntityBag, parsed: EntityBag): number {
  let score = 0;

  if (spec.projectType !== undefined && parsed.projectType !== undefined) {
    score += spec.projectType === parsed.projectType ? 3 : -3;
  }

  if (spec.area !== undefined && parsed.area !== undefined) {
    const diff = Math.abs(spec.area - parsed.area);
    // Exact area is the strongest signal; credit decays with distance.
    score += diff === 0 ? 4 : Math.max(0, 4 - diff / 10);
  }

  if (spec.frontage !== undefined && parsed.frontage !== undefined) {
    score += spec.frontage === parsed.frontage ? 2 : 0;
  }
  if (spec.depth !== undefined && parsed.depth !== undefined) {
    score += spec.depth === parsed.depth ? 2 : 0;
  }
  if (spec.floors !== undefined && parsed.floors !== undefined) {
    score += spec.floors === parsed.floors ? 1 : 0;
  }

  return score;
}

export function matchTemplates<T extends TemplateLike>(
  spec: EntityBag,
  templates: T[],
): TemplateMatchResult<T> {
  const ranked = templates
    .map((template) => {
      const parsedSpec = extractEntities(`${template.name} ${template.description ?? ''}`).bag;
      return { template, score: scoreTemplate(spec, parsedSpec), parsedSpec };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const best = top && top.score > 0 ? top : null;
  const second = ranked[1];
  const ambiguous = best !== null && second !== undefined && second.score === best.score;

  return { ranked, best, ambiguous };
}
