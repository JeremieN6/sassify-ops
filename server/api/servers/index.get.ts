// Ecran "Serveurs" : lit les mesures deposees dans ServerMetric. Aucune source n'est encore branchee
// (un agent leger sur le VPS enverra CPU/memoire/disque/PM2) : tant que la table est vide, l'ecran affiche un etat vide.
import { lastKnownProcesses } from '../../utils/serverIngest'

export default defineEventHandler(async () => {
  const since = new Date(Date.now() - 24 * 3_600_000)
  // Courbes : colonnes numeriques seulement (le JSON des processus est lu a part, sur quelques lignes : il n'est present que
  // dans 1 mesure sur 5 et pese ~700 octets, donc le relire sur 24 h pour chaque affichage gaspillait du transfert Neon).
  const [rows, withProcesses] = await Promise.all([
    prisma.serverMetric.findMany({
      where: { capturedAt: { gte: since } },
      orderBy: { capturedAt: 'asc' },
      take: 2000,
      select: { host: true, capturedAt: true, cpuPct: true, memPct: true, diskPct: true, netOutMbps: true }
    }),
    prisma.serverMetric.findMany({ where: { capturedAt: { gte: since } }, orderBy: { capturedAt: 'desc' }, take: 24, select: { host: true, payload: true } })
  ])

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
        processes: lastKnownProcesses(withProcesses.filter((row) => row.host === host).reverse()),
        series: series.map((row) => ({ at: row.capturedAt.toISOString(), cpu: row.cpuPct, mem: row.memPct, net: row.netOutMbps }))
      }
    })
  }
})
