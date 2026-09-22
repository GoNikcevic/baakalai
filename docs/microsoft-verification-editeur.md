# Débloquer Outlook · vérification d'éditeur Microsoft

État au 2026-09-22. Ce document couvre la partie qui ne peut PAS être réglée en
écrivant du code : elle se fait dans les portails Microsoft, avec les comptes de
Goran et le DNS de baakal.ai.

Le côté logiciel est traité : quand Microsoft refuse, l'application le dit
désormais clairement et propose le lien de consentement administrateur, au lieu
d'afficher « Échec de connexion, veuillez réessayer ». Voir
`backend/lib/microsoft-graph.js` et `backend/routes/nurture.js`.

## Le problème, en une phrase

Le réglage par défaut d'Entra ID n'autorise un utilisateur à consentir qu'aux
applications d'**éditeurs vérifiés**. baakal.ai ne l'est pas, donc un testeur
beta se fait refuser, et rien de ce qu'il fait n'y changera quoi que ce soit.

Application concernée : **Baakalai Email**, client ID
`60134d9b-39c0-4810-a182-c61f7d54ef71`.

## Vérification à faire AVANT tout le reste

Le connecteur Outlook demande deux autorisations sur DEUX ressources
différentes, parce qu'Azure AD ne délivre un jeton que pour une ressource à la
fois :

| Usage | Ressource | Permission |
|---|---|---|
| Envoyer | `outlook.office365.com` | `SMTP.Send` |
| Lire les réponses | `graph.microsoft.com` | `Mail.Read` |

La note du 2026-05-20 recense 5 permissions sur l'application : `email`,
`openid`, `profile`, `offline_access`, `SMTP.Send`. **`Mail.Read` n'y figure
pas.** Elle a été ajoutée côté code le 2026-09-22 (migration 111) mais personne
n'a confirmé qu'elle est déclarée côté Azure.

Si elle manque, la lecture des réponses échouera pour tout le monde, y compris
après vérification d'éditeur, et le consentement administrateur ne la couvrira
pas non plus : il n'accorde que ce qui est déclaré sur l'application.

**À faire en premier**, portail Azure → Microsoft Entra ID → App registrations →
Baakalai Email → API permissions : vérifier que `Microsoft Graph > Mail.Read`
(déléguée) est présente. L'ajouter sinon.

## Le contournement, disponible dès maintenant

Tant que la vérification n'est pas obtenue, un testeur dont l'organisation
bloque le consentement voit maintenant un encadré lui expliquant la situation,
avec un lien à transmettre à son service informatique. L'administrateur autorise
baakalai une fois, pour tout le tenant, et le testeur reprend la connexion.

L'administrateur n'a pas besoin d'un compte baakalai. Le lien reste valable même
après un redéploiement.

Ce contournement garde son utilité après la vérification : beaucoup
d'organisations verrouillent le consentement utilisateur en toutes
circonstances.

## Le vrai correctif, en trois étapes

### 1. Vérifier le domaine baakal.ai dans Entra ID

Portail Azure → Microsoft Entra ID → Custom domain names → Add custom domain →
`baakal.ai`. Azure donne un enregistrement **TXT** à poser sur le DNS du
domaine, puis on revient cliquer sur Verify.

Le DNS de baakal.ai est chez Cloudflare (la landing y est hébergée). Penser à
mettre le TXT en mode « DNS only », pas derrière le proxy.

### 2. Débloquer le compte Partner Center

C'est là que ça a calé le 2026-05-20 : le compte Partner Center a été créé mais
bloque sur l'exigence de **compte professionnel**, parce que le domaine n'était
pas vérifié. L'étape 1 est donc un prérequis, pas une option.

Se connecter à Partner Center avec une adresse **@baakal.ai**, pas une adresse
Gmail. Aller au bout de l'inscription au Microsoft AI Cloud Partner Program
(ex-MPN) et récupérer l'**identifiant de partenaire** (Partner One ID / MPN ID).

L'inscription demande des informations d'entreprise vérifiables : dénomination
légale, adresse, et un contact joignable. La vérification par Microsoft peut
prendre plusieurs jours ouvrés. Ce n'est pas instantané, il faut le prévoir.

### 3. Associer l'identifiant à l'application

Portail Azure → App registrations → Baakalai Email → Branding & properties →
Publisher domain : `baakal.ai`. Puis, sur la même page, renseigner
l'identifiant de partenaire obtenu à l'étape 2.

Une fois fait, l'écran de consentement affiche « Éditeur vérifié » avec la
coche bleue, et les tenants qui n'autorisent que les éditeurs vérifiés laissent
passer le consentement utilisateur.

## Comment savoir que c'est bon

Sans attendre un testeur : ouvrir la connexion Outlook depuis un compte
Microsoft appartenant à une organisation tierce, pas au tenant de baakalai. Si
l'écran de consentement porte la mention d'éditeur vérifié et que la connexion
aboutit, c'est réglé.

Les codes d'erreur d'Azure sont maintenant écrits dans les logs de production
avec leur numéro `AADSTS`, ce qui permet de diagnostiquer sans avoir le testeur
au téléphone. Chercher `email-oauth` dans les logs Railway.
