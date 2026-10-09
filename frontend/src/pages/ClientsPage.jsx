/* ===============================================================================
   BAKAL · Clients Page
   Import contacts from CRM, follow deals and clients, manage relationships.
   Click a client to open detail panel with timeline + emails + actions.
   =============================================================================== */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { request } from '../services/api-client';
import { showToast } from '../services/notifications';
import { getUser } from '../services/auth';
import { useT, useI18n } from '../i18n';
import CRMDiagnosticReport from '../components/CRMDiagnosticReport';
import { accountFirstLines } from '../components/ContactSubline';
import ProductLineTags from '../components/ProductLineTags';
import Icon from '../components/Icon';
import EmailComposer from '../components/EmailComposer';
import AccountSheet from '../components/AccountSheet';

const TILE_COLORS = [
  'var(--text-muted)', 'var(--blue)', 'var(--accent)',
  'var(--warning)', 'var(--purple)', 'var(--success)',
];

/**
 * Largeurs des colonnes de la ligne de SOCIÉTÉ · lot 7, écran 1.
 *
 * Partagées entre l'en-tête et les lignes, et c'est tout l'intérêt de les
 * sortir ici : deux litéraux séparés se désalignent au premier ajustement, et
 * un désalignement d'une colonne de montants se lit comme une erreur de
 * chiffre. La liste imbrique des lignes de contact sous chaque société, donc un
 * <table> HTML ne convenait pas · d'où des largeurs fixes plutôt qu'un vrai
 * tableau.
 */
const COL = { ouvert: 104, gagne: 104, silence: 88, risque: 124, proprietaire: 104 };

/**
 * Le risque d'une société, nommé avant d'être coloré.
 *
 * « Jamais la couleur seule » : une bande de sévérité DONNE la forme, le mot
 * donne le sens, et le chiffre vient après. Un écran lu en noir et blanc, ou
 * par quelqu'un qui distingue mal le rouge du vert, doit rester lisible.
 *
 * ── Les seuils sont ceux du PRODUIT ─────────────────────────────────────────
 *
 * 60 pour « à risque », 76 pour « critique » · les mêmes que
 * `lib/churn-scoring.AT_RISK_THRESHOLD` et que la page Clients à risque. La
 * ligne de CONTACT, plus bas dans ce fichier, colore encore sur une échelle à
 * 26/51/76 : c'est une divergence connue et antérieure, qui porte sur le score
 * d'un contact et non d'une société. Je ne l'aligne pas ici pour ne pas
 * changer en passant ce que la ligne de contact affiche.
 *
 * ── « Non scorable » n'est pas « sain » ─────────────────────────────────────
 *
 * Un compte sans score ne vaut PAS zéro. Un compte muet, sans interlocuteur
 * rattaché, n'est pas un compte en bonne santé : il est hors de portée du
 * scoring et de tout envoi. Les confondre ferait passer un angle mort pour un
 * bon résultat, et c'est exactement ce qu'un écran de pilotage ne doit pas
 * faire.
 */
function BandeRisque({ score, sansFiche, t }) {
  const bande = (couleur, libelle, chiffre, aide) => (
    <span
      title={aide}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}
    >
      <span style={{ width: 3, height: 12, borderRadius: 2, background: couleur, flexShrink: 0 }} />
      <span style={{ color: couleur === 'var(--border)' ? 'var(--text-muted)' : couleur }}>
        {libelle}{chiffre == null ? '' : ` ${chiffre}`}
      </span>
    </span>
  );

  if (score == null) {
    return bande(
      'var(--border)',
      t('clients.riskNotScorable'),
      null,
      sansFiche ? t('clients.riskNotScorableNoAccount') : t('clients.riskNotScorableYet')
    );
  }
  if (score >= 76) return bande('var(--danger)', t('clients.riskCritical'), score);
  if (score >= 60) return bande('var(--warning)', t('clients.riskHigh'), score);
  return bande('var(--success)', t('clients.riskHealthy'), score);
}

const STATUS_COLORS = {
  new: 'var(--text-muted)', imported: 'var(--blue)', interested: 'var(--accent)',
  meeting: 'var(--warning)', negotiation: 'var(--purple)', won: 'var(--success)', lost: 'var(--danger)',
};

// Only ever rendered when 2+ CRMs are actually connected · see crmProviderCounts.
const CRM_DOT_COLORS = {
  pipedrive: '#2A2AA0', hubspot: '#FF7A59', salesforce: '#00A1E0',
  odoo: '#714B67', notion: '#37352F', airtable: '#F82B60',
};

/** Seuil « à risque » du churn. Même valeur que le backend
 *  (lib/churn-scoring.js, AT_RISK_THRESHOLD), qui sert au badge de la nav et à
 *  la page Clients à risque : cette page comptait à 50 et annonçait donc un
 *  autre nombre que le reste du produit pour la même question. */
const AT_RISK_THRESHOLD = 60;

/**
 * La fiche de droite, commune aux deux panneaux de cette page.
 *
 * Elle est COLLANTE, et ce n'est pas un raffinement : le panneau vivait dans
 * le flux normal, donc il se posait en haut du conteneur. Ouvrir un contact
 * depuis le bas d'une longue liste ouvrait sa fiche hors de l'écran, et il
 * fallait remonter tout en haut pour la lire, puis redescendre pour cliquer le
 * suivant. Sur un compte à plusieurs interlocuteurs, c'est un aller-retour par
 * personne.
 *
 * Deux conditions pour que ça marche, et l'oubli de l'une annule l'autre :
 * le conteneur doit porter `alignItems: flex-start` (sinon flex étire le
 * panneau sur toute la hauteur et sticky n'a plus de course), et la hauteur
 * maximale doit se mesurer sur la FENÊTRE et non sur la liste, sinon une fiche
 * plus haute que l'écran ne peut plus être lue jusqu'au bout.
 */
const DETAIL_PANEL_STYLE = {
  // 36 % et non 44 % : à 44 % la liste n'avait plus assez de largeur pour ses
  // colonnes fixes (cf. COL) et les noms de société tronquaient à quelques
  // lettres ("Nov...") dès que la fiche était ouverte. La fiche elle-même n'a
  // pas besoin d'autant de largeur, son contenu (timeline, lignes de
  // produits) tient très bien en colonne plus étroite.
  flex: '0 0 36%',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 20,
  position: 'sticky',
  top: 16,
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
};

/** Seuils de silence d'un deal en cours. Ils ne servent plus qu'à COLORER la
 *  liste : le découpage en tranches et les compteurs des tuiles sont calculés
 *  en base (backend/lib/account-list.js), sur toute la base et non sur ce qui
 *  est affiché. Les deux jeux de valeurs doivent rester identiques, sinon la
 *  couleur d'une ligne et la tuile qui la compte se contrediraient. Un deal
 *  muet depuis un mois se relance, muet depuis deux il est au point mort. */
const DEAL_DORMANT_DAYS = 30;
const DEAL_STALLED_DAYS = 60;

// Jours écoulés depuis une date. null quand la date est absente ou illisible :
// « on ne sait pas » ne doit jamais se confondre avec « contacté aujourd'hui ».
function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

// Un deal muet depuis deux mois n'est pas « un peu en retard » : la couleur le
// dit avant que le chiffre soit lu. Sans activité connue, gris et jamais rouge,
// pour ne pas transformer une donnée manquante en alerte.
function silenceColor(days) {
  if (days == null) return 'var(--text-muted)';
  if (days > DEAL_STALLED_DAYS) return 'var(--danger)';
  if (days > DEAL_DORMANT_DAYS) return 'var(--warning)';
  return 'var(--success)';
}

function getStatusLabels(lang) {
  if (lang === 'en') return { new: 'New', imported: 'Imported', interested: 'Interested', meeting: 'Meeting', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
  return { new: 'Nouveau', imported: 'Import\u00e9', interested: 'Int\u00e9ress\u00e9', meeting: 'RDV', negotiation: 'N\u00e9go', won: 'Gagn\u00e9', lost: 'Perdu' };
}

/**
 * Vue globale des contacts CRM, cadrée sur une population.
 *
 * `scope` partitionne la table `opportunities`, qui mélange deals en cours et
 * clients gagnés :
 *   'deals'   → tout sauf gagné (importé, nouveau, intéressé, RDV, perdu)
 *   'clients' → gagné uniquement
 *   absent    → tout (aucune route ne l'utilise, gardé pour un usage direct)
 *
 * La partition est exhaustive : aucun contact ne devient inatteignable. Même
 * composant pour les deux entrées de nav, sur le modèle de ReactivationQueuePage
 * · une seule page, deux cadrages, plutôt que deux pages à maintenir.
 *
 * Un lien profond porteur de `highlight` court-circuite la portée : il désigne
 * des contacts précis, et les masquer parce qu'ils sont dans l'autre population
 * transformerait le lien en page vide.
 */
export default function ClientsPage({ scope }) {
  // Une page de COMPTES, telle que le serveur la rend. `clients` en dérive :
  // c'est la liste à plat des contacts de cette page, et tout ce que la page
  // faisait déjà avec continue de marcher dessus.
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [connectedCrm, setConnectedCrm] = useState(null);
  const [connectedProviders, setConnectedProviders] = useState([]);
  const [owners, setOwners] = useState([]);
  const [ownerFilter, setOwnerFilter] = useState('all');
  // Comptes dépliés · un Set et non un id unique, pour qu'on puisse en ouvrir
  // plusieurs et les comparer sans perdre le premier.
  const [expandedAccounts, setExpandedAccounts] = useState(() => new Set());
  // La SOCIETE ouverte dans le panneau de droite.
  //
  // Exclusive du contact : un seul panneau a la fois, sinon le clic suivant ne
  // dit plus ce qu'il remplace. Cliquer une societe ferme donc le contact
  // ouvert, et reciproquement · c'est fait dans les deux poseurs ci-dessous
  // plutot que par un effet, pour que la cause soit lisible la ou on clique.
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  // Exception à la règle ci-dessus, et la seule : un contact ouvert DEPUIS la
  // fiche d'une société laisse `selectedAccountId` posé. Le panneau de contact
  // le recouvre, et « Retour à <société> » n'a qu'à retirer le contact.
  const [nomCompteRetour, setNomCompteRetour] = useState('');
  const fermerPanneaux = () => {
    setSelectedClient(null);
    setSelectedAccountId(null);
  };
  // Le contact de la fiche société n'a que les champs de la fiche (pas de
  // score, pas de propriétaire). On reprend la ligne complète de la liste quand
  // elle est chargée ; sinon celle de la fiche, à qui l'on rend la société
  // qu'elle ne porte pas, pour que l'en-tête du panneau la nomme.
  const ouvrirContactDuCompte = (contact, compte) => {
    const complet = groups.flatMap(g => g.contacts || []).find(c => c.id === contact.id);
    setNomCompteRetour(compte.name || '');
    setSelectedClient(complet || { ...contact, company: compte.name, account_id: compte.id });
  };
  const [crmFilter, setCrmFilter] = useState('all');
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  // ── Ce que le serveur décide désormais ────────────────────────────────────
  //
  // La page chargeait les 500 contacts les plus silencieux et faisait tout
  // dans le navigateur. Elle ne connaissait donc que cette fenêtre, et la
  // recherche ne cherchait que là-dedans : un client actif récemment était
  // introuvable. Le tri, les filtres, le regroupement par compte, la
  // pagination et les compteurs vivent maintenant dans lib/account-list.js.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [serverTiles, setServerTiles] = useState([]);
  const [stats, setStats] = useState({ byStatus: {}, byProvider: {}, dormant: 0, valued: 0, value: 0 });
  // La frappe ne doit pas déclencher une requête par caractère · `search` est
  // ce que l'utilisateur voit dans le champ, `searchQuery` ce qui part au
  // serveur une fois la frappe retombée.
  const [searchQuery, setSearchQuery] = useState('');
  // Tri de la Vue globale Deals · « le plus long silence d'abord » répond à la
  // question pour laquelle on ouvre la page (lesquels sont en train de mourir),
  // le montant reste à un clic. Arbitrage Goran du 20/09.
  const [sortBy, setSortBy] = useState('silence');
  // Tuile de tête active (étape de pipeline sous Deals, segment client sous
  // Clients). Les chiffres étaient affichés sans rien pouvoir en faire : on ne
  // savait pas QUI se cachait derrière un compteur.
  const [tileFilter, setTileFilter] = useState(null);
  const t = useT();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // La chaîne brute sert de dépendance de chargement · le Set ne sert plus
  // qu'au rendu. Une dépendance qui change d'identité à chaque rendu
  // relancerait la requête en boucle.
  const highlightParam = searchParams.get('highlight') || '';
  const highlightIds = useMemo(
    () => (highlightParam ? new Set(highlightParam.split(',')) : null),
    [highlightParam]
  );
  // Set only when arriving from Data Quality's "Qualité des deals" strate · a deal (not yet a
  // client) is never eligible for churn/upsell, so this drives a stripped-down, deal-only view
  // instead of reusing every client-oriented option this page otherwise exposes.
  const isDealQualityContext = searchParams.get('context') === 'deal_quality';
  // Which specific issue the user clicked "Voir" on (e.g. missing_sector, missing_deal_value) · 
  // the fix UI must match that one issue only, never a different field than what was flagged.
  const dealQualityIssue = searchParams.get('issue');
  const STATUS_LABELS = getStatusLabels(lang);
  const user = getUser();
  const isAdmin = !user?.teamRole || user.teamRole === 'admin';

  // Ce qui ne change pas d'une recherche à l'autre : les CRM connectés et les
  // propriétaires. Chargé une fois, pas à chaque frappe.
  const loadContext = useCallback(async () => {
    try {
      const [providersData, ownersData] = await Promise.all([
        request('/crm/providers').catch(() => ({ providers: [] })),
        request('/crm/team-owners').catch(() => ({ owners: [] })),
      ]);
      const crmProviders = ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable'];
      const connected = (providersData.providers || []).filter(p => crmProviders.includes(p.provider) && p.connected);
      setConnectedCrm(providersData.activeCrm || connected[0]?.provider || null);
      setConnectedProviders(connected);
      setOwners(ownersData.owners || []);
    } catch (err) {
      console.error('[ClientsPage] loadContext', err);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ scope: scope || '', page: String(page), pageSize: String(pageSize) });
      if (filter && filter !== 'all') params.set('filter', filter);
      if (ownerFilter !== 'all') params.set('owner', ownerFilter);
      if (crmFilter !== 'all') params.set('crm', crmFilter);
      if (tileFilter) params.set('tile', tileFilter);
      if (searchQuery) params.set('search', searchQuery);
      if (sortBy) params.set('sort', sortBy);
      // Le rappel d'un écran d'audit passe désormais au serveur : lui seul peut
      // aller chercher ces contacts où qu'ils soient dans la base.
      if (highlightParam) params.set('ids', highlightParam);

      const data = await request(`/crm/account-list?${params.toString()}`);
      setGroups(data.groups || []);
      setTotal(data.total || 0);
      setPageSize(data.pageSize || 25);
      setServerTiles(data.tiles || []);
      setStats(data.stats || { byStatus: {}, byProvider: {}, dormant: 0, valued: 0, value: 0 });
    } catch (err) {
      // Surtout ne pas rester muet : un `catch {}` vide ici a masqué pendant onze
      // jours une ReferenceError qui coupait le chargement en route et laissait
      // la page à moitié remplie, sans aucun signe visible.
      console.error('[ClientsPage] loadData', err);
    }
    setLoading(false);
    // `highlightParam` et non le Set : une dépendance qui change d'identité à
    // chaque rendu relancerait la requête en boucle. Une chaîne se compare.
  }, [scope, page, pageSize, filter, ownerFilter, crmFilter, tileFilter, searchQuery, sortBy, highlightParam]);

  useEffect(() => { loadContext(); }, [loadContext]);
  useEffect(() => { loadData(); }, [loadData]);

  // La frappe attend 300 ms avant de partir au serveur. Sans ce délai, écrire
  // « chevalier » lance neuf requêtes dont huit sont jetées.
  useEffect(() => {
    const id = setTimeout(() => setSearchQuery(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Tout changement de cadrage ramène à la première page. Sans ça, filtrer
  // depuis la page 7 donne une liste vide et l'impression que le filtre n'a
  // rien trouvé.
  useEffect(() => { setPage(1); }, [scope, filter, ownerFilter, crmFilter, tileFilter, searchQuery, sortBy]);

  // Les contacts de la page, à plat. Le cadrage, les filtres et la recherche
  // ont déjà été appliqués en base : il n'y a plus rien à retrancher ici.
  //
  // DÉCLARÉ AVANT `handleImport`, qui le lit dans son corps et dans son tableau
  // de dépendances. Un `const` lu au-dessus de sa déclaration lève « Cannot
  // access before initialization » au premier rendu, et la page entière tombe
  // sur son écran d'erreur. Ni le build ni les tests backend ne voient ça :
  // seul l'affichage réel le montre.
  const clients = useMemo(() => groups.flatMap(g => g.contacts || []), [groups]);

  /**
   * Reconstruire les SOCIETES sans reimporter le CRM.
   *
   * Un contact porte souvent un nom de societe en texte libre sans etre
   * rattache a une societe (`account_id` NULL). Tant qu'il l'est, son groupe
   * n'a pas de fiche : le nom n'est pas cliquable, et la vue par compte reste
   * une vue par nom. La route existait depuis le lot 2 mais AUCUN bouton ne
   * l'appelait · c'etait du code mort, et c'est ce qui rendait la fiche compte
   * invisible dans l'app.
   *
   * Volontairement separe de « Actualiser » : celui-la rappelle le CRM, celui-ci
   * ne touche qu'aux donnees deja la. Un utilisateur dont le CRM est lent ou
   * deconnecte doit pouvoir reconstruire ses societes sans l'attendre, et le
   * chemin marche aussi pour les imports de fichier, dont aucun connecteur ne
   * fera jamais la synchro.
   */
  const handleRebuildAccounts = useCallback(async () => {
    setRebuilding(true);
    setRebuildResult(null);
    try {
      const r = await request('/crm/accounts/rebuild', { method: 'POST' });
      setRebuildResult(r);
      await loadData();
    } catch (err) {
      setRebuildResult({ error: err.message });
    } finally {
      setRebuilding(false);
    }
  }, [loadData]);

  const handleImport = useCallback(async () => {
    if (!connectedCrm) return;
    const hadClientsBefore = clients.length > 0;
    setImporting(true);
    setImportResult(null);
    try {
      // Refresh every connected CRM, not just the active one · a user with
      // both Pipedrive and Salesforce connected expects "Actualiser" to sync
      // both, not silently skip whichever isn't marked active.
      const providers = connectedProviders.length > 0 ? connectedProviders.map(p => p.provider) : [connectedCrm];
      const results = await Promise.all(providers.map(p =>
        request(`/crm/import/${p}`, { method: 'POST' }).catch(err => ({ error: err.message, provider: p }))
      ));
      const failed = results.filter(r => r.error);
      // Un CRM en maintenance (502/503/504) mérite un message lisible, pas le corps brut de l'erreur
      const prettify = (msg) => (/API 50[234]\b|maintenance/i.test(msg) ? t('clients.crmTransientError') : msg);
      const aggregated = {
        imported: results.reduce((sum, r) => sum + (r.imported || 0), 0),
        skipped: results.reduce((sum, r) => sum + (r.skipped || 0), 0),
        error: failed.length > 0 ? failed.map(f => `${f.provider}: ${prettify(f.error)}`).join(' · ') : null,
      };
      setImportResult(aggregated);
      await loadData();
      // Show diagnostic report on first import (new contacts imported + never seen before)
      if (aggregated.imported > 0 && !hadClientsBefore && localStorage.getItem('bakal_diagnostic_seen') !== 'true') {
        setShowDiagnostic(true);
      }
    } catch (err) {
      setImportResult({ error: err.message });
    }
    setImporting(false);
  }, [loadData, connectedCrm, connectedProviders, clients.length, t]);

  // ── Tuiles de tête ──────────────────────────────────────────────────────
  //
  // Un jeu FIXE de quatre segments de chaque côté, jamais les étapes brutes du
  // CRM. La barre affichait une tuile par étape de pipeline remontée par
  // /crm/stages : sur un Salesforce standard, ça fait plus de seize tuiles qui
  // débordent en scroll horizontal et noient la page (constaté le 28/09 sur le
  // compte de William, 308 deals). Une vue globale doit tenir en un coup d'oeil,
  // et le découpage qui répond à « lesquels sont en train de mourir » n'est pas
  // le pipeline du CRM, c'est le silence.
  //
  // Sous Deals : le temps écoulé depuis le dernier échange, aux seuils déjà
  // employés par la page (30 j « dorment », 60 j rouge dans silenceColor), plus
  // les perdus.
  // Sous Clients : les segments qui valent pour un contrat déjà signé.
  //
  // Dans les deux cas, une tuile est un filtre : le chiffre se lit, puis se
  // clique pour voir qui est derrière.
  // Les COMPTEURS viennent du serveur (lib/account-list.js), les libellés et
  // les couleurs restent ici. Ils portent sur toute la base et non sur la page
  // affichée : un compteur qui ne compte que ce qui est à l'écran annonce un
  // nombre qui n'existe nulle part, et c'est exactement ce que faisait la
  // fenêtre de 500. Les seuils ne sont plus définis qu'à un seul endroit, côté
  // serveur, pour que les tuiles et la couleur de chaque ligne ne puissent
  // plus se contredire d'un jour.
  const countOfTile = useCallback(
    (key) => serverTiles.find(x => x.key === key)?.count ?? 0,
    [serverTiles]
  );

  const tileGroups = useMemo(() => {
    if (scope === 'clients') {
      const segments = [
        { key: 'seg_new', label: t('clients.segNew') },
        { key: 'seg_active', label: t('clients.segActive') },
        { key: 'seg_silent', label: t('clients.segSilent') },
        { key: 'seg_risk', label: t('clients.segRisk') },
      ];
      return [['', segments.map(s => ({ ...s, count: countOfTile(s.key) }))]];
    }

    // Un deal perdu est sorti du pipeline : le compter aussi dans une tranche de
    // silence le ferait apparaître dans deux tuiles à la fois, alors que chaque
    // tuile sert de filtre exclusif. Les trois premières ne parlent donc que des
    // deals encore ouverts. Activité inconnue : comptée nulle part, comme sous
    // Clients · la ranger dans « au point mort » transformerait une donnée
    // manquante en alerte. Ces règles vivent maintenant dans
    // lib/account-list.js, `conditionsDeTuile`.
    //
    // Couleur explicite, et pas la palette par position : ces quatre tuiles
    // disent la même chose que le compteur de jours de chaque ligne, elles
    // doivent le dire de la même couleur (cf. silenceColor).
    const segments = [
      { key: 'deal_active', label: t('clients.dealSegActive'), color: 'var(--success)' },
      { key: 'deal_dormant', label: t('clients.dealSegDormant'), color: 'var(--warning)' },
      { key: 'deal_stalled', label: t('clients.dealSegStalled'), color: 'var(--danger)' },
      { key: 'deal_lost', label: t('clients.dealSegLost'), color: 'var(--text-muted)' },
    ];
    return [['', segments.map(s => ({ ...s, count: countOfTile(s.key) }))]];
  }, [scope, countOfTile, t]);

  const activeTile = useMemo(
    () => tileGroups.flatMap(([, tiles]) => tiles).find(x => x.key === tileFilter) || null,
    [tileGroups, tileFilter]
  );

  // Passer de Deals à Clients garde le composant monté, mais les clés de
  // tuiles ne se croisent pas (`deal_*` contre `seg_*`) : un filtre de deal
  // ne trouve plus sa tuile côté clients, donc `activeTile` retombe à null et
  // rien n'est filtré. Aucun état à remettre à zéro à la main.
  //
  // Le cadrage, les filtres, la tuile, la recherche et le tri sont désormais
  // appliqués EN BASE. Il ne reste ici qu'une chose, et elle ne peut pas y
  // monter : en contexte qualité des deals, une ligne sort de la liste dès que
  // le problème est corrigé, sans attendre un nouveau scan. C'est un retest
  // LOCAL sur une valeur que l'utilisateur vient de saisir, le serveur ne la
  // connaît pas encore.
  //
  // owner_not_mapped et zero_activity n'ont pas de retest local fiable : ils
  // restent sur la seule liste d'identifiants.
  const filtered = useMemo(() => {
    if (!isDealQualityContext) return clients;
    return clients.filter(c => {
      if (dealQualityIssue === 'missing_sector') return !c.data?.sector || c.data.sector === 'non_determine';
      if (dealQualityIssue === 'missing_deal_value') return c.deal_value == null;
      if (dealQualityIssue === 'missing_won_lost_date') {
        return (c.status === 'won' && !c.won_date) || (c.status === 'lost' && !c.lost_date);
      }
      return true;
    });
  }, [clients, isDealQualityContext, dealQualityIssue]);

  // ── Regroupement par COMPTE ─────────────────────────────────────────────
  //
  // Décision du 29/09 : une ligne est une SOCIÉTÉ, pas une personne. Le clic
  // déplie ses affaires, chacune avec son interlocuteur, puis les contacts qui
  // n'en portent aucune.
  //
  // Les GROUPES et leur ordre viennent du serveur, qui seul peut trier et
  // paginer sur toute la base. Ce qui reste ici est de la mise en forme : quels
  // contacts du groupe portent une affaire, le montant, le silence, le
  // décideur. Rien qui décide de la composition de la liste.
  //
  // Le serveur a filtré les CONTACTS puis regroupé, pas l'inverse : chercher
  // « cheva » rend le compte de Sandrine Chevalier avec Sandrine dedans, pas
  // le compte entier.
  //
  // Un contact sans société forme son propre groupe, sous son nom. Sans ça, un
  // CRM dont les personnes n'ont pas d'organisation ferait disparaître presque
  // tout le monde · mesuré le 30/09 sur staging : 26 contacts sur 565 portent
  // un account_id.
  const accountGroups = useMemo(() => {
    // Une « affaire » est une ligne qui porte un deal · montant, étape ou
    // identifiant de deal. La clé est le DEAL et non l'étape : une affaire dont
    // l'étape n'a pas encore été traduite reste une affaire.
    const porteUneAffaire = (c) => !!(c.crm_deal_id || c.deal_value != null || c.crm_stage);
    // En contexte qualité des deals, `filtered` a pu retirer des lignes que le
    // serveur avait rendues (correction faite à l'instant) : on repart donc de
    // lui, et un groupe vidé disparaît.
    const gardes = new Set(filtered.map(c => c.id));

    return groups.map(g => {
      const rows = (g.contacts || []).filter(c => gardes.has(c.id));
      const deals = rows.filter(porteUneAffaire);
      const sansAffaire = rows.filter(c => !porteUneAffaire(c));
      // Silence du COMPTE : la dernière activité de N'IMPORTE LEQUEL de ses
      // contacts (arbitrage 12.3). Un compte n'est pas silencieux parce qu'un
      // de ses interlocuteurs l'est.
      const jours = rows.map(c => daysSince(c.last_activity_at)).filter(d => d != null);
      // ── TOUT CE QUE LE SERVEUR ENVOIE PASSE, par défaut ─────────────────
      //
      // Ce remappage construisait un objet littéral champ par champ, donc tout
      // ce qui n'y était pas recopié à la main disparaissait SANS ERREUR. Ça a
      // coûté deux fois :
      //
      //   · `accountId` était perdu, donc le nom de société n'était cliquable
      //     sur AUCUNE ligne et la fiche compte n'était atteignable que par URL
      //     directe · le serveur l'envoyait, l'écran le jetait ;
      //   · les quatre colonnes du lot 7 (ouvert, gagné, risque, propriétaire)
      //     ont disparu de la même façon au premier jet, le jour même où le
      //     premier défaut venait d'être corrigé.
      //
      // Un défaut qui se reproduit n'est pas une étourderie, c'est la forme du
      // code qui le provoque. Le défaut est donc INVERSÉ : on étale le groupe
      // du serveur, et on ne surcharge que ce qui est calculé ici. Un champ
      // ajouté côté serveur arrive désormais tout seul.
      const base = { ...g };

      // `contacts` est la SEULE chose qu'on retire, et volontairement : c'est
      // la liste brute du serveur, alors que `rows` est la liste filtrée par
      // la recherche et les filtres. Les laisser cohabiter installerait le
      // piège inverse · quelqu'un lirait `contacts` et travaillerait sur des
      // lignes que l'écran n'affiche pas.
      delete base.contacts;

      return {
        ...base,
        rows,
        deals,
        sansAffaire,
        silenceDays: jours.length > 0 ? Math.min(...jours) : null,
        // Le décideur du compte, s'il y en a un : c'est lui qu'on met en avant.
        decideur: rows.find(c => c.is_primary_contact) || rows.find(c => c.account_role === 'decision_maker') || null,
      };
    // Un groupe VIDE disparait... sauf s'il est une societe sans interlocuteur.
    //
    // Ces societes-la n'ont par definition aucune ligne de contact, et ce
    // filtre les jetait donc juste apres que le serveur ait pris la peine de
    // les remonter. C'est exactement le defaut qu'on corrige : une societe
    // sans contact n'est ni scorable ni demarchable, et la cacher revient a
    // cacher l'argent qu'elle porte.
    }).filter(g => g.rows.length > 0 || g.sansInterlocuteur);
  }, [groups, filtered]);

  /**
   * Les groupes qui N'ONT PAS de fiche, et qui pourraient en avoir une.
   *
   * Un groupe formé sur un nom de société en texte libre : ses contacts portent
   * le nom de l'entreprise mais aucun `account_id`, donc le nom ne s'ouvre pas.
   * Les contacts isolés (une personne sans entreprise) sont exclus du compte :
   * eux n'auront jamais de fiche, et les annoncer comme réparables serait
   * promettre un résultat que le bouton ne peut pas donner.
   */
  const groupesSansFiche = useMemo(
    () => accountGroups.filter(g => !g.accountId && !g.orphan).length,
    [accountGroups]
  );

  // Ce que la liste rend réellement : un en-tête de compte, puis ses lignes de
  // contact quand il est déplié. Une seule liste plate, pour que le rendu d'un
  // contact reste exactement celui d'avant.
  //
  // Une recherche déplie tout : chercher quelqu'un et tomber sur une liste de
  // sociétés fermées serait absurde. C'est ce qui permet de retrouver une
  // personne depuis Deals ou Clients sans liste Contacts dédiée.
  const renderList = useMemo(() => {
    const out = [];
    const toutDeplier = !!search || isDealQualityContext;
    for (const g of accountGroups) {
      // Un contact seul, sans société, n'a pas d'en-tête à lui : ce serait une
      // ligne de compte qui n'en est pas une. Il se rend directement.
      if (g.orphan && g.rows.length === 1) {
        out.push({ type: 'row', row: g.rows[0] });
        continue;
      }
      out.push({ type: 'account', group: g });
      if (toutDeplier || expandedAccounts.has(g.key)) {
        for (const c of [...g.deals, ...g.sansAffaire]) out.push({ type: 'row', row: c, nested: true });
      }
    }
    return out;
  }, [accountGroups, expandedAccounts, search, isDealQualityContext]);

  // Les trois agrégats de tête viennent du serveur, sur tout le cadrage et non
  // sur la page affichée. Ils gardent leur chiffre quand un filtre est actif :
  // une liste déroulante dont chaque option annonce zéro empêche d'en sortir.
  const statusCounts = stats.byStatus;
  const crmProviderCounts = stats.byProvider;

  // Agrégats de tête de la Vue globale Deals. Le montant total est annoncé avec
  // le nombre de deals valorisés : sur les données réelles, la majorité des deals
  // importés n'ont pas de montant, et afficher la somme seule laisserait croire
  // que c'est tout le pipeline.
  const dealStats = useMemo(
    () => (scope === 'deals' ? { dormant: stats.dormant, valued: stats.valued, value: stats.value } : null),
    [scope, stats]
  );

  // Un seul CRM connecté : le badge provider ne distinguerait rien. Calculé ici et
  // passé aux panneaux de détail, qui lisaient `crmProviderCounts` hors de portée.
  const multiCrm = Object.keys(crmProviderCounts).length > 1;

  // Les chips silence / étape / score n'enrichissent que la Vue globale Deals.
  // Le cadrage Clients a déjà de quoi remplir ses lignes (churn, lignes produit)
  // et n'est pas touché par ce lot.
  const isDealsScope = scope === 'deals' && !isDealQualityContext;

  const toggleSelect = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(c => c.id)));
  }, [filtered, selected.size]);

  const handleBulkStatus = useCallback(async (status) => {
    if (selected.size === 0) return;
    setBulkAction('status');
    try {
      await request('/crm/bulk-update', {
        method: 'POST',
        body: JSON.stringify({ ids: [...selected], update: { status } }),
      });
      showToast({ type: 'success', title: t('common.success'), message: `${selected.size} contact(s)` });
      setSelected(new Set());
      await loadData();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setBulkAction(null);
  }, [selected, loadData, t]);

  const handleBulkDelete = useCallback(async () => {
    if (selected.size === 0) return;
    setBulkAction('delete');
    try {
      await request('/crm/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: [...selected] }),
      });
      showToast({ type: 'success', title: t('common.success'), message: `${selected.size} contact(s)` });
      setSelected(new Set());
      await loadData();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setBulkAction(null);
  }, [selected, loadData, t]);

  const statusTabs = [
    { key: 'all', label: t('clients.all'), count: stats.totalScope || 0 },
    { key: 'imported', label: STATUS_LABELS.imported, count: statusCounts.imported || 0 },
    { key: 'new', label: STATUS_LABELS.new, count: statusCounts.new || 0 },
    { key: 'interested', label: STATUS_LABELS.interested, count: statusCounts.interested || 0 },
    { key: 'meeting', label: STATUS_LABELS.meeting, count: statusCounts.meeting || 0 },
    // « Gagné » et « À risque » ne concernent que les clients : hors de portée
    // côté deals, et redondant avec la portée elle-même côté clients.
...(scope === 'deals' ? [] : [
      { key: 'won', label: STATUS_LABELS.won, count: statusCounts.won || 0 },
      // Plus d'onglet « À risque » ici · arbitrage Goran du 2026-10-02.
      //
      // Il faisait le MEME filtre, au MEME seuil, que la tuile du même nom
      // posée dix centimètres plus haut sur le même écran. Deux contrôles pour
      // une seule question, et la tuile porte en plus la bande de sévérité.
      //
      // Ce qui disparaît est un doublon de filtre, pas une capacité : ni la
      // tuile ni l'onglet n'ont jamais offert d'ACTION sur un client à risque.
      // Préparer un workflow, envoyer en groupe, qualifier l'issue · tout ça
      // vit sur la page dédiée Clients à risque, et y reste.
    ]),
  ].filter(tab => tab.key === 'all' || tab.count > 0);

  return (
    <div className="dashboard-page">
      {showDiagnostic && (
        <CRMDiagnosticReport onClose={() => setShowDiagnostic(false)} />
      )}
      {highlightIds && (
        <div style={{ padding: '10px 16px', background: 'var(--accent-bg, #f3f0ff)', borderRadius: 8, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: 'var(--accent, #6E57FA)' }}>
            {isDealQualityContext ? t('dataQuality.dealQuality.filteredFromDataQuality') : (lang === 'en' ? `Showing ${filtered.length} contacts from CRM health scan` : `${filtered.length} contacts du scan CRM affich\u00e9s`)}
          </span>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setSearchParams({})}>
            {lang === 'en' ? 'Show all' : 'Voir tout'}
          </button>
        </div>
      )}
      <div className="page-header">
        <div>
          {isDealQualityContext && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '4px 10px', marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              onClick={() => navigate('/data-quality?tab=dealQuality')}
            >
              {'←'} {t('dataQuality.dealQuality.backToDataQuality')}
            </button>
          )}
          <h1 className="page-title">
            {isDealQualityContext ? t('dataQuality.dealQuality.contextTitle') : scope === 'deals' ? t('nav.sectionDeals') : t('clients.title')}
          </h1>
          <div className="page-subtitle">
            {isDealQualityContext
              ? t('dataQuality.dealQuality.contextSubtitle', { count: filtered.length })
              : scope === 'deals'
                // Une ligne d'opportunité est un CONTACT, pas un deal · tant
                // que le modèle compte/deal/contact n'existe pas, annoncer
                // « N deals en cours » est faux dès que le CRM ne rattache pas
                // ses deals : sur un Salesforce sans contact roles, la page
                // annonçait 308 deals en listant 308 personnes qui n'en
                // portaient aucun. On dit ce qui est listé, et combien portent
                // vraiment un montant · le trou devient visible au lieu d'être
                // masqué par un mot.
                ? t('clients.dealsInCrm', {
                    count: stats.totalScope || 0,
                    valued: stats.valued || 0,
                  })
                : t('clients.contactsInCrm', { count: stats.totalScope || 0 })}
          </div>
        </div>
        {isAdmin && (connectedCrm ? (
          isDealQualityContext ? (
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '8px 16px' }}
              onClick={handleImport}
              disabled={importing}
            >
              {importing && <Icon name="clock" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />}
              {importing ? t('clients.importing') : t('dataQuality.dealQuality.refreshData')}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '8px 16px' }}
              onClick={handleImport}
              disabled={importing}
            >
              <Icon name={importing ? 'clock' : 'refresh'} size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
              {importing ? t('clients.importing') : t('clients.refresh')}
            </button>
          )
        ) : (
          <button
            className="btn btn-outline"
            style={{ fontSize: 12, padding: '8px 16px' }}
            onClick={() => navigate('/settings')}
          >
            {t('clients.connectCrm')}
          </button>
        ))}
      </div>

      {importResult && (
        <div style={{
          background: importResult.error ? 'var(--danger-bg)' : 'rgba(0, 214, 143, 0.1)',
          border: `1px solid ${importResult.error ? 'rgba(255,107,107,0.3)' : 'rgba(0, 214, 143, 0.3)'}`,
          borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12,
          color: importResult.error ? 'var(--danger)' : 'var(--success)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>
            {importResult.error
              ? `${t('common.error')} : ${importResult.error}`
              : t('clients.importResult', { imported: importResult.imported, skipped: importResult.skipped })}
          </span>
          <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setImportResult(null)}>{'\u2715'}</button>
        </div>
      )}

      {/* Des sociétés restent à reconnaître.
          Contextuel et non permanent : un bouton toujours affiché pour une
          action qui n'a rien à faire est du bruit, et il n'apprend pas à quoi
          il sert. Celui-ci dit combien de lignes y gagneraient une fiche. */}
      {isAdmin && !isDealQualityContext && groupesSansFiche > 0 && (
        <div style={{
          background: 'var(--bg-subtle)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('clients.accountsToRebuild', { count: groupesSansFiche })}
          </span>
          <button
            className="btn btn-outline"
            style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}
            onClick={handleRebuildAccounts}
            disabled={rebuilding}
          >
            <Icon name={rebuilding ? 'clock' : 'refinement'} size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
            {rebuilding ? t('clients.rebuilding') : t('clients.rebuildAccounts')}
          </button>
        </div>
      )}

      {rebuildResult && (
        <div style={{
          background: rebuildResult.error ? 'var(--danger-bg)' : 'rgba(0, 214, 143, 0.1)',
          border: `1px solid ${rebuildResult.error ? 'rgba(255,107,107,0.3)' : 'rgba(0, 214, 143, 0.3)'}`,
          borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12,
          color: rebuildResult.error ? 'var(--danger)' : 'var(--success)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <span>
            {rebuildResult.error
              ? `${t('common.error')} : ${rebuildResult.error}`
              : t('clients.rebuildResult', {
                // Les noms viennent de la route : syncAccountsForUser rend
                // { accounts, created, linked, skipped } et
                // synthesizeDerivedDeals rend { ecrits, absorbes }.
                created: rebuildResult.created || 0,
                linked: rebuildResult.linked || 0,
                deals: rebuildResult.derivedDeals?.ecrits || 0,
              })}
          </span>
          <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setRebuildResult(null)}>{String.fromCharCode(10005)}</button>
        </div>
      )}

      {/* Bandeau de tête Deals · ce que la liste dit une fois lue en entier,
          dit d'emblée : combien dorment, et quel montant est réellement chiffré. */}
      {!isDealQualityContext && dealStats && (stats.totalScope || 0) > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          marginBottom: 16, fontSize: 12, color: 'var(--text-muted)',
        }}>
          <span style={{ color: dealStats.dormant > 0 ? 'var(--warning)' : 'var(--text-muted)', fontWeight: dealStats.dormant > 0 ? 600 : 400 }}>
            {t('clients.dealsDormant', { count: dealStats.dormant })}
          </span>
          <div style={{ flex: 1 }} />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span>{t('clients.sortLabel')}</span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={{
                padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12,
              }}
            >
              <option value="silence">{t('clients.sortSilence')}</option>
              <option value="value">{t('clients.sortValue')}</option>
            </select>
          </label>
        </div>
      )}

      {/* Plus de bandeau « liste tronquée » : la liste n'est plus une fenêtre
          de 500 lignes filtrée dans le navigateur, elle est paginée sur toute
          la base. Ce qui n'est pas à l'écran est à la page suivante, et la
          recherche va le chercher où qu'il soit. */}

      {/* Tuiles de tête · étapes du pipeline sous Deals, segments clients sous
          Clients. Chaque tuile filtre la liste : le chiffre se clique. */}
      {!isDealQualityContext && tileGroups.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {tileGroups.map(([groupName, tiles]) => (
            <div key={groupName} style={{ marginBottom: 10 }}>
              {/* Le titre du pipeline n'apparaît que s'il y a de quoi confondre
                  deux étapes homonymes. */}
              {tileGroups.length > 1 && (
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {groupName}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 0' }}>
                {tiles.map((tile, i) => {
                  // Une tuile porte sa propre couleur quand elle a un sens
                  // (vert actif, rouge au point mort) ; sinon la palette sert à
                  // les distinguer les unes des autres, rien de plus.
                  const color = tile.color || TILE_COLORS[i % TILE_COLORS.length];
                  const isActive = tileFilter === tile.key;
                  const empty = tile.count === 0;
                  return (
                    <button
                      key={tile.key}
                      type="button"
                      onClick={() => setTileFilter(isActive ? null : tile.key)}
                      // Une tuile vide n'a personne à montrer : la cliquer
                      // afficherait une liste vide sans rien apprendre.
                      disabled={empty}
                      aria-pressed={isActive}
                      title={empty ? undefined : t('clients.tileFilterHint', { label: tile.label })}
                      style={{
                        flex: '1 0 120px', background: isActive ? 'var(--bg-elevated)' : 'var(--bg-card)',
                        border: `1px solid ${isActive ? color : 'var(--border)'}`,
                        borderTop: `3px solid ${color}`, borderRadius: 10,
                        padding: '12px 14px', textAlign: 'center',
                        cursor: empty ? 'default' : 'pointer',
                        opacity: empty ? 0.55 : 1,
                        font: 'inherit', color: 'inherit',
                        boxShadow: isActive ? `0 0 0 1px ${color}` : 'none',
                        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                      }}
                    >
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{tile.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color }}>{tile.count}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {activeTile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                {t('clients.tileFiltered', { label: activeTile.label, count: filtered.length })}
              </span>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '2px 10px' }}
                onClick={() => setTileFilter(null)}
              >
                {t('clients.tileClear')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Search + filter · no effect while a highlight filter is active, so hidden in that case */}
      {!isDealQualityContext && (
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <input
          type="text" placeholder={lang === 'en' ? 'Search...' : 'Rechercher...'} value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, padding: '8px 14px', border: '1px solid var(--border)',
            borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13,
          }}
        />
        {isAdmin && owners.length > 1 && (
          <select
            value={ownerFilter}
            onChange={e => setOwnerFilter(e.target.value)}
            style={{
              padding: '8px 12px', border: '1px solid var(--border)',
              borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12,
            }}
          >
            <option value="all">{t('clients.allReps')}</option>
            {owners.map(o => (
              <option key={o.id} value={o.id}>{o.name} ({o.contact_count})</option>
            ))}
          </select>
        )}
        {multiCrm && (
          <select
            value={crmFilter}
            onChange={e => setCrmFilter(e.target.value)}
            style={{
              padding: '8px 12px', border: '1px solid var(--border)',
              borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12,
            }}
          >
            <option value="all">{lang === 'en' ? 'All CRMs' : 'Tous les CRM'}</option>
            {Object.entries(crmProviderCounts).map(([p, count]) => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)} ({count})</option>
            ))}
          </select>
        )}
        <div style={{ display: 'flex', gap: 4 }}>
          {statusTabs.map(tab => (
            <button key={tab.key} onClick={() => setFilter(tab.key)} style={{
              padding: '6px 12px', border: `1px solid ${filter === tab.key ? 'var(--accent)' : 'var(--border)'}`,
              background: filter === tab.key ? 'rgba(99,102,241,0.1)' : 'transparent', borderRadius: 8,
              fontSize: 11, color: filter === tab.key ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer', fontWeight: filter === tab.key ? 600 : 400, whiteSpace: 'nowrap',
            }}>
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Bulk action bar */}
      {!isDealQualityContext && selected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', marginBottom: 12,
          background: 'rgba(110,87,250,0.06)', border: '1px solid rgba(110,87,250,0.15)',
          borderRadius: 10, fontSize: 12,
        }}>
          <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
            {selected.size} {t('clients.selected')}
          </span>
          <div style={{ flex: 1 }} />
          <select
            style={{
              padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-card)', color: 'var(--text)', fontSize: 11,
            }}
            defaultValue=""
            onChange={e => { if (e.target.value) handleBulkStatus(e.target.value); e.target.value = ''; }}
            disabled={!!bulkAction}
          >
            <option value="" disabled>{t('clients.changeStatus')}</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 12px', color: 'var(--danger)' }}
            disabled={!!bulkAction} onClick={handleBulkDelete}>
            {bulkAction === 'delete' ? '...' : (lang === 'en' ? 'Delete' : 'Supprimer')}
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px', color: 'var(--text-muted)' }}
            onClick={() => setSelected(new Set())}>
            {'\u2715'}
          </button>
        </div>
      )}

      {/* Main content: list + detail panel
          `alignItems: flex-start` n'est pas cosmétique : par défaut flex étire
          ses enfants sur toute la hauteur du conteneur, donc le panneau de
          droite faisait la hauteur de la liste et `position: sticky` n'avait
          aucune course pour jouer. Sans cette ligne, le panneau reste collé en
          haut et ouvrir une fiche depuis le bas de la liste oblige à remonter
          tout en haut pour la lire. */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Client list
            `calc(64% - 16px)` : la liste et la fiche (DETAIL_PANEL_STYLE,
            36 %) doivent sommer à 100 % moins le `gap: 16` du conteneur flex
            parent, sinon la fiche déborde de l'écran et masque son propre
            bord droit ainsi que son bouton de fermeture.

            `minWidth: 0` est tout aussi nécessaire : un flex-item vaut par
            défaut `min-width: auto`, donc il refuse de rétrécir sous la
            largeur minimale de son contenu. Les colonnes à largeur fixe des
            lignes de société (COL.ouvert/gagne/silence/proprietaire, ~400px)
            imposaient ce plancher. Vérifié en Playwright à
            1920/1440/1366/1280/1024px. La fiche était encore à 44 % à ce
            moment-là (99 → 100 % côté somme, mais déjà trop large pour la
            liste) : les noms de société tronquaient à quelques lettres
            ("Nov..."). Passée à 36 % pour laisser assez de place aux
            colonnes de la liste, qui priment sur la largeur de la fiche. */}
        <div style={{ flex: selectedClient ? '0 0 calc(64% - 16px)' : '1 1 100%', minWidth: 0, transition: 'flex 0.2s' }}>
          {/* L'écran de chargement ne remplace la liste qu'au PREMIER
              chargement. Depuis que filtrer, chercher et trier sont des
              allers-retours serveur, la remplacer à chaque fois ferait
              clignoter la page à chaque frappe et à chaque clic de tuile, et
              on perdrait de vue ce qu'on était en train de lire. Une liste qui
              se rafraîchit s'estompe, elle ne disparaît pas. */}
          {loading && groups.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('common.loading')}</div>
          ) : (filtered.length === 0 && accountGroups.length === 0) ? (
            /* `filtered` ne compte que des CONTACTS. Une base qui n'aurait que
               des societes sans interlocuteur affichait donc « aucun client »
               alors qu'elle en a · c'est le meme angle mort que la liste
               elle-meme, un cran plus loin. */
            <div style={{
              textAlign: 'center', padding: 50, background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 12,
            }}>
              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
                <Icon name="users" size={28} strokeWidth={1.5} />
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                {clients.length === 0 ? t('clients.noClients') : t('clients.noResults')}
              </div>
            </div>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 4,
              // Estompée pendant un rafraîchissement · on voit que quelque
              // chose se recharge sans perdre des yeux ce qu'on lisait.
              opacity: loading ? 0.5 : 1,
              transition: 'opacity 0.15s ease',
            }}>
              {/* Select all header · bulk actions don't apply to a focused deal-quality drill-down */}
              {!isDealQualityContext && !selectedClient && filtered.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px', fontSize: 11, color: 'var(--text-muted)' }}>
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll} style={{ cursor: 'pointer' }} />
                  <span>{t('clients.selectAll')} ({filtered.length})</span>
                </div>
              )}
              {/* ── En-tête de colonnes · lot 7, écran 1 ────────────────────
                  Posé seulement quand la liste montre vraiment des sociétés :
                  dans le détail d'un contact ou le focus Qualité des données,
                  les lignes n'ont pas ces colonnes et un en-tête annoncerait
                  des colonnes vides. Les largeurs viennent de COL, partagées
                  avec les lignes · deux litéraux séparés se désaligneraient. */}
              {!isDealQualityContext && !selectedClient && renderList.some(i => i.type === 'account') && (
                <div
                  aria-hidden="true"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 14, padding: '6px 14px', marginTop: 8,
                    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
                    color: 'var(--text-muted)', borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ minWidth: 0, paddingLeft: 20 }}>{t('clients.colCompany')}</div>
                  <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: isDealsScope ? 20 : 0 }}>
                    <div style={{ width: COL.ouvert, textAlign: 'right' }}>{t('clients.colOpen')}</div>
                    {/* Gagné : sans intérêt sur la vue Deals, un deal y est par
                        définition pas encore gagné. Reste en scope Clients. */}
                    {!isDealsScope && (
                      <div style={{ width: COL.gagne, textAlign: 'right' }}>{t('clients.colWon')}</div>
                    )}
                    <div style={{ width: COL.silence, textAlign: 'right' }}>{t('clients.colSilence')}</div>
                    {/* Le churn score est un concept post-vente (cf. BandeRisque ci-dessus) :
                        hors de propos sur un deal encore ouvert, donc masqué en scope deals. */}
                    {!isDealsScope && (
                      <div style={{ width: COL.risque, textAlign: 'right' }}>{t('clients.colRisk')}</div>
                    )}
                    <div style={{ width: COL.proprietaire, textAlign: 'right' }}>{t('clients.colOwner')}</div>
                  </div>
                </div>
              )}

              {renderList.map(item => {
                // ── En-tête de COMPTE ──
                //
                // La société d'abord, sa valeur ensuite, ses gens derrière le
                // clic. C'est le sens de lecture décidé le 29/09 : on cherche
                // une entreprise, pas un prénom.
                if (item.type === 'account') {
                  const g = item.group;
                  // Rien a deplier quand il n'y a aucun contact : le chevron
                  // promettrait un contenu qui n'existe pas.
                  const ouvert = !g.sansInterlocuteur && (!!search || expandedAccounts.has(g.key));
                  const basculer = () => setExpandedAccounts(prev => {
                    const suivant = new Set(prev);
                    if (suivant.has(g.key)) suivant.delete(g.key); else suivant.add(g.key);
                    return suivant;
                  });
                  const ouvrirFiche = () => {
                    setSelectedClient(null);
                    setSelectedAccountId(g.accountId);
                  };
                  const actif = !!g.accountId && selectedAccountId === g.accountId;
                  // La LIGNE ouvre la fiche, le CHEVRON déplie (09/10). Avant,
                  // la ligne dépliait et seul le texte du nom ouvrait la fiche,
                  // sans que rien ne distingue les deux zones : on voulait voir
                  // la société et on dépliait ses contacts, ou l'inverse. C'est
                  // maintenant le même geste que pour un contact. Un groupe
                  // sans fiche (nom en texte libre, personne seule) n'a rien à
                  // ouvrir : sa ligne garde le seul geste qu'elle a, déplier.
                  return (
                    <div
                      key={`acc-${g.key}`}
                      className="clients-account-row"
                      onClick={g.accountId ? ouvrirFiche : (g.sansInterlocuteur ? undefined : basculer)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 14, padding: '11px 14px', borderRadius: 8,
                        cursor: g.accountId || !g.sansInterlocuteur ? 'pointer' : 'default',
                        border: `1px solid ${actif ? 'var(--primary)' : 'var(--border)'}`,
                        background: actif ? 'var(--accent-glow)' : 'var(--bg-card)',
                        fontSize: 13, marginTop: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 60 }}>
                        {g.sansInterlocuteur ? (
                          <span style={{ width: 28, flexShrink: 0 }} />
                        ) : (
                          // Un vrai bouton, avec sa propre zone de clic : c'est
                          // le seul chemin vers les contacts quand la ligne
                          // ouvre la fiche, il doit se viser et se tabuler.
                          <button
                            type="button"
                            className="clients-account-chevron"
                            aria-expanded={ouvert}
                            aria-label={ouvert ? t('clients.hideContacts') : t('clients.showContacts')}
                            title={ouvert ? t('clients.hideContacts') : t('clients.showContacts')}
                            onClick={e => { e.stopPropagation(); basculer(); }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
                              <polygon points="8 4.5 18 12 8 19.5" />
                            </svg>
                          </button>
                        )}
                        {/* minWidth: 60, pas 0 : les colonnes à droite (fixes,
                            flexShrink: 0) ne cèdent jamais de la place, donc à
                            largeur d'écran réduite tout le rétrécissement
                            retombait ici. Avec minWidth: 0 ce bloc pouvait
                            s'écraser à 0px pile et le nom de société
                            disparaissait entièrement plutôt que de tronquer
                            avec l'ellipse déjà prévue juste en dessous. */}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {/* Le nom reste un lien quand le groupe EST une
                                société : un clic simple remonte à la ligne, qui
                                ouvre la fiche dans le panneau, mais un clic
                                MODIFIÉ (Ctrl, Cmd, Maj) garde son sens de lien
                                et ouvre la page à côté. Un groupe formé sur un
                                nom en texte libre ou sur une personne sans
                                entreprise n'a pas de fiche. */}
                            {g.accountId ? (
                              <Link
                                to={`/accounts/${g.accountId}`}
                                onClick={e => {
                                  if (e.metaKey || e.ctrlKey || e.shiftKey) {
                                    e.stopPropagation();   // la page s'ouvre a cote, le panneau ne bouge pas
                                    return;
                                  }
                                  e.preventDefault();      // la ligne ouvre le panneau
                                }}
                                style={{ color: 'inherit', textDecoration: 'none' }}
                                title={t('clients.openAccount')}
                              >
                                {g.name}
                              </Link>
                            ) : g.name}
                          </div>
                          <div style={{ fontSize: 11, color: g.sansInterlocuteur ? 'var(--warning)' : 'var(--text-muted)' }}>
                            {/* « aucun interlocuteur » plutot que « 0 contact » :
                                ca ne decrit pas un compteur, ca explique d'un
                                coup pourquoi la societe n'est ni scorable ni
                                demarchable, et ce qu'il faut faire. */}
                            {g.sansInterlocuteur
                              ? t('clients.noContactAttached')
                              : t('clients.accountSummary', { deals: g.deals.length, contacts: g.rows.length })}
                            {g.decideur ? ` · ${g.decideur.name}` : ''}
                          </div>
                        </div>
                      </div>

                      {/* ── Les colonnes de la société · lot 7, écran 1 ──────
                          OUVERT et GAGNÉ côte à côte, parce que les voir
                          ensemble EST la définition de l'upsell : une société
                          qui a signé et qui a encore une affaire en cours. Un
                          montant unique agrégé ne le disait pas.

                          Chaque colonne a une largeur FIXE et se retrouve à
                          l'identique dans l'en-tête, qui est la seule façon
                          d'aligner sans tableau HTML · la liste imbrique des
                          lignes de contact sous chaque société, et un <table>
                          ne le permettrait pas proprement. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: isDealsScope ? 20 : 0, flexShrink: 0 }}>
                        <div style={{ width: COL.ouvert, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {g.openValue > 0
                            ? `${Math.round(g.openValue).toLocaleString('fr-FR')} €`
                            : <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>0 €</span>}
                        </div>
                        {!isDealsScope && (
                          <div style={{ width: COL.gagne, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {g.wonValue > 0
                              ? <span style={{ fontWeight: 600, color: 'var(--success)' }}>{Math.round(g.wonValue).toLocaleString('fr-FR')} €</span>
                              : <span style={{ color: 'var(--text-muted)' }}>0 €</span>}
                          </div>
                        )}
                        <div style={{ width: COL.silence, textAlign: 'right' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: silenceColor(g.silenceDays), flexShrink: 0 }} />
                            <span style={{ color: g.silenceDays == null ? 'var(--text-muted)' : silenceColor(g.silenceDays) }}>
                              {g.silenceDays == null
                                ? t('clients.silenceUnknown')
                                : t('clients.silenceDays', { days: g.silenceDays })}
                            </span>
                          </span>
                        </div>
                        {/* Le churn score ne s'applique qu'aux comptes clients (post-vente),
                            pas à un deal encore ouvert · cf. le commentaire sur BandeRisque. */}
                        {!isDealsScope && (
                          <div style={{ width: COL.risque, textAlign: 'right' }}>
                            <BandeRisque score={g.churnScore} sansFiche={!g.accountId} t={t} />
                          </div>
                        )}
                        <div style={{
                          width: COL.proprietaire, textAlign: 'right', fontSize: 11,
                          color: g.owner ? 'var(--text-secondary)' : 'var(--text-muted)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {g.owner ? g.owner.split('@')[0] : t('clients.ownerNone')}
                        </div>
                      </div>
                    </div>
                  );
                }

                const c = item.row;
                const color = STATUS_COLORS[c.status] || 'var(--text-muted)';
                const isSelected = selectedClient?.id === c.id;
                const isChecked = selected.has(c.id);
                const churnColor = c.churn_score >= 76 ? 'var(--danger)' : c.churn_score >= 51 ? 'var(--warning)' : c.churn_score >= 26 ? '#D97706' : 'var(--success)';
                const showCrmBadge = c.crm_provider && multiCrm;
                const silenceDays = daysSince(c.last_activity_at);
                const stageDays = daysSince(c.crm_stage_changed_at);

                // Deal-quality drill-down keeps its own grid layout, built around whatever field
                // was flagged, untouched here, only the plain browsing row below was restyled.
                if (isDealQualityContext) {
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div onClick={() => { setSelectedAccountId(null); setSelectedClient(c); }} style={{
                        flex: 1, display: 'grid',
                        gridTemplateColumns: selectedClient ? '2fr 80px' : (owners.length > 1 ? '2fr 1fr 0.8fr 60px' : '2fr 1.2fr 1fr'),
                        padding: '10px 14px', background: isSelected ? 'rgba(99,102,241,0.08)' : 'var(--bg-card)',
                        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{c.name || ' '}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.title || c.email || ''}</div>
                        </div>
                        {!selectedClient && <div style={{ color: 'var(--text-secondary)' }}>{c.company || ' '}</div>}
                        <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: `${color}15`, color, fontWeight: 600, width: 'fit-content', justifySelf: selectedClient ? 'end' : 'start' }}>
                          {STATUS_LABELS[c.status] || c.status || ' '}
                        </span>
                        {!selectedClient && owners.length > 1 && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.owner_email ? c.owner_email.split('@')[0] : ' '}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                return (
                  // Indentation quand la ligne appartient à un compte déplié :
                  // c'est le seul signal qui dit qu'elle en dépend.
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: item.nested ? 22 : 0 }}>
                    {!selectedClient && (
                      <input type="checkbox" checked={isChecked}
                        onChange={() => toggleSelect(c.id)}
                        onClick={e => e.stopPropagation()}
                        style={{ cursor: 'pointer', flexShrink: 0 }} />
                    )}
                    <div onClick={() => { setSelectedAccountId(null); setSelectedClient(c); }} style={{
                      flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14,
                      padding: '10px 14px', background: isChecked ? 'rgba(110,87,250,0.06)' : isSelected ? 'rgba(99,102,241,0.08)' : 'var(--bg-card)',
                      border: `1px solid ${isChecked ? 'rgba(110,87,250,0.2)' : isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 8, fontSize: 13, cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}>
                      <div style={{ minWidth: 0 }}>
                        {/* Sous un compte déplié, la ligne montre la PERSONNE :
                            répéter le nom de la société sur chacun de ses
                            contacts, juste sous l'en-tête qui le porte déjà,
                            n'apprend rien et noie l'interlocuteur.
                            Hors regroupement, la société reprend la tête · c'est
                            elle qu'on cherche, pas un prénom. Règle unique dans
                            ContactSubline. */}
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(item.nested ? (c.name || ' ') : accountFirstLines(c).primary) || ' '}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {/* Panneau ouvert, la ligne est étroite et la société est
                              déjà répétée dans l'en-tête du panneau : la fonction
                              seule est ce qui manque le plus à l'écran. */}
                          {item.nested
                            ? (c.title || c.email || '')
                            : (!selectedClient ? accountFirstLines(c).secondary : (c.title || c.email || ''))}
                          {/* Étape CRM et relance prévue en seconde ligne, seulement
                              quand elles existent : sur les données importées, la
                              majorité des deals n'a pas d'étape rapatriée, et une
                              colonne réservée aurait affiché des vides alignés. */}
                          {isDealsScope && !selectedClient && stageDays != null && (
                            <span> · {t('clients.inStageDays', { days: stageDays })}</span>
                          )}
                          {isDealsScope && !selectedClient && c.planned_followup_date && (
                            <span style={{ color: 'var(--warning)' }}>
                              {' · '}{t('clients.followupPlanned', {
                                date: new Date(c.planned_followup_date).toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' }),
                              })}
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        {/* Le décideur, avant tout le reste · sur un compte à
                            huit contacts, savoir à qui on parle vient avant de
                            savoir depuis quand il se tait. Le badge ne dit rien
                            quand le rôle est inconnu : une absence de marque se
                            lit mieux qu'une étiquette « rôle inconnu » répétée
                            sur la moitié de la liste. */}
                        {!selectedClient && c.account_role === 'decision_maker' && (
                          <span
                            title={c.role_source === 'crm' ? t('clients.roleFromCrm') : t('clients.roleInferred')}
                            style={{
                              fontSize: 11, padding: '3px 10px', borderRadius: 6,
                              background: 'var(--bg-elevated)', color: 'var(--accent)',
                              fontWeight: 600, whiteSpace: 'nowrap',
                              // Pointillé tant que c'est une déduction : la même
                              // distinction visuelle que l'écran de relecture du
                              // pipeline, où « le CRM le dit » et « baakalai a
                              // supposé » n'appellent pas la même confiance.
                              border: c.role_source === 'crm' ? '1px solid transparent' : '1px dashed var(--border)',
                            }}
                          >
                            {t('clients.decisionMaker')}
                          </span>
                        )}

                        {/* Le silence est la raison d'être de la page : premier chip,
                            couleur avant chiffre. Il remplace la date de dernière
                            activité que personne n'allait chercher dans le panneau. */}
                        {isDealsScope && !selectedClient && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: silenceColor(silenceDays), flexShrink: 0 }} />
                            <span style={{ color: silenceDays == null ? 'var(--text-muted)' : silenceColor(silenceDays) }}>
                              {silenceDays == null
                                ? t('clients.silenceNever')
                                : t('clients.silenceDays', { days: silenceDays })}
                            </span>
                          </span>
                        )}

                        {isDealsScope && !selectedClient && c.crm_stage && (
                          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {c.crm_stage}
                          </span>
                        )}

                        {isDealsScope && !selectedClient && c.score != null && (
                          <span style={{
                            fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                            color: c.score >= 70 ? 'var(--success)' : c.score >= 40 ? 'var(--warning)' : 'var(--text-muted)',
                          }}>
                            {c.score}<span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>/100</span>
                          </span>
                        )}

                        {!selectedClient && owners.length > 1 && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {c.owner_email ? c.owner_email.split('@')[0] : ' '}
                          </span>
                        )}

                        {/* Churn risk is a retention concept, only meaningful once a deal has
                            actually become a client, so it only ever replaces the deal-value
                            pill for status === 'won'. */}
                        {!selectedClient && c.status === 'won' && c.churn_score != null && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 7, background: 'var(--bg-elevated)' }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: churnColor, flexShrink: 0 }} />
                            <span style={{ color: churnColor }}>{c.churn_score}<span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>/100</span></span>
                          </span>
                        )}
                        {!selectedClient && c.status !== 'won' && c.deal_value != null && (
                          <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 7, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                            {Math.round(c.deal_value).toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR')} €
                          </span>
                        )}

                        {!selectedClient && showCrmBadge && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px dashed var(--border)', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: CRM_DOT_COLORS[c.crm_provider] || 'var(--text-muted)', flexShrink: 0 }} />
                            {c.crm_provider}
                          </span>
                        )}

                        {/* Every row here is status === 'won' when scope is 'clients'  
                            showing "Gagn\u00e9" on every single card is a constant, not
                            information, so it's skipped entirely for that scope. */}
                        {scope !== 'clients' && (
                          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: `${color}15`, color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {STATUS_LABELS[c.status] || c.status || ' '}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination · elle porte sur les COMPTES, l'unité de lecture de
              cette page, pas sur les contacts. Un compte de douze
              interlocuteurs reste entier, il ne se coupe pas en deux entre
              deux pages.

              Affichée dès qu'il y a plus d'une page. Le total est écrit en
              toutes lettres à côté : « 1 à 25 sur 214 » dit combien il en
              reste, ce qu'un simple « suivant » ne dit pas. */}
          {!loading && total > pageSize && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 12, flexWrap: 'wrap', marginTop: 16, paddingTop: 12,
              borderTop: '1px solid var(--border-light)', fontSize: 12, color: 'var(--text-muted)',
            }}>
              <span>
                {t('clients.pageRange', {
                  from: (page - 1) * pageSize + 1,
                  to: Math.min(page * pageSize, total),
                  total,
                })}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  {t('clients.pagePrev')}
                </button>
                <span>{t('clients.pageOf', { page, pages: Math.max(1, Math.ceil(total / pageSize)) })}</span>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= Math.ceil(total / pageSize)}
                >
                  {t('clients.pageNext')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Panneau de SOCIETE · meme geste que pour un contact (07/10).
            Cliquer une societe emmenait sur une page entiere alors que cliquer
            un contact ouvrait ce panneau : deux objets du meme tableau, deux
            modeles d'interaction, et un aller-retour obligatoire pour comparer
            deux societes. */}
        {/* La cle force un remontage d'une societe a l'autre : sans elle, la
            fiche precedente restait affichee le temps du chargement. */}
        {selectedAccountId && !selectedClient && (
          <AccountDetailPanel
            key={selectedAccountId}
            accountId={selectedAccountId}
            onClose={fermerPanneaux}
            onOpenContact={ouvrirContactDuCompte}
          />
        )}

        {/* Detail panel */}
        {selectedClient && (
          isDealQualityContext ? (
            <DealDetailPanel
              client={selectedClient}
              issueType={dealQualityIssue}
              multiCrm={multiCrm}
              onClose={fermerPanneaux}
              onFieldSaved={(id, patch) => {
                // La correction est appliquée SUR PLACE, sans recharger : c'est
                // ce qui fait sortir la ligne de la liste dès qu'elle est
                // réparée, sans attendre un nouveau scan. Le contact vit dans
                // le compte qui le porte, d'où la mise à jour en profondeur.
                setGroups(prev => prev.map(g => ({
                  ...g,
                  contacts: (g.contacts || []).map(c => (c.id === id ? { ...c, ...patch } : c)),
                })));
                setSelectedClient(prev => (prev && prev.id === id) ? {...prev,...patch } : prev);
              }}
            />
          ) : (
            <ClientDetailPanel
              client={selectedClient}
              multiCrm={multiCrm}
              onClose={fermerPanneaux}
              // `selectedAccountId` encore pose sous un contact ouvert = on
              // vient de la fiche de cette societe : le retour y ramene.
              onBack={selectedAccountId ? () => setSelectedClient(null) : undefined}
              backLabel={nomCompteRetour}
              onOpenAccount={(accountId) => { setSelectedClient(null); setSelectedAccountId(accountId); }}
            />
          )
        )}
      </div>
    </div>
  );
}

/* ═══ Panneau de SOCIETE ═══
   Meme enveloppe que le panneau de contact (DETAIL_PANEL_STYLE), meme contenu
   que la page `/accounts/:id` · `components/AccountSheet.jsx` est partage par
   les deux, donc un bloc ajoute apparait des deux cotes sans qu'on y pense.

   `compact` passe la fiche sur une seule colonne : a 36 % de large, la grille a
   deux colonnes de la page donnerait des montants coupes et des libelles sur
   trois lignes. */
function AccountDetailPanel({ accountId, onClose, onOpenContact }) {
  const t = useT();
  const [fiche, setFiche] = useState(null);
  const [etat, setEtat] = useState('chargement');

  useEffect(() => {
    let vivant = true;
    // `etat` n'est PAS remis a « chargement » de facon synchrone ici : la regle
    // `react-hooks/set-state-in-effect` l'interdit, et le panneau se demonte
    // entre deux societes de toute facon (la cle change avec l'identifiant).
    request(`/crm/accounts/${accountId}`)
      .then(data => { if (vivant) { setFiche(data); setEtat('ok'); } })
      .catch(() => { if (vivant) setEtat('introuvable'); });
    return () => { vivant = false; };
  }, [accountId]);

  return (
    <div style={DETAIL_PANEL_STYLE}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fiche?.compte?.name || ''}
          </div>
          {fiche && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {[
                fiche.compte.industry,
                fiche.compte.crmProvider,
                fiche.compte.ownerEmail ? fiche.compte.ownerEmail.split('@')[0] : null,
              ].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {/* Le lien vers la page entiere reste accessible : une adresse se
              partage et se met en favori, ce qu'un panneau ne sait pas faire. */}
          {fiche && (
            <Link
              to={`/accounts/${accountId}`}
              style={{ fontSize: 11, color: 'var(--text-muted)' }}
              title={t('accountSheet.openFullPage')}
            >
              {t('accountSheet.fullPage')}
            </Link>
          )}
          <button
            className="btn btn-ghost"
            style={{ fontSize: 14, padding: '2px 8px' }}
            onClick={onClose}
            aria-label={t('common.close')}
          >
            {'✕'}
          </button>
        </div>
      </div>

      {etat === 'introuvable' && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('accountSheet.notFoundBody')}</div>
      )}
      {etat === 'ok' && (
        <AccountSheet
          fiche={fiche}
          compact
          onOpenContact={onOpenContact ? (c) => onOpenContact(c, fiche.compte) : undefined}
        />
      )}
    </div>
  );
}

/* ═══ Deal Detail Panel (Data Quality → Qualité des deals context) ═══
   A deal isn't a client yet · no churn, no product lines, no "send email" quick action.
   Just the deal's own info plus a fix box for the ONE issue the user actually clicked into
   (issueType) · never a different field than what was flagged (e.g. clicking "Valeur du deal
   non renseignée" must never surface the sector field, and vice versa). */

function SectorFixBox({ client, t, onSaved }) {
  const currentSector = client.data?.sector && client.data.sector !== 'non_determine' ? client.data.sector : '';
  const [value, setValue] = useState(currentSector);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const v = value.trim();
    if (!v) return;
    setSaving(true);
    try {
      const result = await request('/data-quality/enrich-field', {
        method: 'POST',
        body: JSON.stringify({ opportunityId: client.id, field: 'sector', value: v }),
      });
      const saved = result.sector;
      if (saved === 'non_determine') {
        showToast({ type: 'info', title: t('dataQuality.dealQuality.sectorSaveTitle'), message: t('dataQuality.dealQuality.sectorNotClassified') });
        setValue('');
      } else {
        showToast({ type: 'success', title: t('dataQuality.dealQuality.sectorSaveTitle'), message: t('dataQuality.dealQuality.sectorSaved', { sector: saved }) });
        setValue(saved);
      }
      onSaved?.(client.id, { data: {...(client.data || {}), sector: saved } });
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setSaving(false);
  };

  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{t('dataQuality.dealQuality.sectorLabel')}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={t('dataQuality.dealQuality.sectorPlaceholder')}
          style={{
            flex: 1, padding: '8px 12px', border: '1px solid var(--border)',
            borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13,
          }}
        />
        <button
          className="btn btn-primary"
          style={{ fontSize: 12, padding: '8px 16px', whiteSpace: 'nowrap' }}
          disabled={saving || !value.trim()}
          onClick={handleSave}
        >
          {saving ? <Icon name="clock" size={12} /> : t('dataQuality.dealQuality.saveButton')}
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
        {t('dataQuality.dealQuality.sectorLocalOnlyNote')}
      </div>
    </div>
  );
}

function DealValueFixBox({ client, t, onSaved }) {
  const [value, setValue] = useState(client.deal_value != null ? String(client.deal_value) : '');
  const [saving, setSaving] = useState(false);
  const numValue = parseFloat(value);
  const isValid = value.trim() !== '' && !isNaN(numValue) && numValue >= 0;

  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      await request('/data-quality/enrich-field', {
        method: 'POST',
        body: JSON.stringify({ opportunityId: client.id, field: 'dealValue', value: numValue }),
      });
      showToast({
        type: 'success', title: t('dataQuality.dealQuality.dealValueSaveTitle'),
        message: t('dataQuality.dealQuality.dealValueSaved', { value: numValue.toLocaleString('fr-FR') }),
      });
      onSaved?.(client.id, { deal_value: numValue });
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setSaving(false);
  };

  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{t('dataQuality.dealQuality.dealValueLabel')}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="number"
          min="0"
          step="1"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={t('dataQuality.dealQuality.dealValuePlaceholder')}
          style={{
            flex: 1, padding: '8px 12px', border: '1px solid var(--border)',
            borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13,
          }}
        />
        <button
          className="btn btn-primary"
          style={{ fontSize: 12, padding: '8px 16px', whiteSpace: 'nowrap' }}
          disabled={saving || !isValid}
          onClick={handleSave}
        >
          {saving ? <Icon name="clock" size={12} /> : t('dataQuality.dealQuality.saveButton')}
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
        {t('dataQuality.dealQuality.dealValueLocalOnlyNote')}
      </div>
    </div>
  );
}

/* Détail du lead score · même présentation que les facteurs churn (liste
   facteur + poids). Les factors fins (persistés dans score_breakdown.factors
   par le scoring quotidien) priment ; ils ne couvrent que Activité + Fit, la
   composante Statut est donc ajoutée en ligne synthétique. Les enregistrements
   scorés avant la persistance des factors retombent sur les 3 composantes. */
function LeadScoreBreakdown({ client }) {
  const t = useT();
  let bd = client.score_breakdown;
  if (typeof bd === 'string') { try { bd = JSON.parse(bd); } catch { bd = null; } }
  if (client.score == null || !bd) return null;

  const rows = [];
  if (Array.isArray(bd.factors) && bd.factors.length > 0) {
    // weight 0 possible (ex. recency posé même hors fenêtre) · ligne sans information
    for (const f of bd.factors) {
      if (f.weight > 0) rows.push({ label: f.detail || t(`clients.scoreSignal.${f.signal}`), weight: f.weight });
    }
    if (bd.status > 0) rows.push({ label: t('clients.scoreSignal.pipeline_status'), weight: bd.status });
  } else {
    if (bd.activity > 0) rows.push({ label: t('clients.scoreSignal.activity_component'), weight: bd.activity });
    if (bd.fit > 0) rows.push({ label: t('clients.scoreSignal.fit_component'), weight: bd.fit });
    if (bd.status > 0) rows.push({ label: t('clients.scoreSignal.pipeline_status'), weight: bd.status });
  }
  if (rows.length === 0) return null;

  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', marginBottom: 16,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
        {t('clients.scoreBreakdownTitle')}
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0', display: 'flex', justifyContent: 'space-between' }}>
          <span>{r.label}</span>
          <span style={{ fontWeight: 600, color: r.weight >= 10 ? 'var(--success)' : 'var(--accent)' }}>
            {r.weight >= 0 ? '+' : ''}{r.weight}
          </span>
        </div>
      ))}
    </div>
  );
}

function DealDetailPanel({ client, issueType, multiCrm, onClose, onFieldSaved }) {
  const t = useT();
  const { lang } = useI18n();
  const STATUS_LABELS = getStatusLabels(lang);
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineExpanded, setTimelineExpanded] = useState(false);

  useEffect(() => {
    setTimelineLoading(true);
    setTimelineExpanded(false);
    request(`/crm/client/${client.id}/timeline`)
.then(data => setTimeline(data.timeline || []))
.catch(() => setTimeline([]))
.finally(() => setTimelineLoading(false));
  }, [client.id]);

  const color = STATUS_COLORS[client.status] || 'var(--text-muted)';

  return (
    <div style={DETAIL_PANEL_STYLE}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{client.name}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            {client.title && <span>{client.title}</span>}
            {client.company && <span>{client.title ? ' @ ' : ''}{client.company}</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{client.email}</div>
        </div>
        <button onClick={onClose} className="btn btn-ghost" style={{ fontSize: 14, padding: '4px 8px' }}>{'✕'}</button>
      </div>

      {/* Status + deal info badges */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, padding: '4px 14px', borderRadius: 8, background: `${color}15`, color, fontWeight: 600 }}>
          {STATUS_LABELS[client.status] || client.status}
        </span>
        {client.score != null && (
          <span style={{
            fontSize: 12, padding: '4px 14px', borderRadius: 8,
            background: 'var(--bg-elevated)', fontWeight: 700,
            color: client.score >= 70 ? 'var(--success)' : client.score >= 40 ? 'var(--warning)' : 'var(--text-muted)',
          }}>
            Score : {client.score}/100
          </span>
        )}
        {client.deal_value != null && (
          <span style={{ fontSize: 12, padding: '4px 14px', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontWeight: 600 }}>
            {Math.round(client.deal_value).toLocaleString('fr-FR')} €
          </span>
        )}
        {client.owner_email && (
          <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
            {t('clients.owner')}: {client.owner_email.split('@')[0]}
          </span>
        )}
        {client.crm_provider && multiCrm && (
          <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
            {client.crm_provider}
          </span>
        )}
      </div>

      <LeadScoreBreakdown client={client} />

      {/* Fix box, only the field matching the issue actually clicked into, never another one.
          key={client.id} : sans elle React réutilise l'instance en changeant de client et le
          useState initial ne se rejoue pas · l'input affichait le secteur du client précédent. */}
      {issueType === 'missing_sector' && <SectorFixBox key={client.id} client={client} t={t} onSaved={onFieldSaved} />}
      {issueType === 'missing_deal_value' && <DealValueFixBox key={client.id} client={client} t={t} onSaved={onFieldSaved} />}

      {/* Timeline */}
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Timeline</div>
      <UnifiedTimeline
        timeline={timeline}
        loading={timelineLoading}
        expanded={timelineExpanded}
        onToggleExpand={() => setTimelineExpanded(e => !e)}
        lang={lang}
        t={t}
      />
    </div>
  );
}

/* ═══ Client Detail Panel ═══ */

function ClientDetailPanel({ client, multiCrm, onClose, onBack, backLabel, onOpenAccount }) {
  const t = useT();
  const { lang } = useI18n();
  const STATUS_LABELS = getStatusLabels(lang);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  // Le compositeur d'email · il remplace deux invites natives du navigateur
  // enchaines. L'etat `sending` a disparu avec eux : l'envoi se fait
  // desormais DANS le compositeur, qui porte le sien.
  const [composerOuvert, setComposerOuvert] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineExpanded, setTimelineExpanded] = useState(false);

  useEffect(() => {
    setLoading(true);
    setTimelineLoading(true);
    setTimelineExpanded(false);
    request(`/crm/client/${client.id}`)
.then(data => setDetail(data))
.catch(() => setDetail(null))
.finally(() => setLoading(false));
    request(`/crm/client/${client.id}/timeline`)
.then(data => setTimeline(data.timeline || []))
.catch(() => setTimeline([]))
.finally(() => setTimelineLoading(false));
  }, [client.id]);

  /**
   * Recharge la fiche apr\u00e8s un envoi, pour que l'email apparaisse dans la
   * timeline sans que l'utilisateur ait \u00e0 rouvrir le contact.
   *
   * Un \u00e9chec de rechargement est aval\u00e9 volontairement : l'email EST parti,
   * c'est l'essentiel, et afficher une erreur ici ferait croire le contraire.
   */
  const rechargerFiche = useCallback(async () => {
    try {
      setDetail(await request(`/crm/client/${client.id}`));
    } catch {
      /* la fiche reste telle quelle */
    }
  }, [client.id]);

  const color = STATUS_COLORS[client.status] || 'var(--text-muted)';

  // Deals show only CRM activity + Baakalai emails + the current follow-up report  
  // campaign/prospecting activity is an Activation-tab concern, not the deal's own
  // CRM-facing history. Clients (status === 'won') keep every source, unchanged.
  const displayTimeline = useMemo(() => {
    if (client.status === 'won') return timeline;
    const filtered = timeline.filter(item => item.type === 'crm_activity' || item.type === 'email_sent');
    if (client.planned_followup_date) {
      filtered.unshift({
        type: 'follow_up_planned',
        date: client.planned_followup_date,
        reason: client.planned_followup_reason,
        id: 'follow-up',
      });
    }
    return filtered;
  }, [timeline, client.status, client.planned_followup_date, client.planned_followup_reason]);

  return (
    <div style={DETAIL_PANEL_STYLE}>
      {onBack && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onBack}
          style={{ fontSize: 12, padding: '2px 8px', margin: '-4px 0 10px -8px', color: 'var(--text-muted)' }}
        >
          {'← '}{t('clients.backToAccount', { name: backLabel || client.company || '' })}
        </button>
      )}
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{client.name}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            {client.title && <span>{client.title}</span>}
            {client.company && client.title && <span>{' @ '}</span>}
            {/* La société du contact ouvre SA fiche dans le même panneau : le
                chemin inverse du clic sur un contact depuis la fiche société. */}
            {client.company && (client.account_id && onOpenAccount ? (
              <button
                type="button"
                onClick={() => onOpenAccount(client.account_id)}
                title={t('clients.openCompanyOfContact')}
                style={{
                  border: 'none', background: 'none', padding: 0, font: 'inherit',
                  color: 'var(--primary)', cursor: 'pointer',
                }}
              >
                {client.company}
              </button>
            ) : <span>{client.company}</span>)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{client.email}</div>
        </div>
        <button onClick={onClose} className="btn btn-ghost" style={{ fontSize: 14, padding: '4px 8px' }}>{'\u2715'}</button>
      </div>

      {/* Status + Score */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <span style={{
          fontSize: 12, padding: '4px 14px', borderRadius: 8,
          background: `${color}15`, color, fontWeight: 600,
        }}>
          {STATUS_LABELS[client.status] || client.status}
        </span>
        {client.score != null && (
          <span style={{
            fontSize: 12, padding: '4px 14px', borderRadius: 8,
            background: 'var(--bg-elevated)', fontWeight: 700,
            color: client.score >= 70 ? 'var(--success)' : client.score >= 40 ? 'var(--warning)' : 'var(--text-muted)',
          }}>
            Score : {client.score}/100
          </span>
        )}
        {client.status === 'won' && client.churn_score != null && (
          <span style={{
            fontSize: 12, padding: '4px 14px', borderRadius: 8,
            background: client.churn_score >= 76 ? 'var(--danger-soft)' : client.churn_score >= 51 ? 'var(--warning-soft)' : client.churn_score >= 26 ? '#FEF3C7' : 'var(--success-soft)',
            color: client.churn_score >= 76 ? 'var(--danger)' : client.churn_score >= 51 ? 'var(--warning)' : client.churn_score >= 26 ? '#D97706' : 'var(--success)',
            fontWeight: 700,
          }}>
            Churn : {client.churn_score}/100
          </span>
        )}
        {client.owner_email && (
          <span style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 8,
            background: 'var(--bg-elevated)', color: 'var(--text-muted)',
          }}>
            {t('clients.owner')}: {client.owner_email.split('@')[0]}
          </span>
        )}
        {client.crm_provider && multiCrm && (
          <span style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 8,
            background: 'var(--bg-elevated)', color: 'var(--text-muted)', textTransform: 'capitalize',
          }}>
            {client.crm_provider}
          </span>
        )}
      </div>

      <LeadScoreBreakdown client={client} />

      {/* Churn factors · retention concept, won clients only */}
      {client.status === 'won' && client.churn_factors && client.churn_factors.length > 0 && (
        <div style={{
          background: client.churn_score >= 50 ? 'rgba(220,38,38,0.04)' : 'var(--bg-elevated)',
          border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
            {t('clients.churnFactors')}
          </div>
          {client.churn_factors.map((f, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0', display: 'flex', justifyContent: 'space-between' }}>
              <span>{f.detail}</span>
              <span style={{ fontWeight: 600, color: f.weight < 0 ? 'var(--success)' : f.weight >= 15 ? 'var(--danger)' : 'var(--warning)' }}>
                {f.weight >= 0 ? '+' : ''}{f.weight}
              </span>
            </div>
          ))}
        </div>
      )}

      {composerOuvert && (
        <EmailComposer
          contact={client}
          onClose={() => setComposerOuvert(false)}
          onSent={rechargerFiche}
        />
      )}

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          className="btn btn-primary"
          style={{ fontSize: 11, padding: '6px 14px' }}
          onClick={() => setComposerOuvert(true)}
          disabled={!client.email}
          title={client.email ? undefined : t('clients.noEmailForSend')}
        >
          <Icon name="mail" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
          {t('clients.sendEmail')}
        </button>
        {client.linkedin_url && (
          <a href={client.linkedin_url} target="_blank" rel="noopener noreferrer"
            className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 14px', textDecoration: 'none' }}>
            LinkedIn
          </a>
        )}
      </div>

      {/* Product lines */}
      <ProductLineTags clientId={client.id} lang={lang} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>{t('common.loading')}</div>
      ) : (
        <>
          {/* Unified Timeline */}
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Timeline</div>
          <UnifiedTimeline
            timeline={displayTimeline}
            loading={timelineLoading}
            expanded={timelineExpanded}
            onToggleExpand={() => setTimelineExpanded(e => !e)}
            lang={lang}
            t={t}
          />
        </>
      )}
    </div>
  );
}

/* ═══ Unified Timeline ═══ */

function formatRelativeDate(dateStr, lang) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);

  if (diffMs < 0) {
    // Future date (e.g. a planned follow-up report), count forward, not back.
    const futureD = Math.ceil(-diffMs / 86400000);
    if (futureD < 1) return lang === 'en' ? 'today' : "aujourd'hui";
    return lang === 'en' ? `in ${futureD}d` : `dans ${futureD}j`;
  }
  if (diffMin < 1) return lang === 'en' ? 'just now' : 'maintenant';
  if (diffMin < 60) return lang === 'en' ? `${diffMin}m ago` : `il y a ${diffMin}m`;
  if (diffH < 24) return lang === 'en' ? `${diffH}h ago` : `il y a ${diffH}h`;
  if (diffD < 7) return lang === 'en' ? `${diffD}d ago` : `il y a ${diffD}j`;
  if (diffD < 30) {
    const w = Math.floor(diffD / 7);
    return lang === 'en' ? `${w}w ago` : `il y a ${w}sem`;
  }
  return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' });
}

const TIMELINE_CONFIG = {
  email_sent: { icon: 'mail', color: 'var(--success)', label: (e, lang) => e.subject || (lang === 'en' ? 'Email' : 'Email') },
  campaign_activity: { icon: 'chart', color: 'var(--accent)', label: (e, lang) => `${e.event || ''}, ${e.campaign_name || ''}` },
  crm_activity: { icon: 'clipboard', color: 'var(--blue)', label: (e) => e.subject || e.activity_type || 'Activity' },
  follow_up_planned: {
    icon: 'calendar', color: 'var(--warning)',
    label: (e, lang) => {
      const d = new Date(e.date).toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' });
      return lang === 'en'
        ? `Follow-up ${e.reason === 'manual' ? 'postponed' : 'planned'} for ${d}`
        : `Relance ${e.reason === 'manual' ? 'report\u00e9e' : 'pr\u00e9vue'} au ${d}`;
    },
  },
};

function getTimelineIcon(item) {
  if (item.type === 'crm_activity') {
    if (item.activity_type === 'call') return 'phone';
    if (item.activity_type === 'meeting') return 'calendar';
    return 'clipboard';
  }
  return TIMELINE_CONFIG[item.type]?.icon || 'activity';
}

function getTimelineColor(item) {
  if (item.type === 'email_sent') {
    if (item.status === 'sent') return 'var(--success)';
    if (item.status === 'pending') return 'var(--warning)';
    if (item.status === 'failed') return 'var(--danger)';
    return 'var(--text-muted)';
  }
  return TIMELINE_CONFIG[item.type]?.color || 'var(--text-muted)';
}

function getTimelineDescription(item, lang) {
  const cfg = TIMELINE_CONFIG[item.type];
  if (!cfg) return item.type;
  return cfg.label(item, lang);
}

function getTimelineSourceLabel(item) {
  const src = item.source || '';
  if (src === 'nurture') return 'Nurture';
  return src.charAt(0).toUpperCase() + src.slice(1);
}

function UnifiedTimeline({ timeline, loading, expanded, onToggleExpand, lang, t }) {
  if (loading) {
    return <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>{t('common.loading')}</div>;
  }

  if (timeline.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12, marginBottom: 20 }}>
        {t('clients.noActivity')}
      </div>
    );
  }

  const visible = expanded ? timeline : timeline.slice(0, 10);

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ position: 'relative', paddingLeft: 24 }}>
        {/* Vertical line */}
        <div style={{
          position: 'absolute', left: 7, top: 4, bottom: 4, width: 2,
          background: 'var(--border)', borderRadius: 1,
        }} />

        {visible.map((item, idx) => {
          const color = getTimelineColor(item);
          const icon = getTimelineIcon(item);
          const desc = getTimelineDescription(item, lang);
          const sourceLabel = getTimelineSourceLabel(item);

          return (
            <div key={item.id || idx} style={{ position: 'relative', paddingBottom: idx < visible.length - 1 ? 8 : 0 }}>
              {/* Dot */}
              <div style={{
                position: 'absolute', left: -20, top: 3, width: 12, height: 12,
                borderRadius: '50%', background: 'var(--bg-card)', border: `2px solid ${color}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, zIndex: 1,
              }} />

              {/* Content */}
              <div style={{
                padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
                borderLeft: `3px solid ${color}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--text-muted)', marginBottom: 1 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Icon name={icon} size={12} color={color} />
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 4,
                      background: `${color}15`, color, fontWeight: 600,
                    }}>
                      {sourceLabel}
                    </span>
                    {item.type === 'email_sent' && item.status && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {item.status === 'sent' ? (lang === 'en' ? 'sent' : 'envoy\u00e9')
                          : item.status === 'pending' ? (lang === 'en' ? 'pending' : 'en attente')
                          : item.status === 'replied' ? (lang === 'en' ? 'replied' : 'r\u00e9pondu')
                          : item.status === 'opened' ? (lang === 'en' ? 'opened' : 'ouvert')
                          : item.status}
                      </span>
                    )}
                    {item.type === 'crm_activity' && item.done && <span style={{ fontSize: 10 }}><Icon name="checkCircle" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} /></span>}
                  </span>
                  <span style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{formatRelativeDate(item.date, lang)}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {timeline.length > 10 && (
        <button
          onClick={onToggleExpand}
          style={{
            display: 'block', margin: '10px auto 0', padding: '6px 16px', fontSize: 11,
            border: '1px solid var(--border)', borderRadius: 8, background: 'transparent',
            color: 'var(--accent)', cursor: 'pointer', fontWeight: 600,
          }}
        >
          {expanded
            ? (lang === 'en' ? 'Show less' : 'Voir moins')
            : (lang === 'en' ? `Show all ${timeline.length} activities` : `Voir les ${timeline.length} activit\u00e9s`)}
        </button>
      )}
    </div>
  );
}
