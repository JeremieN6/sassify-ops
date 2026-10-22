import { z } from 'zod'

const bodySchema = z.object({ enabled: z.boolean() })

export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key')
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!key || !parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Requete invalide' })
  }

  const result = await prisma.alertRule.updateMany({ where: { key }, data: { enabled: parsed.data.enabled } })
  if (result.count === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Regle inconnue' })
  }

  invalidateRules()
  // Une regle desactivee ferme ses alertes au prochain tour ; le budget est reevalue tout de suite.
  if (key === 'budget_threshold') {
    void checkBudget(true).catch(() => undefined)
  }
  return { ok: true }
})
