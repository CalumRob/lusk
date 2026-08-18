<script setup lang="ts">
import { formaterNombreFR } from '@/payload/selectors'
import type { LigneLQ } from '@/fiche/sousGroupes'

defineProps<{ lignes: LigneLQ[]; labels?: { rang?: string; activite?: string; lq?: string } }>()
</script>

<template>
  <figure class="figure-liste-lq carte-figure" :aria-label="`Top 5 — ${labels?.activite ?? 'Activité'} / ${labels?.lq ?? 'LQ'}`">
    <figcaption>Top 5 — {{ labels?.activite ?? 'Activité' }}</figcaption>
    <div class="entetes" aria-hidden="true"><span>{{ labels?.rang ?? 'Rang' }}</span><span>{{ labels?.activite ?? 'Activité' }}</span><span>{{ labels?.lq ?? 'LQ' }}</span></div>
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
.figure-liste-lq { margin: 0; max-height: 200px; overflow: hidden; }
figcaption { margin-bottom: var(--space-2); font-weight: 600; color: var(--text-primary); }
ol { display: grid; gap: 3px; margin: 0; padding: 0; list-style: none; }
.entetes { display: grid; grid-template-columns: 1.5rem 1fr auto; gap: var(--space-2); margin-bottom: 2px; font: var(--text-caption); color: var(--text-tertiary); }
li { display: grid; grid-template-columns: 1.5rem 1fr auto; gap: var(--space-2); align-items: baseline; font: var(--text-body-sm); }
.rang { color: var(--text-tertiary); }
.activite { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lq { font-variant-numeric: tabular-nums; font-weight: 600; }
</style>
