# CLAUDE.md -- Sassify Ops

Cockpit prive (mot de passe unique) : surveillance des services (disponibilite, latence, certificat SSL), deploiements, alertes, couts des SaaS (appels API par projet/fournisseur + couts fixes), et premieres briques pour Serveurs et Revenus. En ligne sur `https://pilotage.sassify.fr` (VPS Hostinger : process PM2 `pilotage`, dossier `/srv/saas/pilotage`, port 3011 ; nginx `proxy_pass http://127.0.0.1:3011`). Le `.env` n'est pas versionne et doit etre cree a la main dans ce dossier.

## Stack
Nuxt 3.21 + Prisma 6 + Neon Postgres + Tailwind **3.4** (via `@nuxtjs/tailwindcss` 6 ; pas de v4). Versions epinglees comme prospector. Theme : `tailwind.config.cjs` (.cjs car `"type": "module"`), design sombre issu de la maquette `Sassify Ops.html` (tokens dans `assets/css/main.css`, polices Instrument Sans + JetBrains Mono via Google Fonts).

## Ecrans (`pages/`) et API
| Ecran | Donnees |
|---|---|
| `/` Vue d'ensemble | `GET /api/overview` : services (sondes), alertes, KPI, couts 30 j, derniers deploiements |
| `/servers` | `GET /api/servers` (table `ServerMetric`, **aucune source branchee** : etat vide) |
| `/deployments` | `GET /api/deployments` ; alimente par `POST /api/ingest/deploy` (workflow GitHub Actions, snippet copiable dans l'ecran) |
| `/alerts` | `GET /api/alerts`, `POST /api/alerts/:id/ack`, `PATCH /api/alert-rules/:key`, `PUT /api/settings/budget` |
| `/costs`, `/fixed-costs` | `GET /api/costs/summary`, `/api/fixed-costs` |
| `/revenue` | `GET /api/revenue` (table `MrrSnapshot`, **aucune source branchee** : etat vide) |
Gestion des services surveilles : `GET/POST /api/services`, `DELETE /api/services/:slug` (API seulement, pas d'ecran).

## Surveillance (sondes, alertes) : conception a ne pas casser
- **Neon gratuit = quota de calcul limite (~100 CU-h/mois/projet)**. Une ecriture toutes les 2 min empecherait la base de se mettre en veille (epuisement en ~17 jours). Donc : l'etat recent des sondes vit **en memoire** (`server/utils/probes.ts`) et la base ne recoit qu'un **cumul par heure** (`ProbeRollup`, fusionne si redemarrage en cours d'heure, ecrit aussi a l'arret via le hook Nitro `close`). Les alertes ouvertes sont cachees en memoire (`server/utils/alerts.ts`) : la base n'est touchee que lors d'un changement d'etat. Les regles sont rechargees au plus 1 fois/heure.
- Sondes : GET sur chaque `Service` toutes les 120 s (`NUXT_PROBE_INTERVAL_SEC`), actives en production seulement (`NUXT_PROBES_ENABLED` pour forcer). 2xx/3xx/4xx = repond ; 5xx et erreurs reseau = panne. Certificat SSL relu toutes les 6 h. Services par defaut (11) crees au premier demarrage (`DEFAULT_SERVICES`).
- Regles (`server/utils/uptime.ts`, pures et testees) : `service_down` = 2 echecs consecutifs ; `latency_high` = au moins 3 mesures dans la fenetre (10 min) dont **>= 60 % au-dessus du seuil** (800 ms) -- jamais le p95 sur 5 points (c'est le maximum : un pic isole alertait a chaque redemarrage) ; `cert_expiry` <= 14 j ; `deploy_failed` (evenementielle, production) ; `budget_threshold` (85 % du plafond mensuel, verifie a l'ingestion de couts et chaque heure). Statut "degrade" = **mediane** des 5 dernieres mesures > seuil.
- Garde-fous : une alerte n'est jamais auto-resolue tant qu'un service a < 3 mesures (apres redemarrage) ; l'initialisation est retentee a chaque tour si la base est injoignable ; journaux dedoublonnes (1 message identique / 10 min). Teste : base injoignable 50 s -> process vivant, 3 messages de journal.
- Correlation : une alerte de latence/panne ouverte dans les 90 min suivant un deploiement de production du meme projet le mentionne.
- Telegram (optionnel) : `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (noms des autres apps) ou `NUXT_TELEGRAM_*`, dans `.env` OU `.env.local` (`server/utils/telegram.ts` lit `.env.local` a la demande, car `node --env-file=.env` ne le charge pas). Le chat recoit aussi les articles de blog a valider : les messages d'ops portent l'en-tete `🛰 SASSIFY OPS`, un libelle propre (alerte critique / avertissement / resolue) et le mot-cle `#sassify_ops` (`server/utils/telegramFormat.ts`, teste). Resolutions silencieuses. Bouton « Envoyer un message de test » dans l'ecran Alertes. `NUXT_TELEGRAM_DISABLED=true` coupe tout envoi : **obligatoire sur tout poste de test, car le `.env.local` local contient le vrai token**. Detection de la config verifiee ; envoi reel jamais execute par l'assistant.
- Les cles `NUXT_PUBLIC_*` sont lues par Nuxt comme `runtimeConfig.public.*` : ne pas nommer une cle privee `public...` (d'ou `siteUrl`/`NUXT_SITE_URL`).

## Couts
- `POST /api/ingest/cost` : les SaaS envoient leurs couts (header `x-ops-key` = `NUXT_INGEST_KEY`), soit avec `amount` (cout connu), soit avec `llm` (tokens : ops calcule le cout via `server/utils/pricing.ts`).
- `server/utils/pricing.ts` : table de prix LLM (USD / million de tokens) avec date de verification et niveau de confiance. Un modele absent n'est JAMAIS devine : cout 0 + `meta.priceMissing`, signale par une banniere (`unpriced`). Les alias dates (`claude-opus-4-5-20251101`, `gpt-4.1-mini-2025-04-14`) sont acceptes, pas les variantes (`gpt-image-1-mini` n'est pas facture comme `gpt-image-1`). Le tarif Gemini 3.8 Flash change au 2027-01-01.
- `server/utils/costs.ts` : calcul partage (summary, overview, budget). Comparaison avec la periode precedente et plafond mensuel (`Setting` `monthly_budget_eur`).
- Les montants USD sont convertis en EUR a l'ingestion (`NUXT_USD_TO_EUR`) et figes.
- Auth : cookie signe HMAC (`server/utils/auth.ts`), toute l'API sauf login/ingest protegee par `server/middleware/auth.ts`, rate limit login en memoire.

## Clients de telemetrie (copies a garder synchronisees)
- `clients/ops-cost.ts` -> `tifo/lib/ops-cost.ts`, `skincareapp/lib/ops-cost.ts` (`instrumentAnthropic`, `instrumentOpenAI`, `trackCost`).
- `clients/ops-cost.plotline.js` -> `plotline/server/utils/opsCost.js` + plugin `plotline/server/plugins/ops-cost.js` (patch de prototype Anthropic + Gemini).
- Prospector a son propre `server/utils/ops-cost.ts` (Google Places, montant fixe par requete).
- Regles : fire-and-forget, timeout 10 s (demarrage a froid de Neon), circuit breaker, jamais d'erreur remontee, sans effet sans `OPS_URL`/`OPS_INGEST_KEY`. Non couvert : streaming, Interactions/Veo/Kling/ElevenLabs.

## Pieges deja rencontres (ne pas refaire)
- Variables d'env : chargees par `node --env-file=.env` (script `start` + `node_args` PM2). Les cles `NUXT_*` surchargent `runtimeConfig` au runtime. Aucun secret dans `ecosystem.config.cjs`.
- `npm install` plante (npm 10.9, `edgesOut`) sans `legacy-peer-deps` : voir `.npmrc`. Garder `npm ci` coherent avec ce reglage.
- PM2 : `max_restarts` + `exp_backoff_restart_delay` pour eviter une boucle de crash qui sature disque/logs (incident prospector 25/09/2026).
- `package.json` a `"type": "module"` : le fichier PM2 doit etre en `.cjs`.
- 502 au premier deploiement (2026-10-22, voir `tasks/lessons.md`) : `ecosystem.config.cjs` doit refleter le vrai nom (`pilotage`), dossier (`/srv/saas/pilotage`) et port (`3011`, celui du `proxy_pass` nginx), et le `.env` non versionne doit exister dans le `cwd` sinon `node --env-file=.env` quitte avec `.env: not found`. Apres changement du fichier PM2 : `pm2 delete pilotage && pm2 start ecosystem.config.cjs && pm2 save` (un reload garde l'ancien cwd).
- **Schema Prisma : le workflow de deploiement ne fait PAS `prisma db push`.** Toute nouvelle table doit etre poussee sur la base de prod **avant** le deploiement du code qui l'utilise (sinon `/api/overview` & co renvoient 500 et le menu perd son compteur d'alertes).
- Neon gratuit se met en veille : le reveil peut depasser les 5 s que Prisma tolere (`Can't reach database server`, P1001). Mettre `&connect_timeout=15` dans `DATABASE_URL` (voir `.env.example`).
- Windows : `pkill` ne tue pas les `node.exe` lances depuis Git Bash ; un serveur de test oublie verrouille `.output\...\query_engine-windows.dll.node` (EPERM au build, `prisma generate`). Lancer/arreter par PID avec PowerShell (`Start-Process -PassThru` / `Stop-Process`). Verifier l'identite d'un processus (ligne de commande) AVANT de l'arreter : le `nuxt dev` de l'utilisateur tourne parfois sur le port 3020.
- Les serveurs de test lances en arriere-plan peuvent etre tues quand un tour est interrompu : enchainer demarrage, verification et arret dans une seule commande.
- PowerShell : ne jamais faire `script-qui-lance-un-serveur.ps1 | Out-Null` : le serveur herite du tuyau, qui reste ouvert tant qu'il tourne, et la commande ne revient jamais.
- PowerShell 5.1 + cookie `Secure` : `Invoke-RestMethod` ne renvoie pas le cookie de session en HTTP, faire les tests d'API authentifiee depuis Node.
- Elements `sr-only` (position absolue) dans un tableau : le conteneur `overflow-x-auto` doit etre `relative`, sinon ils elargissent toute la page sur mobile.

## Tests locaux (sans toucher la prod)
- Branche Neon `dev` du projet `ops` (id `br-curly-truth-ba2fyg6y`, copie de la prod au 2026-10-22), URL dans `.env.dev` (gitignore). Usage : `node --env-file=.env --env-file=.env.dev ...` (le dernier fichier l'emporte). Elle contient des donnees d'exemple.
- Pour se connecter en test sans le vrai mot de passe : lancer le serveur avec `NUXT_ADMIN_PASSWORD` et `NUXT_SESSION_SECRET` jetables.
- Captures d'ecran : le volet navigateur integre ne dessine rien si la fenetre est masquee ; utiliser Chrome sans interface via `puppeteer-core` (installe hors du projet).
- Logique pure testee : `server/utils/uptime.ts`, `server/utils/pricing.ts` (tests dans le scratchpad de session, a recreer au besoin avec `tsx`).

## Deploiement
Workflow GitHub Actions `.github/workflows/deploy.yml` (push sur `main` -> `git reset --hard`, `npm install`, `prisma generate`, `rm -rf .output`, build, `pm2 reload pilotage`). Premiere installation : `git clone` dans `/srv/saas/pilotage`, `.env` (voir `.env.example`, `chmod 600`), `npm ci && npx prisma db push && npm run build`, `pm2 start ecosystem.config.cjs && pm2 save`, nginx + certbot (A uniquement, pas de AAAA).

## Etat
- [x] Squelette, auth, ingestion, agregation, pages couts + couts fixes ; calcul de cout LLM cote ops ; clients de telemetrie pousses dans plotline (`2eb8cf2`), skincareapp (`88bb651`), tifo (`004c303`)
- [x] Deploye sur `https://pilotage.sassify.fr` (2026-10-22), repo `https://github.com/JeremieN6/sassify-ops.git`
- [x] **Schema applique sur la base de PROD le 2026-10-22** (3 types, 8 tables, 10 index, 3 cles etrangeres, purement additif ; lignes existantes inchangees : 1 projet, 11 appels de cout, 2 couts fixes).
- [x] **Refonte UI complete + premieres briques (2026-10-22, commitee et poussee)** : 7 ecrans d'apres la maquette ; sondes de disponibilite ; reception des deploiements ; moteur d'alertes + Telegram ; ecrans Serveurs/Revenus (schema + etat vide). Verifie : build, 8 pages x desktop/mobile (captures), sondes reelles sur la branche dev, ouverture/resolution automatique d'alertes, correlation avec un deploiement, base injoignable.
- [ ] Sur le VPS : `&connect_timeout=15` dans le `DATABASE_URL` du `.env` de `/srv/saas/pilotage` (deja fait dans le `.env` local). Telegram : token et chat deja poses par l'utilisateur dans `.env.local`, lus automatiquement.
- [ ] Verifier apres le deploiement : `/alerts` -> « Envoyer un message de test » ; les sondes demarrent (journal PM2 `[monitoring] actif : 11 service(s)`).
- [ ] Ajouter l'etape de notification (snippet de l'ecran Deploiements) a chaque workflow + secrets GitHub `OPS_URL` et `OPS_INGEST_KEY` par depot
- [ ] Definir `OPS_URL` + `OPS_INGEST_KEY` dans les `.env` de prospector, plotline, tifo, skincareapp sur le VPS puis `pm2 reload`
- [ ] Agent VPS (CPU/memoire/disque/PM2 -> `ServerMetric`) ; synchronisation Stripe (MRR -> `MrrSnapshot`)
- [ ] Prix a reverifier : modeles Gemini image (`summary`, pas verbatim) ; collecteurs Upstash / API de facturation ; couts video et voix de plotline
