-- OpenRouter-only migration — retire the former multi-provider AI settings.
--
-- The AI provider is now fixed to OpenRouter, so the persisted `ai.provider`
-- selection (openai / anthropic / groq / gemini / openrouter) is obsolete: drop
-- it. The previously-selected model is preserved ONLY when it looks like an
-- OpenRouter model id (vendor-prefixed, contains "/", e.g. "openai/gpt-4o-mini");
-- a bare provider-specific id (e.g. "claude-haiku-4-5", "gpt-4o-mini") is removed
-- so the app falls back to OPENROUTER_DEFAULT_MODEL. The encrypted API key
-- (`ai.apiKeyEnc`) and the enable/timeout/maxTokens rows are left untouched.
--
-- Settings live as JSONB rows in "system_settings"; there is no schema change.

DELETE FROM "system_settings" WHERE "key" = 'ai.provider';

DELETE FROM "system_settings"
WHERE "key" = 'ai.model'
  AND ("value" #>> '{}') NOT LIKE '%/%';
