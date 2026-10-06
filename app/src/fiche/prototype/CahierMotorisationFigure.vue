<script setup lang="ts">
import type { ContentFact } from '../content/themeContent'
import CahierFigureScalar from './CahierFigureScalar.vue'

defineProps<{ composition: readonly ContentFact[]; charging: readonly ContentFact[] }>()
function number(value: number | null): string {
  return value === null ? 'Indisponible' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, style: 'percent' }).format(value)
}
</script>

<template>
  <div class="cahier-figure-frame motorisation-figure">
    <div class="motorisation-composition" role="img" :aria-label="`Composition des ménages selon le nombre de voitures : ${composition.map(part => `${part.label}, ${number(part.fact.value)}`).join('; ')}`">
      <div v-for="part in composition" :key="part.fact.detail ?? part.label" class="motorisation-part" :data-detail="part.fact.detail" :data-value="part.fact.value">
        <span class="motorisation-part-label">{{ part.label }}</span>
        <span class="motorisation-track"><span v-if="part.fact.value !== null" class="motorisation-bar" :style="{ width: `${Math.max(0, Math.min(1, part.fact.value)) * 100}%` }" /></span>
        <strong>{{ number(part.fact.value) }}</strong>
      </div>
    </div>
    <div class="motorisation-charging">
      <div v-for="fact in charging" :key="fact.fact.key" class="motorisation-charging-item">
        <CahierFigureScalar :value="fact.fact.value === null ? 'Indisponible' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(fact.fact.value)" :label="fact.label" :aria-label="`${fact.label} : ${fact.fact.value ?? 'indisponible'} ${fact.fact.unit}`" />
        <p v-if="fact.fact.reason" class="motorisation-rider">{{ fact.fact.reason }}</p>
      </div>
    </div>
  </div>
</template>

<style src="./cahierFigure.css"></style>
<style scoped>
.motorisation-figure { display: grid; gap: var(--space-5); }
.motorisation-composition { display: grid; gap: var(--space-3); }
.motorisation-part { display: grid; grid-template-columns: minmax(9rem, 1fr) minmax(6rem, 2fr) auto; align-items: center; gap: var(--space-3); }
.motorisation-track { height: 1.1rem; background: var(--cahier-paper); border: 1px solid var(--cahier-rule); }
.motorisation-bar { display: block; height: 100%; background: var(--cahier-theme); }
.motorisation-charging { display: flex; flex-wrap: wrap; gap: var(--space-4); }
@media (max-width: 40rem) { .motorisation-part { grid-template-columns: 1fr auto; } .motorisation-track { grid-row: 2; grid-column: 1 / -1; } }
</style>
