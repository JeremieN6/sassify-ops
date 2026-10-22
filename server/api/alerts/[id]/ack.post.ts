export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id manquant' })
  }
  // Seule une alerte ouverte peut etre acquittee ; une alerte deja resolue ne change pas.
  const result = await prisma.alert.updateMany({
    where: { id, status: 'OPEN' },
    data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() }
  })
  return { ok: true, updated: result.count }
})
