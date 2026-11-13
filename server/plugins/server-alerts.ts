// Evalue les alertes serveur (CPU, memoire, disque, PM2, agent silencieux) toutes les 5 minutes, avec le meme interrupteur que
// les sondes (production par defaut ; NUXT_PROBES_ENABLED=false pour couper). Ne doit jamais empecher le serveur de demarrer.
export default defineNitroPlugin((nitro) => {
  if (!isMonitoringEnabled()) {
    return
  }

  const run = () => {
    checkServerAlerts().catch((error) => console.warn(`[server-alerts] evaluation impossible : ${error?.message ?? error}`))
  }

  // 5 minutes suffisent : les regles portent sur des fenetres de 10 a 30 minutes. Chaque passage relit ~45 mesures (~10 Ko).
  const first = setTimeout(run, 90_000)
  const timer = setInterval(run, 300_000)
  nitro.hooks.hook('close', () => {
    clearTimeout(first)
    clearInterval(timer)
  })
})
