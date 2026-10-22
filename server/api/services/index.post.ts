import { z } from 'zod'

const bodySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/, 'slug invalide (a-z, 0-9, tirets)'),
  name: z.string().min(1).max(60),
  url: z.string().url().max(300).refine((value) => /^https?:\/\//.test(value), 'URL http(s) requise'),
  projectSlug: z.string().regex(/^[a-z0-9-]{2,40}$/).nullable().optional()
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Payload invalide' })
  }
  const data = parsed.data
  const service = await prisma.service.upsert({
    where: { slug: data.slug },
    create: { slug: data.slug, name: data.name, url: data.url, projectSlug: data.projectSlug ?? null },
    update: { name: data.name, url: data.url, projectSlug: data.projectSlug ?? null, enabled: true }
  })
  await reloadServices()
  return { ok: true, slug: service.slug }
})
