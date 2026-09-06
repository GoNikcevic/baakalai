-- 064: Durcissement RLS / exposition PostgREST
--
-- Contexte : l'application n'utilise PAS PostgREST. Le frontend n'embarque aucun
-- client Supabase et le backend se connecte en direct via `pg` (DATABASE_URL),
-- ce qui bypasse RLS. Ces policies ne gouvernent donc que l'API REST publique
-- exposée par Supabase avec la clé `anon` — clé publique par nature, présente
-- dans tout bundle client.
--
-- Aucun impact applicatif attendu.

-- ============================================================
-- P0 — public.users lisible ET modifiable par le rôle anon
-- ============================================================
-- La policy "Service role full access" était USING(true)/WITH CHECK(true) SANS
-- clause TO → appliquée à tous les rôles. Combinée aux grants complets sur anon
-- et authenticated, elle exposait password_hash, reset_token et
-- verification_token en lecture et en écriture via /rest/v1/users.

REVOKE ALL ON public.users FROM anon, authenticated;

DROP POLICY IF EXISTS "Service role full access" ON public.users;
CREATE POLICY "Service role full access" ON public.users
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- P1 — memory_patterns lisible sans authentification
-- ============================================================
-- La mémoire est un pool volontairement mutualisé entre clients (décision
-- produit), mais rien ne justifie de l'ouvrir aux non-authentifiés. Les deux
-- policies n'avaient pas de clause TO.

DROP POLICY IF EXISTS "Everyone reads memory" ON public.memory_patterns;
CREATE POLICY "Authenticated read memory" ON public.memory_patterns
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert memory" ON public.memory_patterns;
CREATE POLICY "Service role insert memory" ON public.memory_patterns
  FOR INSERT TO service_role WITH CHECK (true);

-- ============================================================
-- P1 — Fonctions SECURITY DEFINER exécutables par anon
-- ============================================================
-- get_dashboard_kpis prend le user_id en paramètre sans jamais le confronter à
-- auth.uid() : les KPI de n'importe quel utilisateur sont lisibles si l'on
-- connaît son uuid. rls_auto_enable est un utilitaire de migration.
--
-- ⚠️ Révoquer sur anon/authenticated ne suffit PAS : Postgres accorde EXECUTE à
-- PUBLIC par défaut sur les fonctions, et anon en hérite. Il faut révoquer sur
-- PUBLIC puis re-grant explicitement à service_role.
--
-- Note : ces deux fonctions n'ont AUCUN appelant applicatif (vérifié par grep
-- sur tout le backend). Candidates à la suppression pure et simple.

REVOKE ALL ON FUNCTION public.get_dashboard_kpis(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;

-- ============================================================
-- P1 — search_path mutable (search_path hijacking)
-- ============================================================

ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_memory_patterns_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_dashboard_kpis(uuid) SET search_path = public, pg_temp;
