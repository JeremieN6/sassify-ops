<script setup lang="ts">
// Courbe en aire sur une échelle fixe (0..max). Valeurs absentes ignorées.
const props = withDefaults(defineProps<{ values: (number | null)[]; max?: number; label: string; color?: string }>(), { max: 100, color: '#8B93FF' })

const W = 360
const H = 120
const points = computed(() => {
  const list = props.values.filter((v): v is number => v !== null)
  if (list.length < 2) return null
  const step = W / (list.length - 1)
  const line = list.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(H - (Math.min(v, props.max) / props.max) * H).toFixed(1)}`).join(' ')
  return { line, area: `${line} L${W} ${H} L0 ${H} Z` }
})
const gradient = `area-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="h-[120px] w-full" role="img" :aria-label="label">
    <defs>
      <linearGradient :id="gradient" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" :stop-color="color" stop-opacity="0.28" />
        <stop offset="100%" :stop-color="color" stop-opacity="0" />
      </linearGradient>
    </defs>
    <line x1="0" :x2="W" y1="0" y2="0" stroke="#1D2638" stroke-dasharray="3 4" />
    <line x1="0" :x2="W" :y1="H / 2" :y2="H / 2" stroke="#1D2638" stroke-dasharray="3 4" />
    <line x1="0" :x2="W" :y1="H" :y2="H" stroke="#2A3550" />
    <template v-if="points">
      <path :d="points.area" :fill="`url(#${gradient})`" />
      <path :d="points.line" fill="none" :stroke="color" stroke-width="1.75" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
    </template>
  </svg>
</template>
