// Ecran "Revenus" : lit les instantanes de MRR. Aucune synchronisation Stripe n'est encore branchee ;
// tant que la table est vide, l'ecran affiche un etat vide qui explique comment la remplir.
export default defineEventHandler(async () => {
  const rows = await prisma.mrrSnapshot.findMany({
    orderBy: { capturedOn: 'desc' },
    take: 400,
    include: { project: { select: { slug: true, name: true } } }
  })

  const month = (date: Date) => date.toISOString().slice(0, 7)
  // Dernier instantane de chaque projet pour chaque mois, puis somme par mois
  const latest = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const key = `${month(row.capturedOn)}|${row.projectId ?? 'all'}`
    if (!latest.has(key)) latest.set(key, row)
  }
  const perMonth = new Map<string, number>()
  for (const [key, row] of latest) {
    const m = key.split('|')[0]
    perMonth.set(m, (perMonth.get(m) ?? 0) + Number(row.mrrEur))
  }

  return {
    configured: rows.length > 0,
    months: [...perMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([m, mrr]) => ({ month: m, mrrEur: mrr }))
  }
})
