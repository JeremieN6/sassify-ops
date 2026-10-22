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

### 2026-10-22 502 au premier deploiement : nom, dossier et port PM2 devines en dur + `.env` absent
**Probleme** : `https://pilotage.sassify.fr` renvoyait 502. Le process PM2 `pilotage` etait en `errored` (8 redemarrages, aucun PID), avec `/usr/bin/node: .env: not found` en boucle dans ses logs.
**Cause racine** : (1) le `ecosystem.config.cjs` versionne avait `name: 'ops'`, `cwd: '/srv/saas/ops'` et `PORT: 3020`, valeurs inventees par moi alors que le site est `pilotage.sassify.fr`, installe dans `/srv/saas/pilotage`, avec un nginx qui proxifie vers `127.0.0.1:3011` ; (2) `node --env-file=.env` quitte immediatement si le fichier n'existe pas, et le `.env` (non versionne) n'avait pas ete cree sur le VPS ; (3) j'avais lance un premier diagnostic avec `pm2 logs ops` (mauvais nom) qui n'affichait rien.
**Solution** : `name: 'pilotage'`, `cwd: '/srv/saas/pilotage'`, `PORT: 3011` dans le repo (commentaire qui rappelle l'alignement avec nginx), creation du `.env` a la main (`cp .env.example .env`, `chmod 600`), puis `pm2 delete` + `pm2 start ecosystem.config.cjs` (PM2 garde en memoire l'ancien cwd/args, un simple reload ne suffit pas).
**Second symptome apres correction (meme jour)** : le serveur demarrait (`Listening on 127.0.0.1:3011`) et l'API repondait, mais toutes les pages (meme `/favicon.ico`) renvoyaient 500, avec `ERR_MODULE_NOT_FOUND: .output/server/chunks/routes/renderer.mjs` dans les logs. `index.mjs` existait mais le build etait incomplet (les chunks charges a la demande manquaient). Remede : `pm2 stop pilotage && rm -rf .output && npm run build && ls .output/server/chunks/routes/renderer.mjs && pm2 restart pilotage --update-env`. Ne jamais reconstruire `.output` pendant que le process tourne ; l'API qui repond ne prouve pas que les pages marchent.
**Regle** : avant d'ecrire un fichier de deploiement versionne, demander ou lire le sous-domaine, le dossier cible et le port reels (nginx `proxy_pass`, `ss -ltn`) au lieu de les deviner. Un fichier qui depend d'un `.env` non versionne doit le dire en commentaire et la doc de deploiement doit lister sa creation comme etape obligatoire. Pour diagnostiquer un 502 : `pm2 status` pour le vrai nom du process, puis `pm2 logs <nom>`, puis `nginx -T | grep -A14 "server_name <domaine>"` pour le port.
