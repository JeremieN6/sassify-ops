// Pastille du menu : nombre d'alertes ouvertes (non acquittees) et dont critiques.
export default defineEventHandler(async () => {
  const [open, critical] = await Promise.all([
    prisma.alert.count({ where: { status: 'OPEN' } }),
    prisma.alert.count({ where: { status: 'OPEN', severity: 'CRITICAL' } })
  ])
  return { open, critical }
})
