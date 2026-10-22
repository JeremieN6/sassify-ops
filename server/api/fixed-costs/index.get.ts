export default defineEventHandler(async () => {
  const items = await prisma.fixedCost.findMany({
    orderBy: [{ startsOn: 'desc' }],
    include: { project: { select: { slug: true } } }
  })

  return items.map((item) => ({
    id: item.id,
    label: item.label,
    provider: item.provider,
    project: item.project?.slug ?? null,
    amount: Number(item.amount),
    currency: item.currency,
    amountEur: Number(item.amountEur),
    period: item.period,
    startsOn: item.startsOn.toISOString().slice(0, 10),
    endsOn: item.endsOn ? item.endsOn.toISOString().slice(0, 10) : null
  }))
})
