import { z } from 'zod'

const bodySchema = z.object({ password: z.string().min(1).max(200) })

export default defineEventHandler(async (event) => {
  const ip = clientIp(event)
  assertLoginAllowed(ip)

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success || !checkAdminPassword(parsed.data.password)) {
    recordLoginFailure(ip)
    throw createError({ statusCode: 401, statusMessage: 'Mot de passe incorrect' })
  }

  clearLoginFailures(ip)
  startSession(event)
  return { ok: true }
})
