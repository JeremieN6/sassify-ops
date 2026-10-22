import { z } from 'zod'

const querySchema = z.object({
  range: z.enum(['7d', '30d', '90d', 'month', 'lastmonth']).default('30d')
})

export default defineEventHandler((event) => getCostSummary(querySchema.parse(getQuery(event)).range))
