// Echoue vite au demarrage si un secret manque. L'ecosystem PM2 limite les redemarrages
// (voir ecosystem.config.cjs) pour eviter une boucle de crash qui sature les logs.
export default defineNitroPlugin(() => {
  if (process.env.NODE_ENV !== 'production') {
    return
  }

  const config = useRuntimeConfig()
  const missing = [
    ['NUXT_ADMIN_PASSWORD', config.adminPassword],
    ['NUXT_SESSION_SECRET', config.sessionSecret],
    ['NUXT_INGEST_KEY', config.ingestKey],
    ['DATABASE_URL', process.env.DATABASE_URL]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new Error(`[ops] Variables d'environnement manquantes : ${missing.join(', ')}`)
  }
})
