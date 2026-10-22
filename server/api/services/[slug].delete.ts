export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'slug manquant' })
  }
  await prisma.service.deleteMany({ where: { slug } })
  await reloadServices()
  return { ok: true }
})
