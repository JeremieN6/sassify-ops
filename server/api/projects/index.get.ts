export default defineEventHandler(() =>
  prisma.project.findMany({ orderBy: { slug: 'asc' }, select: { id: true, slug: true, name: true } })
)
