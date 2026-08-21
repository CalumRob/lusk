<script setup lang="ts">
import { computed } from 'vue'
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import { couleurDpe } from '@/fiche/couleursDpe'
import { formaterNombreFR } from '@/payload/selectors'

const props = defineProps<{ dispatch: Extract<FamilyDispatch, { family: 'composition' }> }>()
const territory = computed(() => props.dispatch.selected?.territoire ?? props.dispatch.representation.territories[0]?.territoire)
const parts = computed(() => {
  const allowed = new Set(props.dispatch.representation.extension.parts)
  return props.dispatch.representation.parts.filter((fact) => fact.territoire === territory.value && fact.detail !== null && allowed.has(fact.detail))
})
const total = computed(() => parts.value.reduce((sum, part) => sum + (part.value ?? 0), 0))
const palette = computed(() => props.dispatch.facet.labels)
function colour(detail: string | null) { return detail && couleurDpe(detail) ? couleurDpe(detail) : undefined }
function value(value: number | null, unit: string) { return value === null ? '—' : `${formaterNombreFR(value * (unit === '%' ? 100 : 1), 2)}${unit}` }
function label(detail: string | null) { return detail === null ? 'Valeur totale' : palette.value[detail] ?? detail }
function barStyle(part: (typeof parts.value)[number]): Record<string, string> {
  const style: Record<string, string> = { width: `${total.value > 0 && part.value !== null ? part.value / total.value * 100 : 0}%` }
  const background = colour(part.detail)
  if (background) style.background = background
  return style
}
</script>
<template>
  <figure class="family-renderer composition-renderer" data-renderer="composition" :data-state="dispatch.status" aria-label="Repères de composition">
    <div v-if="parts.length" class="composition-bar" role="img" :aria-label="parts.map((part) => `${label(part.detail)} ${value(part.value, part.unit)}`).join(' · ')">
      <span v-for="part in parts" :key="`${part.territoire}-${part.detail}-${part.sex ?? ''}-${part.dimension ?? ''}`" :class="{ active: part.detail === dispatch.facet.detail && (part.sex ?? null) === dispatch.facet.sex && (part.dimension ?? null) === dispatch.facet.dimension }" :style="barStyle(part)" :title="`${label(part.detail)} : ${value(part.value, part.unit)}`" />
    </div>
    <p v-else role="status">Composition indisponible pour ce territoire.</p>
    <ul class="composition-legend">
      <li v-for="part in parts" :key="`legend-${part.territoire}-${part.detail}-${part.sex ?? ''}-${part.dimension ?? ''}`" :class="{ active: part.detail === dispatch.facet.detail && (part.sex ?? null) === dispatch.facet.sex && (part.dimension ?? null) === dispatch.facet.dimension }"><span>{{ label(part.detail) }}</span><strong>{{ value(part.value, part.unit) }}</strong></li>
    </ul>
    <figcaption>{{ dispatch.facet.label }}<span v-if="dispatch.facet.detail"> · détail {{ label(dispatch.facet.detail) }}</span></figcaption>
  </figure>
</template>
<style scoped>
.composition-renderer{padding:24px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px}.composition-bar{display:flex;height:20px;overflow:hidden;border-radius:999px;background:var(--surface-tertiary)}.composition-bar span{min-width:1px;opacity:.55;border-right:1px solid var(--surface-primary);background:var(--indicateur-accent)}.composition-bar span.active{opacity:1;outline:3px solid var(--text-primary);outline-offset:-3px}.composition-legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px 16px;list-style:none;margin:16px 0 0;padding:0}.composition-legend li{display:flex;justify-content:space-between;padding:6px 8px;border-left:3px solid transparent}.composition-legend li.active{border-left-color:var(--indicateur-accent);background:var(--indicateur-soft)}figcaption{margin-top:16px;font-weight:700}
</style>
