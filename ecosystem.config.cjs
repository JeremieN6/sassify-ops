// Le .env est charge par `node --env-file=.env` (voir script "start") : aucun secret ici.
// Le fichier .env doit exister dans le cwd ci-dessous (non versionne, a creer a la main sur le VPS).
// Limites de redemarrage : evite une boucle de crash qui sature les logs et le disque
// (cf. incident prospector-worker du 25/09/2026).
// Doit rester coherent avec nginx : proxy_pass http://127.0.0.1:3011 (site pilotage.sassify.fr).
module.exports = {
  apps: [
    {
      name: 'pilotage',
      script: '.output/server/index.mjs',
      node_args: '--env-file=.env',
      cwd: '/srv/saas/pilotage',
      env: {
        NODE_ENV: 'production',
        PORT: 3011,
        HOST: '127.0.0.1'
      },
      max_restarts: 5,
      min_uptime: '30s',
      exp_backoff_restart_delay: 2000
    }
  ]
}
