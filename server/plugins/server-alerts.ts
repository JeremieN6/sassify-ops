// Evalue les alertes serveur (CPU, memoire, disque, PM2, agent silencieux) toutes les 2 minutes, avec le meme interrupteur que
// les sondes (production par defaut ; NUXT_PROBES_ENABLED=false pour couper). Ne doit jamais empecher le serveur de demarrer.
export default defineNitroPlugin((nitro) => {
  if (!isMonitoringEnabled()) {
    return
  }

  const run = () => {
    checkServerAlerts().catch((error) => console.warn(`[server-alerts] evaluation impossible : ${error?.message ?? error}`))
  }

  const first = setTimeout(run, 60_000)
  const timer = setInterval(run, 120_000)
  nitro.hooks.hook('close', () => {
    clearTimeout(first)
    clearInterval(timer)
  })
})
