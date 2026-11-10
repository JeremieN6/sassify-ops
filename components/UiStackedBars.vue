<script setup lang="ts">
// Barres empilées sans dépendance (une barre par mois, un segment par projet). Axe gradué, grille en pointillés, info-bulle native.
// Même habillage que UiBars ; les segments portent leur couleur (celle du projet).
type Segment = { value: number; color: string }
const props = withDefaults(
  defineProps<{
    columns: { label: string; tip: string; segments: Segment[]; highlight?: boolean }[]
    height?: number
    format?: (value: number) => string
  }>(),
  { height: 220, format: (value: number) => String(Math.round(value)) }
)

const total = (segments: Segment[]) => segments.reduce((sum, segment) => sum + segment.value, 0)

// Plafond "rond" (3 intervalles réguliers), comme UiBars.
const max = computed(() => {
  const peak = Math.max(0.0001, ...props.columns.map((column) => total(column.segments)))
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
      <div class="relative w-12 flex-none font-mono text-label text-ink-muted" :style="{ height: `${height}px` }" aria-hidden="true">
        <span v-for="tick in ticks" :key="tick.top" class="absolute right-0 -translate-y-1/2" :style="{ top: tick.top }">{{ tick.label }}</span>
      </div>
      <div class="relative min-w-0 flex-1" :style="{ height: `${height}px` }">
        <div class="absolute inset-x-0 top-0 border-t border-dashed border-line" />
        <div class="absolute inset-x-0 top-1/3 border-t border-dashed border-line" />
        <div class="absolute inset-x-0 top-2/3 border-t border-dashed border-line" />
        <div class="absolute inset-x-0 bottom-0 border-t border-line-strong" />
        <div class="absolute inset-0 flex items-end gap-3">
          <div v-for="(column, index) in columns" :key="index" class="flex h-full min-w-0 flex-1 items-end" :title="column.tip">
            <div
              v-if="total(column.segments) > 0"
              class="flex w-full flex-col-reverse gap-[2px]"
              :style="{ height: `${Math.max(1.5, (total(column.segments) / max) * 100)}%` }"
            >
              <div
                v-for="(segment, i) in column.segments.filter((s) => s.value > 0)"
                :key="i"
                class="min-h-[2px] first:rounded-b-[3px] last:rounded-t-[3px]"
                :style="{ flex: `${segment.value} 1 0`, background: segment.color }"
              />
            </div>
            <div v-else class="w-full border-t-2 border-dashed border-line-strong" />
          </div>
        </div>
      </div>
    </div>
    <div class="mt-2 flex gap-3 pl-[60px]">
      <span v-for="(column, index) in columns" :key="index" class="min-w-0 flex-1 text-center font-mono text-label" :class="column.highlight ? 'text-ink' : 'text-ink-muted'">{{ column.label }}</span>
    </div>
  </div>
</template>
