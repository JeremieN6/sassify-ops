// Le .env est charge par `node --env-file=.env` (voir script "start") : aucun secret ici.
// Limites de redemarrage : evite une boucle de crash qui sature les logs et le disque
// (cf. incident prospector-worker du 25/09/2026).
module.exports = {
  apps: [
    {
      name: 'ops',
      script: '.output/server/index.mjs',
      node_args: '--env-file=.env',
      cwd: '/srv/saas/ops',
      env: {
        NODE_ENV: 'production',
        PORT: 3020,
        HOST: '127.0.0.1'
      },
      max_restarts: 5,
      min_uptime: '30s',
      exp_backoff_restart_delay: 2000
    }
  ]
}
