# CLAUDE.md -- Sassify Ops

Dashboard prive (mot de passe unique) pour suivre les couts des SaaS : appels API par projet/fournisseur + couts fixes. Prevu pour `ops.sassify.fr` sur le VPS Hostinger (PM2, nginx, `/srv/saas/ops`, port 3020).

## Stack
Nuxt 3.21 + Prisma 6 + Neon Postgres + Tailwind. Versions epinglees comme prospector.

## Fonctionnement
- `POST /api/ingest/cost` : les SaaS envoient leurs couts (header `x-ops-key` = `NUXT_INGEST_KEY`), soit avec `amount` (cout connu), soit avec `llm` (tokens : ops calcule le cout via `server/utils/pricing.ts`).
- `server/utils/pricing.ts` : table de prix LLM (USD / million de tokens) avec date de verification et niveau de confiance. Un modele absent n'est JAMAIS devine : cout 0 + `meta.priceMissing`, signale par une banniere sur le dashboard (`unpriced`). Les alias dates (`claude-opus-4-5-20251101`, `gpt-4.1-mini-2025-04-14`) sont acceptes, pas les variantes (`gpt-image-1-mini` n'est pas facture comme `gpt-image-1`). Le tarif Gemini 3.8 Flash change au 2027-01-01.
- `GET /api/costs/summary?range=7d|30d|90d|month|lastmonth` : agregats par projet, par fournisseur, par jour + derniers appels + `unpriced`.
- `/fixed-costs` : couts recurrents saisis a la main, proratises au jour.
- Auth : cookie signe HMAC (`server/utils/auth.ts`), toute l'API sauf login/ingest protegee par `server/middleware/auth.ts`, rate limit login en memoire.
- Les montants USD sont convertis en EUR a l'ingestion (`NUXT_USD_TO_EUR`) et figes.

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
- Windows : `pkill` ne tue pas les `node.exe` lances depuis Git Bash ; un serveur de test oublie verrouille `.output\...\query_engine-windows.dll.node` (EPERM au build). Lancer/arreter par PID avec PowerShell (`Start-Process -PassThru` / `Stop-Process`).
- PowerShell 5.1 + cookie `Secure` : `Invoke-RestMethod` ne renvoie pas le cookie de session en HTTP, faire les tests d'API authentifiee depuis Node.
- Neon gratuit se met en veille : la premiere requete apres inactivite peut depasser 3 s (d'ou le timeout client de 10 s).

## Deploiement (manuel pour l'instant)
`git clone` dans `/srv/saas/ops`, creer `.env` (voir `.env.example`, `chmod 600`), `npm ci && npx prisma db push && npm run build`, `pm2 start ecosystem.config.cjs && pm2 save`, nginx + certbot (A uniquement, pas de AAAA), DNS `ops`.

## Etat
- [x] Squelette, auth, ingestion, agregation, pages couts + couts fixes
- [x] Base Neon dediee (projet Neon `ops`, id `wispy-boat-81246396`, org Shiplab, aws-eu-central-1, pg17, URL pooler) + `.env` local genere + schema pousse + test de bout en bout OK (2026-10-19). `npm run demo` injecte des donnees fictives : a nettoyer apres usage (base de prod).
- [x] Calcul de cout LLM cote ops (Anthropic, OpenAI, Gemini) + clients branches dans plotline, tifo, skincareapp (2026-10-19, non commites dans ces repos)
- [x] Telemetrie Google Places dans prospector (ecrite ; ne JAMAIS l'executer tant que l'utilisateur n'est pas rembourse)
- [ ] Deployer `ops` sur le VPS, puis definir `OPS_URL` + `OPS_INGEST_KEY` dans les `.env` de prospector, plotline, tifo, skincareapp et redemarrer leurs process PM2 (`--update-env`)
- [ ] Prix a reverifier : modeles Gemini image (`summary`, pas verbatim) ; ajouter les modeles quand un nouveau modele apparait (banniere `unpriced`)
- [ ] Collecteurs de reconciliation avec les API de facturation (Anthropic/OpenAI admin, Upstash, Google)
- [ ] Blocs suivants : sante VPS + alertes, MRR Stripe, requetes par endpoint
