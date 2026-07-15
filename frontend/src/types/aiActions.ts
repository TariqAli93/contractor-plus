// Wire types for the AI tools/actions layer (mirror of the backend DTOs).

export interface ToolPreviewField {
  label: string;
  value: string;
}

export interface ToolPreviewChange {
  label: string;
  oldValue: string;
  newValue: string;
}

export interface ToolPreview {
  title: string;
  summary: string;
  fields: ToolPreviewField[];
  changes?: ToolPreviewChange[];
  warnings: string[];
}

/** A write the assistant proposed, awaiting the user's explicit confirmation. */
export interface PendingAction {
  actionId: string;
  toolName: string;
  title: string;
  normalizedArguments: Record<string, unknown>;
  preview: ToolPreview;
  warnings: string[];
  /** Secret fields (e.g. ['password']) the dialog must collect securely. */
  requiredSecrets: string[];
  expiresAt: string;
}

export interface ToolResult {
  toolName: string;
  module: string;
  summary: string;
  data: unknown;
}

export interface AgentTurnResult {
  message: string;
  pendingActions: PendingAction[];
  toolResults: ToolResult[];
}
