// Ecran "Serveurs" : lit les mesures deposees dans ServerMetric. Aucune source n'est encore branchee
// (un agent leger sur le VPS enverra CPU/memoire/disque/PM2) : tant que la table est vide, l'ecran affiche un etat vide.
import { lastKnownProcesses } from '../../utils/serverIngest'
import { getMetricStore } from '../../utils/metricStore'

export default defineEventHandler(async () => {
  const since = new Date(Date.now() - 24 * 3_600_000)
  // Mesures lues dans le magasin LOCAL (fichier sur le VPS, voir server/utils/metricStore.ts) : aucun acces a Neon.
  const rows = await getMetricStore().since(since.getTime())

  const byHost = new Map<string, typeof rows>()
  for (const row of rows) {
    const list = byHost.get(row.host) ?? []
    list.push(row)
    byHost.set(row.host, list)
  }

  return {
    configured: rows.length > 0,
    hosts: [...byHost.entries()].map(([host, series]) => {
      const last = series[series.length - 1]
      return {
        host,
        capturedAt: last.capturedAt.toISOString(),
        cpuPct: last.cpuPct,
        memPct: last.memPct,
        diskPct: last.diskPct,
        netOutMbps: last.netOutMbps,
        // L'agent ne lit PM2 qu'une minute sur 5 : on prend la liste de la derniere mesure qui en contient une.
        processes: lastKnownProcesses(series),
        series: series.map((row) => ({ at: row.capturedAt.toISOString(), cpu: row.cpuPct, mem: row.memPct, net: row.netOutMbps }))
      }
    })
  }
})
