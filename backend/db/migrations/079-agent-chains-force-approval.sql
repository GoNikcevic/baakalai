-- Force human-in-the-loop approval for deal_reactivation and auto_upsell.
-- Column defaults already have approval_required: true; this catches any row that was
-- manually toggled to false before the code-level enforcement (lib/agent-chains.js) was added.

UPDATE agent_chain_configs
SET deal_reactivation = jsonb_set(deal_reactivation, '{approval_required}', 'true'::jsonb),
    auto_upsell        = jsonb_set(auto_upsell, '{approval_required}', 'true'::jsonb),
    updated_at = now()
WHERE (deal_reactivation ->> 'approval_required') = 'false'
   OR (auto_upsell ->> 'approval_required') = 'false';
