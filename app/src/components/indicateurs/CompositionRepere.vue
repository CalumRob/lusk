<script setup lang="ts">
import { computed } from 'vue'
import { couleurDpe } from '@/fiche/couleursDpe'
import { formaterNombreFR } from '@/payload/selectors'
import type { PartComposition } from '@/indicateurs/explorationModel'

const props = defineProps<{ label: string; parts: PartComposition[]; palette: 'theme' | 'dpe'; detail: string | null; sex: 'F' | 'M' | null }>()
const emit = defineEmits<{ facet: [detail: string, sex: 'F' | 'M' | null] }>()
const partsAvecValeur = computed(() => props.parts.filter((part) => part.value !== null))
const details = computed(() => [...new Set(props.parts.map((part) => part.detail).filter((detail): detail is string => detail !== null))])
const sexes = computed(() => [...new Set(props.parts.map((part) => part.sex).filter((sex): sex is 'F' | 'M' => sex !== null))])
const total = computed(() => partsAvecValeur.value.reduce((sum, part) => sum + (part.value ?? 0), 0))
const aria = computed(() => `${props.label} : ${props.parts.map((part) => `${part.label || part.detail || ''} ${part.value === null ? '—' : formaterNombreFR(part.value * (part.unit === '%' ? 100 : 1), 2)} ${part.unit}`).join(' · ')}`)
function couleur(part: PartComposition): string | undefined {
  return props.palette === 'dpe' && part.detail ? couleurDpe(part.detail) ?? undefined : undefined
}
</script>

<template>
  <figure class="composition-repere" :data-palette="palette">
    <div v-if="details.length > 1 || sexes.length > 1" class="composition-repere-controls">
      <label v-if="details.length > 1">Détail <select :value="detail ?? ''" @change="emit('facet', ($event.target as HTMLSelectElement).value, sex)"><option v-for="option in details" :key="option" :value="option">{{ option }}</option></select></label>
      <label v-if="sexes.length > 1">Dimension <select :value="sex ?? ''" @change="emit('facet', detail ?? details[0], (($event.target as HTMLSelectElement).value || null) as 'F' | 'M' | null)"><option v-for="option in sexes" :key="option" :value="option">{{ option === 'F' ? 'Femmes' : 'Hommes' }}</option></select></label>
    </div>
    <div class="composition-repere-barre" role="img" :aria-label="aria">
      <span v-for="part in partsAvecValeur" :key="`${part.detail}-${part.sex ?? ''}`" class="composition-repere-part" :class="{ 'composition-repere-part--active': part.selected }" :style="{ width: `${total > 0 ? ((part.value ?? 0) / total) * 100 : 0}%`, background: couleur(part) }" :title="`${part.label || part.detail || ''} : ${part.value === null ? '—' : part.value} ${part.unit}`" />
    </div>
    <ul class="composition-repere-legende">
      <li v-for="part in parts" :key="`${part.detail}-${part.sex ?? ''}`" :class="{ 'composition-repere-ligne--active': part.selected }">
        <span class="composition-repere-libelle">{{ part.label }}</span>
        <strong>{{ part.value === null ? '—' : formaterNombreFR(part.value * (part.unit === '%' ? 100 : 1), 2) }}{{ part.unit }}</strong>
      </li>
    </ul>
    <figcaption>{{ label }}<span v-if="detail"> · détail {{ detail }}<span v-if="sex"> · {{ sex === 'F' ? 'femmes' : 'hommes' }}</span></span></figcaption>
  </figure>
</template>

<style scoped>
.composition-repere { margin: 0; padding: 24px; background: var(--surface-primary); border: 1px solid var(--border-default); border-radius: 12px; }
.composition-repere-controls { display: flex; gap: 16px; margin-bottom: 16px; }
.composition-repere-controls label { display: flex; flex-direction: column; gap: 4px; color: var(--text-secondary); }
.composition-repere-controls select { padding: 6px; }
.composition-repere-barre { display: flex; height: 18px; overflow: hidden; border-radius: 999px; background: var(--surface-tertiary); }
.composition-repere-part { min-width: 1px; background: var(--indicateur-accent); border-right: 1px solid var(--surface-primary); opacity: .55; }
.composition-repere-part--active { opacity: 1; outline: 3px solid var(--text-primary); outline-offset: -3px; }
.composition-repere-legende { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px 16px; list-style: none; margin: 16px 0 0; padding: 0; }
.composition-repere-legende li { display: flex; justify-content: space-between; gap: 8px; padding: 6px 8px; border-left: 3px solid transparent; }
.composition-repere-ligne--active { border-left-color: var(--indicateur-accent) !important; background: var(--indicateur-soft); }
.composition-repere-libelle { color: var(--text-secondary); }
figcaption { margin-top: 16px; font-weight: 700; }
</style>
