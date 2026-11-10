import { buildRevenue } from '../../utils/revenue'

// Ecran "Revenus" : MRR par projet a partir des instantanes quotidiens (table MrrSnapshot, alimentee par la synchro Stripe).
// Tout le calcul est dans server/utils/revenue.ts (pur et teste). Tant que la table est vide : `configured: false`.
export default defineEventHandler(async () => {
  const since = new Date(Date.now() - 400 * 86_400_000)
  const [rows, projects] = await Promise.all([
    prisma.mrrSnapshot.findMany({ where: { capturedOn: { gte: since } }, orderBy: { capturedOn: 'asc' }, take: 8000 }),
    prisma.project.findMany({ select: { id: true, slug: true, name: true } })
  ])

  return buildRevenue(
    rows.map((row) => ({ projectId: row.projectId, capturedOn: row.capturedOn, mrrEur: Number(row.mrrEur), subscribers: row.subscribers })),
    projects
  )
})
