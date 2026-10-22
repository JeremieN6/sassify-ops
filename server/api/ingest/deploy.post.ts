import { z } from 'zod'

// Appele a la fin d'un workflow GitHub Actions (voir CLAUDE.md pour l'etape a ajouter).
const bodySchema = z.object({
  project: z.string().regex(/^[a-z0-9-]{2,40}$/, 'slug invalide (a-z, 0-9, tirets)'),
  runId: z.string().min(1).max(60), // identifiant du run : permet RUNNING -> SUCCESS/FAILED sans doublon
  environment: z.enum(['production', 'preview']).default('production'),
  status: z.enum(['RUNNING', 'SUCCESS', 'FAILED']),
  commit: z.string().min(7).max(64),
  message: z.string().max(300).optional(),
  branch: z.string().max(120).optional(),
  durationSec: z.number().int().min(0).max(86_400).optional(),
  startedAt: z.string().datetime().optional(),
  runUrl: z.string().url().max(300).optional()
})

export default defineEventHandler(async (event) => {
  const { ingestKey } = useRuntimeConfig()
  const provided = getRequestHeader(event, 'x-ops-key') || ''
  if (!ingestKey || !safeEqual(provided, ingestKey)) {
    throw createError({ statusCode: 401, statusMessage: 'Cle invalide' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Payload invalide' })
  }
  const body = parsed.data

  const project = await prisma.project.upsert({
    where: { slug: body.project },
    update: {},
    create: { slug: body.project, name: body.project }
  })

  const startedAt = body.startedAt ? new Date(body.startedAt) : new Date()
  const finished = body.status !== 'RUNNING'
  const externalId = `${body.project}:${body.runId}`

  await prisma.deployment.upsert({
    where: { externalId },
    create: {
      externalId,
      projectId: project.id,
      environment: body.environment,
      status: body.status,
      commitSha: body.commit,
      message: body.message ?? null,
      branch: body.branch ?? null,
      durationSec: body.durationSec ?? null,
      startedAt,
      finishedAt: finished ? new Date() : null,
      runUrl: body.runUrl ?? null
    },
    update: {
      status: body.status,
      durationSec: body.durationSec ?? undefined,
      finishedAt: finished ? new Date() : null,
      // Le premier appel (RUNNING) fixe la date de debut ; les suivants ne la modifient pas.
      message: body.message ?? undefined,
      runUrl: body.runUrl ?? undefined
    }
  })

  await handleDeployResult(body.project, body.environment, body.status, body.commit, body.branch ?? null)
  return { ok: true }
})
