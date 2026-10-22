// Demarre les sondes de disponibilite. Actif en production par defaut ; NUXT_PROBES_ENABLED=true|false pour forcer.
// Ne doit jamais empecher le serveur de demarrer.
export default defineNitroPlugin((nitro) => {
  if (!isMonitoringEnabled()) {
    console.info('[monitoring] desactive (dev ou NUXT_PROBES_ENABLED=false)')
    return
  }

  void startMonitoring().catch((error) => {
    console.warn(`[monitoring] demarrage impossible : ${error?.message ?? error}`)
  })

  nitro.hooks.hook('close', async () => {
    stopMonitoring()
    try {
      await flushRollups(true) // ecrit aussi l'heure en cours pour ne rien perdre au redemarrage
    } catch {
      // arret : rien de plus a faire
    }
  })
})
