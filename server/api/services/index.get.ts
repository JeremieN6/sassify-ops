export default defineEventHandler(async () => ({
  monitoring: monitoringStatus(),
  services: await prisma.service.findMany({ orderBy: { name: 'asc' }, select: { slug: true, name: true, url: true, projectSlug: true, enabled: true } })
}))
