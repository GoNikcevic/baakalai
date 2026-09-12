-- 096: détail du relevance_score des signaux (facteurs générés par l'extraction LLM,
-- même présentation UI que les facteurs churn). Nullable — les signaux antérieurs
-- gardent leur badge score seul.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS relevance_factors JSONB;
