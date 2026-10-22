<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="m-0 text-title text-ink">{{ title }}</h1>
      <p v-if="subtitle" class="mb-0 mt-1.5 text-ink-muted">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.default" class="flex flex-wrap items-center gap-3">
      <slot />
    </div>
  </header>
</template>
