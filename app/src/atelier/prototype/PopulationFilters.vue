<script setup lang="ts">
/** PROTOTYPE — Population: four dropdowns and a one-line summary of what is active. */
import { computed } from 'vue'

import MultiSelect from './MultiSelect.vue'
import { POPULATION_KEYS, type PopulationKey } from './prototypeFigure'
import { countCommunes, type Territoires } from './prototypeTerritoires'

const props = defineProps<{ population: Record<PopulationKey, string[]>; territoires: Territoires | null }>()

const LABELS: Record<PopulationKey, string> = { departement: 'Département', epci: 'EPCI', classe_densite: 'Classe de densité', littoral: 'Littoral' }

const active = computed(() =>
  POPULATION_KEYS.filter((k) => props.population[k].length).map((k) => {
    const labels = props.population[k].map((v) => props.territoires?.options[k].find((o) => o.value === v)?.label ?? v)
    return `${LABELS[k]} : ${labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2}` : labels.join(', ')}`
  }),
)
const count = computed(() => (props.territoires ? countCommunes(props.territoires, props.population) : null))
</script>

<template>
  <div class="pop">
    <div class="pop__row">
      <MultiSelect
        v-for="key in POPULATION_KEYS"
        :key="key"
        :label="LABELS[key]"
        :options="territoires?.options[key] ?? []"
        :model-value="population[key]"
        :disabled="!territoires"
        @update:model-value="population[key] = $event"
      />
    </div>
    <p v-if="active.length" class="pop__summary">{{ active.join(' · ') }}<template v-if="count !== null"> — {{ count }} communes</template></p>
  </div>
</template>

<style scoped>
.pop { display: grid; gap: var(--space-3); }
.pop__row { display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-6); }
.pop__row > * { flex: 1 1 11rem; max-width: 16rem; }
.pop__summary { margin: 0; color: var(--cahier-default); font: var(--type-figure-legend); }
@media (max-width: 520px) { .pop__row > * { flex: 1 1 100%; max-width: none; } }
</style>
