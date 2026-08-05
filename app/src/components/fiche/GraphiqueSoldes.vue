<script setup lang="ts">
/**
 * GraphiqueSoldes — the Démographie story chart (docs/themes/demographie.md,
 * ADR-0011, "Trajectoire démographique"): the quadrant of the territory's two
 * annualized per-mille rates — taux solde naturel (y) × taux solde migratoire
 * (x) — with the axes crossing at 0 (markLine) and, beneath the point, the
 * context cloud of the territory's comparison group at the same scale
 * (nuageComparaison). Every cloud point is hoverable (its commune's name +
 * rates) and CLICKABLE — it opens that point's own fiche. The reading is the
 * pipeline's classification — shown as a label, never drawn; the chart
 * confronts the point with its peers, nothing else.
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

import type { PointNuage } from '@/payload/selectors'

const props = defineProps<{
  tauxNaturel: number
  tauxMigratoire: number
  classification: string
  nom: string
  nuage: PointNuage[]
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

function formaterTaux(x: number): string {
  const signe = x > 0 ? '+' : ''
  return `${signe}${x.toFixed(2).replace('.', ',')}`
}

const libelleAccesible = computed(
  () =>
    `${props.nom} — solde naturel ${formaterTaux(props.tauxNaturel)} ‰/an, ` +
    `solde migratoire ${formaterTaux(props.tauxMigratoire)} ‰/an (${props.classification})`,
)

/** Tooltip body for one plot point — the main dot or a cloud point. */
function infobulle(nom: string, tauxNaturel: number, tauxMigratoire: number): string {
  return (
    `${nom}<br/>Solde naturel : ${formaterTaux(tauxNaturel)} ‰/an<br/>` +
    `Solde migratoire : ${formaterTaux(tauxMigratoire)} ‰/an`
  )
}

function optionGraphique(): echarts.EChartsCoreOption {
  const couleurPoint = token('--theme-demographie-strong', '#8E85C4')
  // The cloud is subordinate but clearly visible — the base indigo at half
  // opacity, never the near-white -soft wash.
  const couleurNuage = token('--theme-demographie', '#8E85C4')
  const couleurAxes = token('--text-tertiary', '#A0AEC0')
  const couleurTexte = token('--text-secondary', '#718096')
  const couleurNom = token('--text-primary', '#2D3748')
  const grille = token('--border-default', '#E2E8F0')
  const mouvementReduit =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const point = [props.tauxMigratoire, props.tauxNaturel] as [number, number]

  return {
    animation: !mouvementReduit,
    grid: { left: 56, right: 24, top: 32, bottom: 44 },
    tooltip: {
      trigger: 'item',
      // Keep the reading visible: the tooltip floats beside the point (never
      // over it). Coordinates are canvas-relative — `point` from the chart,
      // `viewSize` the chart's own size — no page-relative math.
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
        const [x, y] = p.data?.value ?? point
        return infobulle(nom, y, x)
      },
    },
    xAxis: {
      type: 'value',
      name: 'Solde migratoire (‰/an)',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { fontSize: 11, color: couleurTexte },
      axisLine: { lineStyle: { color: couleurAxes } },
      splitLine: { lineStyle: { color: grille } },
      axisLabel: { fontSize: 10, color: couleurTexte },
      // the quadrant frame: the axes cross at 0 (ADR-0011) — nothing relative
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: couleurAxes, width: 1 },
        data: [{ xAxis: 0 }],
      },
    },
    yAxis: {
      type: 'value',
      name: 'Solde naturel (‰/an)',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { fontSize: 11, color: couleurTexte },
      axisLine: { lineStyle: { color: couleurAxes } },
      splitLine: { lineStyle: { color: grille } },
      axisLabel: { fontSize: 10, color: couleurTexte },
      // the horizontal half of the frame
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: couleurAxes, width: 1 },
        data: [{ yAxis: 0 }],
      },
    },
    series: [
      {
        name: 'contexte',
        type: 'scatter',
        // Each cloud point carries its name + its fiche (territoire/type) so
        // the tooltip names it and a click opens its own fiche.
        data: props.nuage.map((p) => ({
          value: [p.tauxMigratoire, p.tauxNaturel] as [number, number],
          nom: p.nom,
          territoire: p.territoire,
          type: p.type,
        })),
        symbolSize: 6,
        itemStyle: { color: couleurNuage, opacity: 0.55 },
        emphasis: { itemStyle: { opacity: 0.9 } },
      },
      {
        name: props.nom,
        type: 'scatter',
        data: [{ value: point, nom: props.nom }],
        symbolSize: 14,
        itemStyle: { color: couleurPoint },
        // the highlighted dot never fades on hover: explicit emphasis keeps
        // it opaque and slightly larger
        emphasis: {
          itemStyle: { color: couleurPoint },
          scale: 1.25,
        },
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

/** Click on a cloud point → its own fiche; the current point stays put. */
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
  <div class="graphique-soldes">
    <div
      ref="conteneur"
      class="graphique-soldes-canvas"
      role="img"
      :aria-label="libelleAccesible"
    />
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
</style>
