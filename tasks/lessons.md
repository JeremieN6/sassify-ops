# Lessons Learned

> Ce fichier est mis a jour apres CHAQUE correction faite par l utilisateur.
> But : ne plus refaire les memes erreurs. Relu au debut de chaque session.

---

## Format

### [DATE] Titre du probleme
**Probleme** : Description de ce qui a mal tourne.
**Cause racine** : Pourquoi c est arrive.
**Solution** : Ce qui a ete fait pour corriger.
**Regle** : La regle a suivre desormais pour eviter ce cas.

---

## Lecons

### 2026-10-22 Surveillance : 3 defauts trouves en testant sur de vraies sondes (alertes bruyantes, init non retentee, debordement mobile)
**Probleme** : (1) Au premier test avec les 11 vrais sites, TOUS passaient "Degrade" et 11 alertes critiques de latence s'ouvraient. (2) Avec la base injoignable au demarrage, la liste des services restait vide ("0 service") et les sondes ne reprenaient pas quand la base revenait. (3) Page "Couts fixes" sur telephone : defilement horizontal de toute la page.
**Cause racine** : (1) Regle ecrite comme "p95 > seuil" : sur 5 mesures le p95 EST le maximum, donc une seule mesure lente (connexion froide, DNS) suffisait. (2) L'initialisation (chargement des services) n'etait tentee qu'une fois, dans un try/catch qui ne reessayait jamais. (3) Les `sr-only` (position absolue) d'un tableau echappent a un conteneur `overflow-x-auto` non positionne et elargissent le document.
**Solution** : (1) "degrade" = mediane des 5 dernieres mesures ; alerte de latence = au moins 3 mesures dont >= 60 % au-dessus du seuil ; tests unitaires des cas limites. (2) `initOnce()` retentee a chaque tour jusqu'au succes. (3) conteneurs `relative overflow-x-auto`.
**Regle** : une regle d'alerte statistique doit declarer la taille d'echantillon minimale et exiger une condition SOUTENUE, pas un extremum ; la tester sur de VRAIES mesures avant de la livrer (un test sur donnees fabriquees ne l'aurait pas montre). Toute initialisation qui depend d'une ressource externe doit etre retentee, pas tentee une seule fois. Tester la panne de la base (process vivant, journaux non inondes) avant de declarer un composant "robuste". Verifier le rendu mobile, pas seulement bureau.

### 2026-10-22 502 au premier deploiement : nom, dossier et port PM2 devines en dur + `.env` absent
**Probleme** : `https://pilotage.sassify.fr` renvoyait 502. Le process PM2 `pilotage` etait en `errored` (8 redemarrages, aucun PID), avec `/usr/bin/node: .env: not found` en boucle dans ses logs.
**Cause racine** : (1) le `ecosystem.config.cjs` versionne avait `name: 'ops'`, `cwd: '/srv/saas/ops'` et `PORT: 3020`, valeurs inventees par moi alors que le site est `pilotage.sassify.fr`, installe dans `/srv/saas/pilotage`, avec un nginx qui proxifie vers `127.0.0.1:3011` ; (2) `node --env-file=.env` quitte immediatement si le fichier n'existe pas, et le `.env` (non versionne) n'avait pas ete cree sur le VPS ; (3) j'avais lance un premier diagnostic avec `pm2 logs ops` (mauvais nom) qui n'affichait rien.
**Solution** : `name: 'pilotage'`, `cwd: '/srv/saas/pilotage'`, `PORT: 3011` dans le repo (commentaire qui rappelle l'alignement avec nginx), creation du `.env` a la main (`cp .env.example .env`, `chmod 600`), puis `pm2 delete` + `pm2 start ecosystem.config.cjs` (PM2 garde en memoire l'ancien cwd/args, un simple reload ne suffit pas).
**Second symptome apres correction (meme jour)** : le serveur demarrait (`Listening on 127.0.0.1:3011`) et l'API repondait, mais toutes les pages (meme `/favicon.ico`) renvoyaient 500, avec `ERR_MODULE_NOT_FOUND: .output/server/chunks/routes/renderer.mjs` dans les logs. `index.mjs` existait mais le build etait incomplet (les chunks charges a la demande manquaient). Remede : `pm2 stop pilotage && rm -rf .output && npm run build && ls .output/server/chunks/routes/renderer.mjs && pm2 restart pilotage --update-env`. Ne jamais reconstruire `.output` pendant que le process tourne ; l'API qui repond ne prouve pas que les pages marchent.
**Regle** : avant d'ecrire un fichier de deploiement versionne, demander ou lire le sous-domaine, le dossier cible et le port reels (nginx `proxy_pass`, `ss -ltn`) au lieu de les deviner. Un fichier qui depend d'un `.env` non versionne doit le dire en commentaire et la doc de deploiement doit lister sa creation comme etape obligatoire. Pour diagnostiquer un 502 : `pm2 status` pour le vrai nom du process, puis `pm2 logs <nom>`, puis `nginx -T | grep -A14 "server_name <domaine>"` pour le port.

### 2026-11-09 Synchro Stripe : cle posee dans le mauvais fichier, puis HTTP 400 faute d'en-tete de version
**Probleme** : apres la pose de la cle Stripe d'organisation, aucune ligne `[stripe]` dans les logs, puis `Stripe HTTP 400` sur les 7 comptes.
**Cause racine** : (1) j'ai donne une commande qui ecrivait `NUXT_STRIPE_READ_KEY` dans `.env.local` parce que `NUXT_INGEST_KEY` y figurait aussi, alors que `pilotage` ne charge que `.env` (`node --env-file=.env`, voir CLAUDE.md) : les variables `NUXT_*` de `.env.local` ne sont jamais lues. (2) Une cle d'ORGANISATION exige un en-tete `Stripe-Version` en plus de `Stripe-Context` ; mon code et mes tests (faux Stripe) ne l'avaient pas, et le message d'erreur etait masque (type seul) donc cache la cause. Aussi : mon controle de format n'acceptait que `rk_live_`, alors que les cles d'organisation commencent par `rk_org_live_`.
**Solution** : ligne deplacee dans `.env` cote serveur (sans l'afficher) ; en-tete `Stripe-Version: 2025-09-30.clover` ; erreurs Stripe remontees avec leur message (cles masquees par regex) ; controle de format elargi.
**Regle** : avant de dire ou poser une variable, lire comment le process charge son environnement (script de demarrage / `node_args`), pas deviner d'apres un autre fichier ; remonter le MESSAGE d'erreur d'une API tierce (nettoye des secrets), jamais seulement le code ; un faux serveur de test ne prouve pas le contrat reel : le premier appel reel (meme en lecture seule, curl sur le serveur) doit preceder la livraison. Piege d'outillage : un antislash suivi de b ecrit via un script Python a ete transforme en caractere de controle (retour arriere) dans une expression reguliere ; apres avoir ecrit un fichier par script, le scanner avec Python (recherche des caracteres de code 0 a 8) avant de livrer.

### 2026-11-13 Neon : les 5 Go de transfert mensuel epuises en 4 jours, base bloquee (erreur 402)
**Probleme** : mail Neon « 80 % de 5 Go » le 12/11 a 14 h ; le 13/11 vers 05 h le projet `ops` est SUSPENDU (HTTP 402 « quota exceeded » sur toutes les connexions, `compute_last_active_at` 03:55 UTC, remise a zero le 1er decembre). pilotage perd sondes, alertes, couts, deploiements, revenus.
**Cause racine** : (1) MON defaut : `prisma.serverMetric.findMany({ distinct: ['host'] })` dans l'evaluation des alertes serveur, toutes les 2 min : sans la fonctionnalite `nativeDistinct`, Prisma relit TOUTE la table puis deduplique en memoire (jusqu'a 7 jours de mesures). (2) `getServicesView` relisait a chaque appel les ~6 000 releves horaires des 30 derniers jours (~0,7 Mo) et la Vue d'ensemble se rafraichissait toutes les 60 s, onglet visible ou non. (3) Structurel : l'agent ecrit chaque minute, donc la base ne passe JAMAIS en veille : ~182 CU-heures/mois a 0,25 CU contre 100 CU-heures gratuites (limite atteinte vers le 17 du mois meme sans le defaut de lecture).
**Solution** : `groupBy` agrege par la base (une ligne par machine) ; evaluation toutes les 5 min ; totaux 30 jours calcules par la base + seulement 3 jours de releves + cache de 10 min ; rafraichissement de la Vue d'ensemble toutes les 5 min et onglet visible seulement ; page Serveurs sans relire le JSON des processus sur 24 h. Reste a traiter : sortir les mesures serveur de Neon (fichier local sur le VPS) pour que la base puisse se mettre en veille.
**Regle** : un transfert / un quota se calcule AVANT de livrer une lecture periodique (lignes x octets x frequence x 30 jours) ; `distinct` de Prisma n'est pas du SQL DISTINCT ; jamais de rafraichissement automatique sans pause onglet cache ; une ecriture chaque minute sur une base serverless gratuite la maintient eveillee en permanence (verifier le plafond de CU-heures). Mon benchmark de cout CPU (4 ms) mesurait la machine, pas le VOLUME de donnees lues : mesurer aussi les octets transferes.
