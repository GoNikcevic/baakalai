# Débloquer Outlook · vérification d'éditeur Microsoft

Procédure pas à pas, vérifiée sur la documentation Microsoft à jour au
2026-09-22. Cette partie ne peut PAS être réglée en écrivant du code : elle se
fait dans les portails Microsoft, avec les comptes de Goran et le DNS de
baakal.ai.

Le côté logiciel est traité : quand Microsoft refuse, l'application le dit
désormais clairement et propose le lien de consentement administrateur, au lieu
d'afficher « Échec de connexion, veuillez réessayer ». Voir
`backend/lib/microsoft-graph.js` et `backend/routes/nurture.js`.

Application concernée : **Baakalai Email**, client ID
`60134d9b-39c0-4810-a182-c61f7d54ef71`.

---

## Pourquoi c'est bloqué, exactement

Depuis novembre 2020, Microsoft applique le *risk-based step-up consent*. Une
application qui remplit ces trois conditions ne peut PAS recevoir le
consentement d'un utilisateur ordinaire :

1. enregistrée après le 2020-11-08,
2. demandant des permissions qui dépassent la connexion de base et la lecture du
   profil,
3. demandant ce consentement à un utilisateur d'un AUTRE tenant que celui où
   l'application est enregistrée.

baakalai coche les trois : `SMTP.Send` et `Mail.Read` dépassent largement la
connexion de base, et chaque testeur beta est dans son propre tenant. Le refus
n'est donc pas un réglage malheureux chez un client, c'est le comportement par
défaut de Microsoft pour toute application non vérifiée. Aucun testeur ne
passera tant que la vérification n'est pas obtenue.

---

## ÉTAPE 0 · Le point qui peut tout invalider, à vérifier en premier

> **Une application enregistrée avec un compte Microsoft personnel ne peut
> JAMAIS être vérifiée.** Seules les applications enregistrées avec un compte
> professionnel ou scolaire (Microsoft Entra work or school account) sont
> éligibles.

C'est très probablement le vrai mur du 2026-05-20, celui que Partner Center
appelait « professional account ». Si « Baakalai Email » a été créée depuis un
compte Microsoft rattaché à `g.nikcevic@gmail.com`, aucune des étapes suivantes
ne servira à rien : il faudra **réenregistrer l'application** dans un tenant
Entra professionnel, et redéployer un nouveau client ID.

**Comment vérifier :** portail Azure → Microsoft Entra ID → App registrations →
Baakalai Email → Overview. Regarder le champ **Supported account types** et le
tenant dans lequel l'application vit. Si le portail affiche un tenant de type
« Personal Microsoft account » ou si tu n'as pas de tenant Entra avec un domaine
à toi, l'étape 0 échoue.

**Si elle échoue**, le chemin devient : créer un tenant Microsoft Entra pour
baakal.ai, y réenregistrer l'application, poser les nouveaux
`MICROSOFT_CLIENT_ID` et `MICROSOFT_CLIENT_SECRET` sur Railway, et refaire
connecter les boîtes déjà branchées. À chiffrer avant de s'y lancer, mais il n'y
a pas de contournement : c'est une exigence de Microsoft, pas un réglage.

**Si elle passe**, continuer ci-dessous.

---

## ÉTAPE 0 bis · Vérifier que Mail.Read est déclarée

Indépendant de la vérification d'éditeur, mais à faire tant qu'on est dans le
portail, parce que l'oublier ferait croire le problème réglé alors qu'il ne le
serait qu'à moitié.

Le connecteur Outlook demande deux autorisations sur DEUX ressources
différentes, Azure AD ne délivrant un jeton que pour une ressource à la fois :

| Usage | Ressource | Permission |
|---|---|---|
| Envoyer | `outlook.office365.com` | `SMTP.Send` |
| Lire les réponses | `graph.microsoft.com` | `Mail.Read` |

La note du 2026-05-20 recense 5 permissions sur l'application : `email`,
`openid`, `profile`, `offline_access`, `SMTP.Send`. **`Mail.Read` n'y figure
pas.** Elle a été ajoutée côté code le 2026-09-22 (migration 111) mais personne
n'a confirmé qu'elle est déclarée côté Azure.

**À faire :** App registrations → Baakalai Email → **API permissions**.
Vérifier la présence de `Microsoft Graph > Mail.Read` en type **Delegated**.
L'ajouter sinon, via **Add a permission** → Microsoft Graph → Delegated
permissions → chercher `Mail.Read`.

Sans elle, la détection des réponses échouera pour tout le monde, même après
vérification, et le consentement administrateur ne la couvrira pas non plus : il
n'accorde que ce qui est déclaré sur l'application.

---

## ÉTAPE 1 · Vérifier le domaine baakal.ai dans le tenant

Objectif : que baakal.ai soit un **custom domain vérifié par DNS** sur le tenant
Entra. C'est ce qui débloque l'étape 3, parce que Microsoft exige que le domaine
de l'adresse email utilisée pour la vérification Partner Center corresponde au
publisher domain de l'application, ou à un domaine vérifié du tenant.

1. Portail Azure → **Microsoft Entra ID** → **Custom domain names**.
2. **Add custom domain** → saisir `baakal.ai` → **Add domain**.
3. Azure affiche un enregistrement **TXT** à poser. Noter le nom et la valeur.
4. Sur **Cloudflare**, zone baakal.ai → DNS → Add record :
   - Type : `TXT`
   - Name : celui donné par Azure, souvent `@` pour la racine
   - Content : la valeur donnée par Azure
   - **Proxy status : DNS only.** Un enregistrement TXT ne se proxifie pas, mais
     vérifier que Cloudflare ne l'a pas mis derrière le nuage orange.
5. Attendre la propagation. Contrôler depuis un terminal :
   `nslookup -type=TXT baakal.ai`
6. Revenir sur Azure et cliquer **Verify**.

À la fin, baakal.ai doit apparaître avec le statut **Verified**.

---

## ÉTAPE 2 · Obtenir le Partner One ID

Attention au vocabulaire : ce qu'on appelait **MPN ID** s'appelle maintenant
**Partner One ID**, et le Microsoft Partner Network s'appelle **Microsoft AI
Cloud Partner Program (CPP)**. La documentation et le portail mélangent encore
les deux jeux de termes.

1. Aller sur <https://partner.microsoft.com/membership> et se connecter **avec
   une adresse @baakal.ai**, pas avec une adresse Gmail. C'est ici que ça avait
   calé : l'inscription exige un compte professionnel, et il dépend du domaine
   vérifié à l'étape 1.
2. Aller au bout de l'inscription au CPP. Microsoft demande des informations
   d'entreprise vérifiables : dénomination légale, adresse, contact joignable.
3. **Attendre la validation.** Le compte doit avoir terminé le processus de
   *verification* côté Partner Center. Ce n'est pas instantané et cela peut
   prendre plusieurs jours ouvrés. Suivre l'état dans Partner Center →
   Settings → Account settings → **Identifiers**.
4. Récupérer le **Partner One ID** dans cette même page Identifiers.

Deux pièges à connaître :

- Il faut le **Partner Global Account (PGA)**, l'identifiant du compte global.
  Un *Partner Location Account* n'est **pas** accepté pour la vérification
  d'éditeur. Si la page Identifiers en liste plusieurs, prendre celui marqué
  comme global.
- Le tenant Entra où l'application est enregistrée doit être associé au PGA. Si
  ce n'est pas le tenant principal du PGA, il faut d'abord le rattacher via la
  configuration *multi-tenant account* de Partner Center.

L'inscription et la vérification sont **gratuites**. Microsoft ne facture rien
pour devenir éditeur vérifié, et aucune licence n'est requise.

---

## ÉTAPE 3 · Associer le Partner One ID à l'application

Prérequis de rôles, à contrôler avant de commencer, sinon le bouton reste
inopérant :

| Où | Rôle nécessaire |
|---|---|
| Microsoft Entra ID | Application Administrator **ou** Cloud Application Administrator |
| Partner Center | CPP Partner Admin **ou** Account Admin |

Et la connexion doit se faire **avec l'authentification multifacteur activée**.
Microsoft l'exige explicitement pour initier la vérification.

1. Se connecter sur <https://aka.ms/PublisherVerificationPreview> en MFA, avec
   le compte professionnel qui porte les deux rôles ci-dessus.
2. Choisir l'application **Baakalai Email**.
3. Ouvrir **Branding & properties**.
4. Vérifier que le champ **Publisher domain** est renseigné et vaut `baakal.ai`.
   Il ne doit PAS être en `*.onmicrosoft.com` : une application dont le
   publisher domain est en onmicrosoft.com ne peut pas être vérifiée.
5. En bas de la page, cliquer **Add Partner ID to verify publisher**.
6. Saisir le **Partner One ID** de l'étape 2.
7. Cliquer **Verify and save**. Le traitement prend quelques minutes.
8. Si ça réussit, la fenêtre se ferme et une **pastille bleue « verified »**
   apparaît à côté du **Publisher display name**.

---

## Comment savoir que c'est vraiment réglé

Ne pas attendre qu'un testeur se manifeste.

Ouvrir la connexion Outlook depuis un compte Microsoft appartenant à une
**organisation tierce**, pas au tenant de baakalai : c'est le seul scénario qui
reproduit le problème, puisque le refus ne se déclenche que pour un utilisateur
d'un autre tenant. Si l'écran de consentement affiche la pastille d'éditeur
vérifié et que la connexion aboutit, c'est réglé.

Le code force déjà `prompt=consent` sur le flux de lecture, donc l'écran de
consentement réapparaît même pour un compte qui avait déjà consenti.

La réplication chez Microsoft n'est pas immédiate : la pastille peut mettre un
peu de temps à apparaître partout après l'opération.

---

## Diagnostiquer sans avoir le testeur au téléphone

Les codes d'erreur d'Azure sont maintenant écrits dans les logs de production
avec leur numéro `AADSTS`, ce qui n'était pas le cas avant le 2026-09-22.

Chercher `email-oauth` dans les logs Railway de l'environnement production.

| Code | Ce que ça veut dire |
|---|---|
| `AADSTS90094` | l'octroi demande une autorisation d'administrateur |
| `AADSTS65001` | l'utilisateur ou l'administrateur n'a pas consenti |
| `AADSTS900941` | consentement administrateur requis sur ce tenant |
| `AADSTS50194` | application non configurée comme multi-tenant |
| `AADSTS65004` | l'utilisateur a explicitement refusé |

Les quatre premiers signifient « il faut un administrateur » et l'application
affiche alors le lien de consentement à transmettre à l'IT. Le dernier est un
refus de l'utilisateur lui-même, et réessayer a du sens.

---

## Le contournement, disponible dès maintenant

Tant que la vérification n'est pas obtenue, un testeur dont l'organisation
bloque le consentement voit un encadré lui expliquant la situation, avec un lien
à transmettre à son service informatique. L'administrateur autorise baakalai une
fois, pour tout le tenant, et le testeur reprend la connexion.

L'administrateur n'a pas besoin d'un compte baakalai, et le lien reste valable
après un redéploiement.

Ce contournement garde son utilité après la vérification : beaucoup
d'organisations verrouillent le consentement utilisateur en toutes
circonstances, y compris pour les éditeurs vérifiés.

---

## Sources

- [Publisher verification overview](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)
- [Mark an app as publisher verified](https://learn.microsoft.com/en-us/entra/identity-platform/mark-app-as-publisher-verified)
- [Troubleshoot publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/troubleshoot-publisher-verification)
