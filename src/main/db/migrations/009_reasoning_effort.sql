-- Add OpenAI reasoning effort (reasoning_effort) to provider configs.
-- Values: minimal/low/medium/high; NULL means 不设置 (not sent to the API).
ALTER TABLE provider_configs ADD COLUMN reasoning_effort TEXT;
