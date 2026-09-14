-- Migration 099 : recherche d'emails via la clé centrale baakalai (Dropcontact).
-- Option payante, opt-in : l'utilisateur confirme le coût avant chaque lot
-- (confirmCharge côté route). reveal_usage journalise chaque lot pour la
-- facturation de fin de mois — seuls les emails trouvés ET vérifiés sont
-- facturés (found), les soumissions sans résultat sont gratuites.

CREATE TABLE IF NOT EXISTS reveal_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'dropcontact',
  submitted INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Le plafond mensuel et le récap facturation agrègent par user et par mois.
CREATE INDEX IF NOT EXISTS idx_reveal_usage_user_month ON reveal_usage(user_id, created_at);
