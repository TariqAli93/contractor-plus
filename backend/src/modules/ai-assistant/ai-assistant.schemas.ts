// Validation schemas for the ai-assistant endpoints (same zod library as the
// rest of the modules). Phase 1 exposes only GET /ai/status, which takes no
// input — request/response schemas land with their phases:
//   Phase 2: narrative params (reportType)
//   Phase 3: ai-query.schema.ts (the closed NL→report whitelist)
//   Phase 4: guard/recommendation payloads
export {};
