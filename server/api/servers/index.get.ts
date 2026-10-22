// Ecran "Serveurs" : lit les mesures deposees dans ServerMetric. Aucune source n'est encore branchee
// (un agent leger sur le VPS enverra CPU/memoire/disque/PM2) : tant que la table est vide, l'ecran affiche un etat vide.
export default defineEventHandler(async () => {
  const since = new Date(Date.now() - 24 * 3_600_000)
  const rows = await prisma.serverMetric.findMany({ where: { capturedAt: { gte: since } }, orderBy: { capturedAt: 'asc' }, take: 2000 })

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
        processes: (last.payload as { processes?: unknown[] } | null)?.processes ?? [],
        series: series.map((row) => ({ at: row.capturedAt.toISOString(), cpu: row.cpuPct, mem: row.memPct, net: row.netOutMbps }))
      }
    })
  }
})
