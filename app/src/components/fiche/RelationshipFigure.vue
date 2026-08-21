<script setup lang="ts">
import type { RelationshipPageMetadata } from '@/payload/types'
import type { ModeleRelation } from '@/indicateurs/explorationModel'
defineProps<{ page: RelationshipPageMetadata; model: ModeleRelation }>()
</script>
<template>
  <article class="relation-cloud">
    <h2>Repères des relations</h2>
    <svg viewBox="0 0 640 320" role="img" :aria-label="`${page.axis.label} selon ${page.measure.label}`">
      <line x1="50" y1="270" x2="620" y2="270" /><line x1="50" y1="20" x2="50" y2="270" />
      <text x="300" y="310">{{ page.axis.label }} ({{ page.axis.unit }})</text>
      <text x="12" y="145" transform="rotate(-90 12 145)">{{ page.measure.label }} ({{ page.measure.unit }})</text>
      <g v-for="point in model.points" :key="point.territoire.territoire">
        <circle v-if="point.axis !== null && point.measure !== null" :cx="60 + point.axis * 50" :cy="260 - point.measure * 35" :r="point.highlighted ? 9 : 6" :class="{ 'relation-highlight': point.highlighted }">
          <title>{{ point.territoire.nom }} : {{ point.axis }} {{ page.axis.unit }}, {{ point.measure }} {{ page.measure.unit }}</title>
        </circle>
        <text v-else x="60" y="38">{{ point.territoire.nom }} : données relationnelles incomplètes</text>
      </g>
    </svg>
    <p>La facette « {{ model.scalarIndicator }} » sert au classement et à la carte ; elle ne transforme pas la relation en score.</p>
    <p v-if="model.high.length">Valeur haute : <RouterLink v-for="point in model.high" :key="`high-${point.territoire.territoire}`" :to="point.fiche">{{ point.territoire.nom }}</RouterLink></p>
    <p v-if="model.low.length">Valeur basse : <RouterLink v-for="point in model.low" :key="`low-${point.territoire.territoire}`" :to="point.fiche">{{ point.territoire.nom }}</RouterLink></p>
    <table><caption>Territoires du périmètre actif</caption><thead><tr><th>Territoire</th><th>Facette</th><th>Rang</th></tr></thead><tbody>
      <tr v-for="point in model.table" :key="point.territoire.territoire" :class="{ selection: point.highlighted }"><td><RouterLink :to="point.fiche">{{ point.territoire.nom }}</RouterLink></td><td>{{ point.scalar ?? '—' }}</td><td>{{ point.axis === null || point.measure === null ? 'Données relationnelles incomplètes' : point.rank === null ? '—' : `${point.rank} / ${point.rankSize}` }}</td></tr>
    </tbody></table>
  </article>
</template>
<style scoped>
.relation-cloud{padding:24px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px}.relation-cloud svg{width:100%;height:320px}.relation-cloud line{stroke:var(--border-default)}.relation-cloud text{fill:var(--text-secondary);font-size:12px}.relation-cloud circle{fill:var(--indicateur-accent)}.relation-cloud circle.relation-highlight{fill:var(--status-error);stroke:var(--text-primary);stroke-width:2}.relation-cloud table{width:100%;border-collapse:collapse}.relation-cloud th,.relation-cloud td{padding:10px;border-bottom:1px solid var(--border-subtle);text-align:left}.relation-cloud tr.selection{background:var(--indicateur-soft)}
</style>
