import { z } from 'zod'

// monthlyBudgetEur = null : supprime le plafond (plus d'alerte budget).
const bodySchema = z.object({ monthlyBudgetEur: z.number().positive().max(1_000_000).nullable() })

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Montant invalide' })
  }

  const { monthlyBudgetEur } = parsed.data
  if (monthlyBudgetEur === null) {
    await prisma.setting.deleteMany({ where: { key: 'monthly_budget_eur' } })
  } else {
    await prisma.setting.upsert({
      where: { key: 'monthly_budget_eur' },
      create: { key: 'monthly_budget_eur', value: String(monthlyBudgetEur) },
      update: { value: String(monthlyBudgetEur) }
    })
  }

  await checkBudget(true).catch(() => undefined)
  return { ok: true, monthlyBudgetEur }
})
