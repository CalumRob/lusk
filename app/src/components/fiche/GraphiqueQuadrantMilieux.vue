<script setup lang="ts">
/**
 * GraphiqueQuadrantMilieux — the Milieux story chart (issue #241, ADR-0011 +
 * ADR-0017, "Se densifier, s'étaler, ou s'en aller"): the quadrant of the two
 * signed forces — x = le taux annuel de variation de la population (‰/an,
 * #306 — le registre Démographie, jamais la variation brute), y = Δ(m²/hab) =
 * artif_m3_par_habitant − artif_m2_par_habitant — with the axes crossing at
 * 0 (markLine) and, beneath the point, the context cloud of the territory's
 * comparison group at the same scale (nuageMilieux). Every cloud point is
 * hoverable (its name + both values) and CLICKABLE — it opens that point's
 * own fiche. A cross-département peer's hover carries the millésime-span
 * rider (its per-dépt OCS-GE dates — the mixing is stated, never hidden).
 * The reading is the pipeline's classification — shown as a label, never
 * drawn; the chart confronts the point with its peers, nothing else.
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

import { formaterNombreFR, formaterTaux } from '@/payload/selectors'
import type { PointNuageMilieux } from '@/payload/selectors'

const props = defineProps<{
  /** x — le taux annuel de variation de la population (‰/an, #306), la première force de la lecture. */
  tauxVariationPopulation: number
  /** y — Δ(m²/hab) = artif_m3_par_habitant − artif_m2_par_habitant (signé). */
  deltaM2ParHabitant: number
  classification: string
  nom: string
  /** La fenêtre de population de la Story (« 2017-2023 ») — le libellé de l'axe, jamais codé en dur. */
  periodePop: string
  /** La fenêtre des états OCS-GE du territoire — le span multi-dépt porté tel quel. */
  periodeArtif: string
  nuage: PointNuageMilieux[]
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

/** Signed French number — "+200", "-45", "0" (comma decimal, zeros trimmed). */
function formaterDelta(x: number): string {
  const signe = x > 0 ? '+' : ''
  return `${signe}${formaterNombreFR(x, 1)}`
}

/**
 * The OCS-GE state window of a cross-département territory carries per-dépt
 * dates — "2021-2025 (22) · 2021-2024 (29)" — versus the plain pair of a
 * single-département territory ("2021-2025"). The parens detect the span.
 */
function estFenetreMultiDepartement(periode: string): boolean {
  return periode.includes('(')
}

const libelleAccesible = computed(
  () =>
    `${props.nom} — variation de population ${formaterTaux(props.tauxVariationPopulation)} ‰/an, ` +
    `m²/hab ${formaterDelta(props.deltaM2ParHabitant)} m² (${props.classification}) · ` +
    `OCS-GE ${props.periodeArtif}`,
)

/** Tooltip body for one plot point — the main dot or a cloud point. */
function infobulle(
  nom: string,
  tauxVariationPopulation: number,
  deltaM2ParHabitant: number,
  periodeArtif: string | null,
): string {
  const rider =
    periodeArtif && estFenetreMultiDepartement(periodeArtif)
      ? `<br/>OCS-GE : ${periodeArtif}`
      : ''
  return (
    `${nom}<br/>Variation de population : ${formaterTaux(tauxVariationPopulation)} ‰/an<br/>` +
    `m²/hab : ${formaterDelta(deltaM2ParHabitant)} m²${rider}`
  )
}

function optionGraphique(): echarts.EChartsCoreOption {
  const couleurPoint = token('--theme-milieux-strong', '#7D7140')
  // The cloud is subordinate but clearly visible — the base olive at half
  // opacity, never the near-white -soft wash.
  const couleurNuage = token('--theme-milieux', '#A99A5E')
  const couleurAxes = token('--text-tertiary', '#A0AEC0')
  const couleurTexte = token('--text-secondary', '#718096')
  const couleurNom = token('--text-primary', '#2D3748')
  const grille = token('--border-default', '#E2E8F0')
  const mouvementReduit =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const point = [props.tauxVariationPopulation, props.deltaM2ParHabitant] as [number, number]

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
        const p = params as {
          data?: { value?: [number, number]; nom?: string; periodeArtif?: string }
          nom?: string
        }
        const nom = p.data?.nom ?? p.nom ?? props.nom
        const [x, y] = p.data?.value ?? point
        return infobulle(nom, x, y, p.data?.periodeArtif ?? props.periodeArtif)
      },
    },
    xAxis: {
      type: 'value',
      name: `Variation de population ${props.periodePop} (‰/an)`,
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
      name: 'Δ m²/hab',
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
        // Each cloud point carries its name + its fiche (territoire/type) +
        // its OCS-GE window so the tooltip names it, states the millésime
        // mixing and a click opens its own fiche.
        data: props.nuage.map((p) => ({
          value: [p.tauxVariationPopulation, p.deltaM2ParHabitant] as [number, number],
          nom: p.nom,
          territoire: p.territoire,
          type: p.type,
          periodeArtif: p.periodeArtif,
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
  <div class="graphique-quadrant-milieux">
    <div
      ref="conteneur"
      class="graphique-quadrant-milieux-canvas"
      role="img"
      :aria-label="libelleAccesible"
    />
  </div>
</template>

<style scoped>
.graphique-quadrant-milieux {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.graphique-quadrant-milieux-canvas {
  width: 100%;
  height: var(--figure-compact-height);
}
</style>
