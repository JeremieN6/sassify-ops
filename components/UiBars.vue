<script setup lang="ts">
// Graphique en barres sans dépendance : axe gradué, grille en pointillés, info-bulle native au survol.
const props = withDefaults(
  defineProps<{
    items: { value: number; tip: string; highlight?: boolean }[]
    height?: number
    format?: (value: number) => string
    xLabels?: string[]
    color?: string
  }>(),
  { height: 180, format: (value: number) => String(Math.round(value)), color: 'bg-accent' }
)

// Axe à 3 intervalles réguliers : plafond = 3 x un pas "rond" (ex : pic de 6,05 -> pas 2,5 -> graduations 7,5 / 5 / 2,5 / 0).
const max = computed(() => {
  const peak = Math.max(0.0001, ...props.items.map((item) => item.value))
  const magnitude = 10 ** Math.floor(Math.log10(peak / 3))
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
  const step = steps.find((candidate) => candidate * magnitude * 3 >= peak) ?? 10
  return step * magnitude * 3
})

const ticks = computed(() => [1, 2 / 3, 1 / 3, 0].map((ratio) => ({ top: `${(1 - ratio) * 100}%`, label: ratio === 0 ? '0' : props.format(max.value * ratio) })))
</script>

<template>
  <div>
    <div class="flex gap-3">
      <div class="relative w-10 flex-none font-mono text-label text-ink-muted" :style="{ height: `${height}px` }" aria-hidden="true">
        <span v-for="tick in ticks" :key="tick.top" class="absolute right-0 -translate-y-1/2" :style="{ top: tick.top }">{{ tick.label }}</span>
      </div>
      <div class="relative min-w-0 flex-1" :style="{ height: `${height}px` }">
        <div class="absolute inset-x-0 top-0 border-t border-dashed border-line" />
        <div class="absolute inset-x-0 top-1/3 border-t border-dashed border-line" />
        <div class="absolute inset-x-0 top-2/3 border-t border-dashed border-line" />
        <div class="absolute inset-x-0 bottom-0 border-t border-line-strong" />
        <div class="absolute inset-0 flex items-end gap-[5px]">
          <div v-for="(item, index) in items" :key="index" class="bar-col flex h-full min-w-0 flex-1 items-end" :title="item.tip">
            <div
              class="bar w-full rounded-t-[3px]"
              :class="item.highlight ? 'bg-accent-soft' : color"
              :style="{ height: `${Math.max(item.value > 0 ? 1.5 : 0, (item.value / max) * 100)}%` }"
            />
          </div>
        </div>
      </div>
    </div>
    <div v-if="xLabels?.length" class="mt-2 flex justify-between pl-[52px] font-mono text-label text-ink-muted">
      <span v-for="label in xLabels" :key="label">{{ label }}</span>
    </div>
  </div>
</template>
