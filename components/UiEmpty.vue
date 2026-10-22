<script setup lang="ts">
// État vide : dit clairement pourquoi il n'y a rien et ce qu'il faut faire pour que ça se remplisse.
withDefaults(defineProps<{ icon?: string; title: string }>(), { icon: 'plug' })
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-6 py-10 text-center">
    <span class="grid h-12 w-12 place-items-center rounded-full bg-accent/14 text-accent"><UiIcon :name="icon" :size="22" /></span>
    <h2 class="m-0 text-section text-ink">{{ title }}</h2>
    <div class="max-w-[52ch] text-ink-muted"><slot /></div>
    <div v-if="$slots.actions" class="mt-1 flex flex-wrap justify-center gap-3"><slot name="actions" /></div>
  </div>
</template>
