/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AiToolDefinition } from '../../../lib/ai/ai-provider.interface.js';
import type { AiTool, ToolName } from './ai-tool.types.js';
import { createCustomerTool } from './definitions/create-customer.tool.js';
import { createProjectTool } from './definitions/create-project.tool.js';
import { createContractTool } from './definitions/create-contract.tool.js';
import { createExpenseTool } from './definitions/create-expense.tool.js';
import { createPaymentTool } from './definitions/create-payment.tool.js';
import { createTemplateTool } from './definitions/create-template.tool.js';
import { createUserTool } from './definitions/create-user.tool.js';
import { generateReportTool } from './definitions/generate-report.tool.js';
import { updateAppSettingsTool } from './definitions/update-app-settings.tool.js';

// The central, closed registry. The provider may ONLY invoke a name present
// here; the executor rejects anything else before any code runs (rule #6). Args
// generics are erased at this heterogeneous boundary — each tool's own
// validate→preview→execute chain keeps its types consistent by construction.
const ALL_TOOLS: ReadonlyArray<AiTool<any>> = [
  createCustomerTool,
  createProjectTool,
  createContractTool,
  createExpenseTool,
  createPaymentTool,
  createTemplateTool,
  createUserTool,
  generateReportTool,
  updateAppSettingsTool,
];

const REGISTRY: ReadonlyMap<string, AiTool<any>> = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): AiTool<any> | undefined {
  return REGISTRY.get(name);
}

export function listTools(): ReadonlyArray<AiTool<any>> {
  return ALL_TOOLS;
}

export function isRegisteredTool(name: string): name is ToolName {
  return REGISTRY.has(name);
}

/** Tool definitions in the OpenRouter wire shape (name + Arabic desc + JSON Schema). */
export function toolDefinitionsForProvider(): AiToolDefinition[] {
  return ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parametersSchema,
  }));
}
