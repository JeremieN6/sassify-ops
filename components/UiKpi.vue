<script setup lang="ts">
defineProps<{ label: string; value: string }>()
</script>

<template>
  <div class="panel flex flex-col gap-2 p-5">
    <span class="text-small text-ink-muted">{{ label }}</span>
    <span class="font-mono text-kpi text-ink">{{ value }}</span>
    <slot />
  </div>
</template>
