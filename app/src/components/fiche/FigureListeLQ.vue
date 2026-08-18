<script setup lang="ts">
import { formaterNombreFR } from '@/payload/selectors'
import type { LigneLQ } from '@/fiche/sousGroupes'

defineProps<{ lignes: LigneLQ[]; labels: { rang: string; activite: string; lq: string } }>()
</script>

<template>
  <figure class="figure-liste-lq carte-figure" :aria-label="`${labels.activite} / ${labels.lq}`">
    <figcaption>{{ labels.activite }}</figcaption>
    <div class="entetes" aria-hidden="true"><span>{{ labels.rang }}</span><span>{{ labels.activite }}</span><span>{{ labels.lq }}</span></div>
    <ol>
      <li v-for="ligne in lignes" :key="ligne.rang">
        <span class="rang">{{ ligne.rang }}</span>
        <span class="activite">{{ ligne.activite }}</span>
        <span class="lq">{{ ligne.lq === null ? '—' : formaterNombreFR(ligne.lq, 1) }}</span>
      </li>
    </ol>
  </figure>
</template>

<style scoped>
.figure-liste-lq { margin: 0; max-height: var(--figure-compact-max-height); overflow: hidden; }
figcaption { margin-bottom: var(--space-2); font-weight: 600; color: var(--text-primary); }
ol { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.entetes { display: grid; grid-template-columns: var(--figure-rank-width) 1fr auto; gap: var(--space-2); margin-bottom: var(--space-1); font: var(--text-caption); color: var(--text-tertiary); }
li { display: grid; grid-template-columns: var(--figure-rank-width) 1fr auto; gap: var(--space-2); align-items: baseline; font: var(--text-body-sm); }
.rang { color: var(--text-tertiary); }
.activite { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lq { font-variant-numeric: tabular-nums; font-weight: 600; }
</style>
