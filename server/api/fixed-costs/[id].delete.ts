export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id manquant' })
  }

  await prisma.fixedCost.deleteMany({ where: { id } })
  return { ok: true }
})
