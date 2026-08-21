<script setup lang="ts">
import { computed } from 'vue'
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import { formaterNombreFR } from '@/payload/selectors'
const props = defineProps<{ dispatch: Extract<FamilyDispatch, { family: 'pyramid' }> }>()
const territory = computed(() => props.dispatch.selected?.territoire ?? props.dispatch.representation.territories[0]?.territoire)
const parts = computed(() => props.dispatch.representation.parts.filter((fact) => fact.territoire === territory.value))
const details = computed(() => [...new Set(parts.value.map((part) => part.detail).filter((detail): detail is string => detail !== null))])
const labels = computed(() => props.dispatch.facet.labels)
function value(part: { value: number | null; unit: string }) { return part.value === null ? '—' : `${formaterNombreFR(part.value * (part.unit === '%' ? 100 : 1), 2)}${part.unit}` }
</script>
<template>
  <figure class="family-renderer pyramid-renderer" data-renderer="pyramid" :data-state="dispatch.status" aria-label="Repères en pyramide des âges">
    <div class="pyramid" role="img" :aria-label="details.map((detail) => `${labels[detail] ?? detail} : ${parts.filter((part) => part.detail === detail).map((part) => `${part.sex ?? ''} ${value(part)}`).join(', ')}`).join(' · ')">
      <div v-for="detail in details" :key="detail" class="pyramid-row"><span>{{ labels[detail] ?? detail }}</span><i v-for="sex in ['F', 'M']" :key="sex" :class="{ selected: detail === dispatch.facet.detail && sex === dispatch.facet.sex }">{{ value(parts.find((part) => part.detail === detail && part.sex === sex) ?? { value: null, unit: dispatch.facet.unit }) }}</i></div>
    </div>
    <figcaption>{{ dispatch.facet.label }} · {{ dispatch.facet.sex === 'F' ? 'Femmes' : 'Hommes' }}</figcaption>
  </figure>
</template>
<style scoped>
.pyramid-renderer{padding:24px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px}.pyramid{display:grid;gap:6px}.pyramid-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;align-items:center}.pyramid-row span{text-align:center}.pyramid-row i{padding:5px;background:var(--indicateur-accent);color:var(--surface-primary);font-style:normal;text-align:center}.pyramid-row i.selected{outline:3px solid var(--text-primary);outline-offset:1px}figcaption{margin-top:16px;font-weight:700}
</style>
