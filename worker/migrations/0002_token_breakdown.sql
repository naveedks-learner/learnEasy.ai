-- Add input/output token columns for accurate cost tracking
ALTER TABLE transactions ADD COLUMN input_tokens INTEGER;
ALTER TABLE transactions ADD COLUMN output_tokens INTEGER;
