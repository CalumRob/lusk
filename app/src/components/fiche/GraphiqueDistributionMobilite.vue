<script setup lang="ts">
/**
 * GraphiqueDistributionMobilite — the Mobilité story chart (issue #142,
 * ADR-0012, "Vingt minutes sans voiture"): the territory's building-level
 * distribution of div_loss_t (the pipeline's precomputed density signature —
 * the 10 (decile, density) points drawn as a density curve, median marked with
 * a dashed line at div_loss_t) against a same-scale comparison cloud of the
 * peers' div_loss_t (ADR-0011 — a commune vs its EPCI's communes, an EPCI vs
 * the other EPCIs, a département vs the other départements, the région vs all
 * its communes). The x-axis is shared — same scale, same unit (types de
 * services perdus). Every cloud point is hoverable (its name + div_loss) and
 * CLICKABLE — it opens that point's own fiche.
 *
 * The chart is canvas — colors resolve from the token layer at runtime
 * (getComputedStyle), never hardcoded. The data is ALSO rendered as text
 * (role=img aria-label) so the figure never depends on canvas alone
 * (WCAG 2.2 AA, color never the sole carrier).
 *
 * ECharts is code-split (issue #51): the tree-shaken registration lives in
 * ./echarts.ts, imported dynamically on mount — the shell never loads it.
 */
import type * as echarts from 'echarts/core'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import type { DistributionMobilite } from '@/fiche/sousGroupes'
import { formaterNombreFR } from '@/payload/selectors'
import type { PointNuageMobilite } from '@/payload/selectors'

const props = defineProps<{
  distribution: DistributionMobilite
  mediane: number
  medianeVelo: number
  modes: { t: string; b: string }
  nom: string
  nuage: PointNuageMobilite[]
}>()

const router = useRouter()
const conteneur = ref<HTMLDivElement | null>(null)
let instance: ReturnType<typeof echarts.init> | null = null

/**
 * Resolve a CSS custom property to a color ECharts can actually draw.
 * getComputedStyle returns the RAW token string — for a `color-mix(...)`
 * token that string is not a drawable color. The probe applies the token to
 * a real element and reads back the browser's computed color, which the
 * canvas renderer understands.
 */
function token(nom: string, fallback: string): string {
  try {
    const brut = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(nom)
      .trim()
    if (!brut) return fallback
    if (!brut.startsWith('color-mix')) return brut
    const sonde = document.createElement('span')
    sonde.style.color = `var(${nom})`
    document.body.appendChild(sonde)
    const resolu = window.getComputedStyle(sonde).color
    sonde.remove()
    return resolu || fallback
  } catch {
    return fallback
  }
}

/** The density curve's points — one (décile, densité) pair per bin. */
const points = computed(() =>
  props.distribution.dec
    .map((dec, i): [number, number] | null =>
      dec !== null && props.distribution.dens[i] !== null
        ? [dec, props.distribution.dens[i] as number]
        : null,
    )
    .filter((p): p is [number, number] => p !== null),
)

/** The shared x-domain — the distribution's deciles AND the cloud's values (same scale). */
const domaineX = computed(() => {
  const valeurs = props.distribution.dec.filter((d): d is number => d !== null)
  for (const p of props.nuage) valeurs.push(p.divLoss)
  if (props.distribution.min !== null) valeurs.push(props.distribution.min)
  if (props.distribution.max !== null) valeurs.push(props.distribution.max)
  if (valeurs.length === 0) return { min: 0, max: 1 }
  return { min: Math.min(...valeurs), max: Math.max(...valeurs) }
})

const densiteMax = computed(() => {
  const dens = props.distribution.dens.filter((d): d is number => d !== null)
  return dens.length > 0 ? Math.max(...dens) : 1
})

const libelleAccesible = computed(() => {
  const distribution = props.distribution.dec
    .map((dec, i) =>
      dec !== null && props.distribution.dens[i] !== null
        ? `${formaterNombreFR(dec, 0)} types : densité ${props.distribution.dens[i]?.toFixed(3).replace('.', ',')}`
        : null,
    )
    .filter((s): s is string => s !== null)
    .join(' · ')
  return (
    `${props.nom} — médiane ${formaterNombreFR(props.mediane, 0)} (${props.modes.t}), ` +
    `médiane ${props.modes.b} ${formaterNombreFR(props.medianeVelo, 0)}. ` +
    `Distribution : ${distribution}. ` +
    `Contexte : ${props.nuage.map((p) => `${p.nom} (${formaterNombreFR(p.divLoss, 0)})`).join(', ') || 'aucun'}.`
  )
})

/** Tooltip body for one plot point — a cloud point. */
function infobulle(nom: string, divLoss: number): string {
  return `${nom}<br/>Types de services perdus : ${formaterNombreFR(divLoss, 0)}`
}

function optionGraphique(): echarts.EChartsCoreOption {
  const couleurDistribution = token('--theme-mobilite-strong', '#3F5D63')
  // The cloud is subordinate but clearly visible — the base teal at half
  // opacity, never the near-white -soft wash.
  const couleurNuage = token('--theme-mobilite', '#6BA3B5')
  const couleurAxes = token('--text-tertiary', '#A0AEC0')
  const couleurTexte = token('--text-secondary', '#718096')
  const grille = token('--border-default', '#E2E8F0')
  const mouvementReduit =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // The cloud dots lift off the axis in a thin deterministic band — the x
  // position carries the value, the y band is purely visual separation.
  const nuagePoints = props.nuage.map((p, i) => ({
    value: [p.divLoss, (i % 4) * densiteMax.value * 0.06] as [number, number],
    nom: p.nom,
    territoire: p.territoire,
    type: p.type,
  }))

  return {
    animation: !mouvementReduit,
    grid: { left: 56, right: 24, top: 32, bottom: 44 },
    tooltip: {
      trigger: 'item',
      position: (
        point_: [number, number],
        _params: unknown,
        _dom: unknown,
        _rect: unknown,
        taille?: { contentSize?: [number, number]; viewSize?: [number, number] },
      ) => {
        const [cx, cy] = point_
        const [lw, lh] = taille?.contentSize ?? [0, 0]
        const [vw, vh] = taille?.viewSize ?? [0, 0]
        const x = Math.min(cx + 12, vw - lw - 4)
        const auDessus = cy - lh - 12
        const y = auDessus < 4 ? Math.min(cy + 14, vh - lh - 4) : auDessus
        return [x, y] as [number, number]
      },
      formatter: (params: unknown) => {
        const p = params as { data?: { value?: [number, number]; nom?: string }; nom?: string }
        const nom = p.data?.nom ?? p.nom ?? props.nom
        const x = p.data?.value?.[0] ?? props.mediane
        return infobulle(nom, x)
      },
    },
    xAxis: {
      type: 'value',
      name: 'Types de services perdus',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { fontSize: 11, color: couleurTexte },
      min: domaineX.value.min,
      max: domaineX.value.max,
      axisLine: { lineStyle: { color: couleurAxes } },
      splitLine: { lineStyle: { color: grille } },
      axisLabel: { fontSize: 10, color: couleurTexte },
    },
    yAxis: {
      type: 'value',
      name: 'Densité des bâtiments',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { fontSize: 11, color: couleurTexte },
      min: 0,
      max: densiteMax.value * 1.3,
      axisLine: { lineStyle: { color: couleurAxes } },
      splitLine: { lineStyle: { color: grille } },
      axisLabel: { fontSize: 10, color: couleurTexte },
    },
    series: [
      {
        name: 'distribution',
        type: 'line',
        data: points.value,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: couleurDistribution, width: 2 },
        areaStyle: { color: couleurDistribution, opacity: 0.16 },
        // Both readings stay on one shared distribution, including the vélo story.
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: couleurDistribution, width: 1.5, type: 'dashed' },
          label: {
            formatter: `${props.modes.t} — ${formaterNombreFR(props.mediane, 0)}`,
            fontSize: 10,
            color: couleurTexte,
          },
          data: [
            { xAxis: props.mediane },
            {
              xAxis: props.medianeVelo,
              lineStyle: { color: couleurNuage, width: 1.5, type: 'dashed' },
              label: {
                formatter: `${props.modes.b} — ${formaterNombreFR(props.medianeVelo, 0)}`,
                color: couleurTexte,
              },
            },
          ],
        },
      },
      {
        name: 'contexte',
        type: 'scatter',
        // Each cloud point carries its name + its fiche (territoire/type) so
        // the tooltip names it and a click opens its own fiche.
        data: nuagePoints,
        symbolSize: 6,
        itemStyle: { color: couleurNuage, opacity: 0.7 },
        emphasis: { itemStyle: { opacity: 1 } },
      },
    ],
  }
}

function redimensionner(): void {
  instance?.resize()
}

/** Click on a cloud point → its own fiche; the distribution stays put. */
function gererClic(params: unknown): void {
  const p = params as { data?: { territoire?: string; type?: string }; nom?: string }
  const territoire = p.data?.territoire
  const type = p.data?.type
  if (!territoire || !type || type === 'region') return
  router.push({ name: 'territoire', params: { type, id: territoire } })
}

onMounted(async () => {
  const el = conteneur.value
  if (!el) return
  try {
    const { echarts } = await import('./echarts')
    instance = echarts.init(el)
    instance.setOption(optionGraphique())
    instance.on('click', gererClic)
  } catch {
    instance = null
  }
  window.addEventListener('resize', redimensionner)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', redimensionner)
  instance?.off('click', gererClic)
  instance?.dispose()
  instance = null
})
</script>

<template>
  <div class="graphique-distribution-mobilite">
    <div
      ref="conteneur"
      class="graphique-distribution-mobilite-canvas"
      role="img"
      :aria-label="libelleAccesible"
    />
  </div>
</template>

<style scoped>
.graphique-distribution-mobilite {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.graphique-distribution-mobilite-canvas {
  width: 100%;
  height: var(--figure-compact-height);
}
</style>
