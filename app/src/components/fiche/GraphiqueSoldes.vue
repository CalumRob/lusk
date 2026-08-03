<script setup lang="ts">
/**
 * GraphiqueSoldes — the Démographie story chart (docs/themes/demographie.md,
 * "Attractive ou fertile ?"): the territory's solde naturel (y) × solde
 * migratoire (x) — the two forces the 2×2 reading crosses. ECharts scatter,
 * legible-first: the point sits on its two balances, never on a fabricated
 * reading. The reading itself is the pipeline's classification — shown as a
 * label, never drawn.
 *
 * The chart is canvas — colors resolve from the token layer at runtime
 * (getComputedStyle), never hardcoded. The data is ALSO rendered as text
 * (role=img aria-label + a legend line) so the figure never depends on
 * canvas alone (WCAG 2.2 AA, color never the sole carrier).
 */
import { ScatterChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { formaterSolde } from '@/payload/selectors'

echarts.use([ScatterChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  soldeNaturel: number
  soldeMigratoire: number
  classification: string
  nom: string
}>()

const conteneur = ref<HTMLDivElement | null>(null)
let instance: ReturnType<typeof echarts.init> | null = null

function token(nom: string, fallback: string): string {
  try {
    const valeur = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(nom)
      .trim()
    return valeur || fallback
  } catch {
    return fallback
  }
}

const libelleAccesible = computed(
  () =>
    `${props.nom} — solde naturel ${formaterSolde(props.soldeNaturel)}, ` +
    `solde migratoire ${formaterSolde(props.soldeMigratoire)} (${props.classification})`,
)

const legende = computed(
  () =>
    `Solde naturel : ${formaterSolde(props.soldeNaturel)} · ` +
    `Solde migratoire : ${formaterSolde(props.soldeMigratoire)}`,
)

function optionGraphique(): echarts.EChartsCoreOption {
  const couleurPoint = token('--theme-demographie-strong', '#8E85C4')
  const couleurAxes = token('--text-tertiary', '#A0AEC0')
  const couleurTexte = token('--text-secondary', '#718096')
  const couleurNom = token('--text-primary', '#2D3748')
  const grille = token('--border-default', '#E2E8F0')
  const mouvementReduit =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  return {
    animation: !mouvementReduit,
    grid: { left: 56, right: 24, top: 32, bottom: 44 },
    tooltip: {
      trigger: 'item',
      formatter: () =>
        `${props.nom}<br/>Solde naturel : ${formaterSolde(props.soldeNaturel)}<br/>` +
        `Solde migratoire : ${formaterSolde(props.soldeMigratoire)}`,
    },
    xAxis: {
      type: 'value',
      name: 'Solde migratoire',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { fontSize: 11, color: couleurTexte },
      axisLine: { lineStyle: { color: couleurAxes } },
      splitLine: { lineStyle: { color: grille } },
      axisLabel: { fontSize: 10, color: couleurTexte },
    },
    yAxis: {
      type: 'value',
      name: 'Solde naturel',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { fontSize: 11, color: couleurTexte },
      axisLine: { lineStyle: { color: couleurAxes } },
      splitLine: { lineStyle: { color: grille } },
      axisLabel: { fontSize: 10, color: couleurTexte },
    },
    series: [
      {
        type: 'scatter',
        data: [[props.soldeMigratoire, props.soldeNaturel]],
        symbolSize: 14,
        itemStyle: { color: couleurPoint },
        label: {
          show: true,
          position: 'top',
          formatter: props.nom,
          fontSize: 11,
          fontWeight: 600,
          color: couleurNom,
        },
      },
    ],
  }
}

function redimensionner(): void {
  instance?.resize()
}

onMounted(() => {
  if (!conteneur.value) return
  try {
    instance = echarts.init(conteneur.value)
    instance.setOption(optionGraphique())
  } catch {
    instance = null
  }
  window.addEventListener('resize', redimensionner)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', redimensionner)
  instance?.dispose()
  instance = null
})
</script>

<template>
  <div class="graphique-soldes">
    <div
      ref="conteneur"
      class="graphique-soldes-canvas"
      role="img"
      :aria-label="libelleAccesible"
    />
    <p class="graphique-soldes-legende">
      <span class="graphique-soldes-puce" aria-hidden="true" />
      {{ legende }} — lecture : {{ classification }}
    </p>
  </div>
</template>

<style scoped>
.graphique-soldes {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.graphique-soldes-canvas {
  width: 100%;
  height: 280px;
}

.graphique-soldes-legende {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

.graphique-soldes-puce {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  background: var(--couleur-strong, var(--brand-500));
}
</style>
