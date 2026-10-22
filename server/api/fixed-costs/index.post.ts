import { z } from 'zod'

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const bodySchema = z.object({
  label: z.string().min(1).max(120),
  provider: z.string().min(1).max(60),
  projectSlug: z.string().regex(/^[a-z0-9-]{2,40}$/).nullable().optional(),
  amount: z.number().min(0).max(1_000_000),
  currency: z.enum(['EUR', 'USD']).default('EUR'),
  period: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
  startsOn: dateString,
  endsOn: dateString.nullable().optional()
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Payload invalide' })
  }

  const data = parsed.data
  const project = data.projectSlug
    ? await prisma.project.upsert({
        where: { slug: data.projectSlug },
        update: {},
        create: { slug: data.projectSlug, name: data.projectSlug }
      })
    : null

  const created = await prisma.fixedCost.create({
    data: {
      label: data.label,
      provider: data.provider.toLowerCase(),
      projectId: project?.id ?? null,
      amount: data.amount,
      currency: data.currency,
      amountEur: toEur(data.amount, data.currency),
      period: data.period,
      startsOn: new Date(`${data.startsOn}T00:00:00.000Z`),
      endsOn: data.endsOn ? new Date(`${data.endsOn}T00:00:00.000Z`) : null
    }
  })

  return { id: created.id }
})
