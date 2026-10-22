<script setup lang="ts">
// Mini-courbe (96 x 28). Pas assez de points : un trait discret plutôt qu'une courbe trompeuse.
const props = withDefaults(defineProps<{ values: number[]; color?: string; label?: string }>(), { color: '#8B93FF' })

const W = 96
const H = 28
const path = computed(() => {
  const values = props.values
  if (values.length < 2) return ''
  const max = Math.max(...values, 1)
  const min = Math.min(...values)
  const span = Math.max(max - min, max * 0.25) // évite une ligne plate qui paraît "figée" sur de petites variations
  const step = W / (values.length - 1)
  return values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(H - 3 - ((v - min) / span) * (H - 6)).toFixed(1)}`).join(' ')
})
</script>

<template>
  <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="label || 'Évolution de la latence'" class="overflow-visible">
    <path v-if="path" :d="path" fill="none" :stroke="color" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
    <line v-else x1="0" :x2="W" :y1="H / 2" :y2="H / 2" stroke="#2A3550" stroke-width="1.5" stroke-dasharray="3 4" />
  </svg>
</template>
