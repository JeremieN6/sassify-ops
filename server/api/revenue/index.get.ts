import { buildRevenue } from '../../utils/revenue'

// Ecran "Revenus" : MRR par projet a partir des instantanes quotidiens (table MrrSnapshot, alimentee par la synchro Stripe),
// et etat des abonnements (table Subscription : plans, paiements en retard, annulations prevues ; sans donnee personnelle).
// Tout le calcul est dans server/utils/revenue.ts (pur et teste). Tant que MrrSnapshot est vide : `configured: false`.
export default defineEventHandler(async () => {
  const since = new Date(Date.now() - 400 * 86_400_000)
  const [rows, projects, subscriptions] = await Promise.all([
    prisma.mrrSnapshot.findMany({ where: { capturedOn: { gte: since } }, orderBy: { capturedOn: 'asc' }, take: 8000 }),
    prisma.project.findMany({ select: { id: true, slug: true, name: true } }),
    // La page doit rester utilisable meme si la table des abonnements n'existe pas encore (avant la migration) ou est illisible.
    prisma.subscription
      .findMany({ select: { projectId: true, status: true, plan: true, mrrEur: true, quantity: true, cancelAtPeriodEnd: true, currentPeriodEnd: true, createdAt: true, customerLabel: true }, take: 5000 })
      .catch(() => [])
  ])

  return buildRevenue(
    rows.map((row) => ({
      projectId: row.projectId,
      capturedOn: row.capturedOn,
      mrrEur: Number(row.mrrEur),
      subscribers: row.subscribers,
      newEur: Number(row.newEur),
      expansionEur: Number(row.expansionEur),
      contractionEur: Number(row.contractionEur),
      churnEur: Number(row.churnEur)
    })),
    projects,
    subscriptions.map((sub) => ({ ...sub, mrrEur: Number(sub.mrrEur) }))
  )
})
