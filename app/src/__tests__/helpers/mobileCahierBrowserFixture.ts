import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import publishedMobilite from '../../../../public/data/theme_mobilite.json'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import AccessRampFigureCahier from '@/fiche/prototype/AccessRampFigureCahier.vue'
import AedarEquipmentQuantileFigureCahier from '@/fiche/prototype/AedarEquipmentQuantileFigureCahier.vue'
import CahierMobiliteRaccordementCurve from '@/fiche/prototype/CahierMobiliteRaccordementCurve.vue'
import CahierMobiliteComparisonBars from '@/fiche/prototype/CahierMobiliteComparisonBars.vue'
import type { CahierPagination } from '@/fiche/prototype/cahierPagination'
import type { ContentFact, MobiliteBarsFigureEvidence, MobiliteRaccordementEvidence, ThemeContent } from '@/fiche/content/themeContent'
import type { TimeRampFigureData } from '@/fiche/content/territoryFacts'
import type { ThemeMetadata } from '@/payload/types'
import { routes } from '@/router'

/** Return the rendered tick boxes that intersect a y-axis title lane. */
export function auditYAxisTitleTickOverlap(title: Element, labels: readonly Element[]) {
  const { x, y, right, bottom } = title.getBoundingClientRect()
  const titleRect = { x, y, right, bottom }
  const labelRects = labels.map((label) => {
    const rect = label.getBoundingClientRect()
    return { text: label.textContent?.trim() ?? '', x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }
  })
  const overlaps = labelRects.filter((label) =>
    label.x < titleRect.right && label.right > titleRect.x &&
    label.y < titleRect.bottom && label.bottom > titleRect.y,
  )
  return { titleRect, labelRects, overlaps }
}

export async function mountPlainCahier(
  container: Element,
  content: ThemeContent,
  pagination: CahierPagination,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  })
  const app = createApp(VarianteCahierLibre, {
    content,
    pagination,
    presentation: 'plain',
    showAllUnits: true,
  })
  app.use(router)
  await router.push('/')
  await router.isReady()
  app.mount(container)
  await nextTick()
  return app
}

/** Mounts the failing access-ramp family with the Rennes long tick labels. */
export async function mountAccessRampLongYAxisFigure(container: Element) {
  const timeRamp: TimeRampFigureData = {
    availability: 'complete',
    xAxis: { label: 'Temps de trajet', unit: 'min' },
    yAxis: { label: 'Volume de l’offre', unit: '' },
    series: [{
      key: 'car',
      label: 'Voiture',
      points: [
        { xValue: 0, xLabel: '0 min', value: 0, referenceValue: null },
        { xValue: 10, xLabel: '10 min', value: 6440, referenceValue: null },
        { xValue: 20, xLabel: '20 min', value: 12881, referenceValue: null },
      ],
    }],
    provenance: null,
    comparisonLabel: null,
  }
  const app = createApp(AccessRampFigureCahier, {
    timeRamp,
    territoryName: 'Rennes',
    showModeLegend: false,
  })
  app.mount(container)
  await nextTick()
  return app
}

/** Mounts the sandbox quantile renderer with the Rennes grouped-bar axis labels. */
export async function mountSandboxGroupedBarFigure(container: Element) {
  const app = createApp(AedarEquipmentQuantileFigureCahier, {
    fact: {
      territory_id: '35238',
      territory_type: 'commune',
      typequ: 'SYNTHETIC',
      typequ_label: 'Équipements synthétiques',
      identity: {},
      n_addresses: 1,
      n_observed: 1,
      coverage_status: 'covered',
      measures: {
        count_20_car_min: 0,
        count_20_car_decile2: 6440,
        count_20_car_decile5: 9000,
        count_20_car_decile8: 11000,
        count_20_car_max: 12881,
      },
      source_id: 'synthetic',
      vintage_id: 'fixture',
      source_url: 'https://example.test/fixture',
      licence: 'Fixture',
      attribution: 'Synthetic browser fixture; not published facts',
      reference_date: null,
      publication_date: null,
    },
    horizonMinutes: 20,
    selectedModes: ['car'],
    evidence: {
      kind: 'aedar-equipment-explorer',
      contentVersion: 'fixture',
      referenceContentVersion: 'fixture',
      facts: [],
      initialTypequ: 'SYNTHETIC',
      initialHorizonMinutes: 20,
      introduction: [],
      volumeFigureTitle: 'Volume synthétique',
      volumeYAxisTitle: 'Établissements',
      distributionFigureTitle: 'Distribution synthétique',
      distributionStatistics: [
        { key: 'min', label: 'Minimum', axisLabel: 'Min.' },
        { key: 'decile2', label: '2e décile', axisLabel: 'D2' },
        { key: 'decile5', label: '5e décile', axisLabel: 'D5' },
        { key: 'decile8', label: '8e décile', axisLabel: 'D8' },
        { key: 'max', label: 'Maximum', axisLabel: 'Max.' },
      ],
      distributionAxisTitle: 'Quantile',
      distributionYAxisTitle: 'NOMBRE D’ÉTABLISSEMENTS',
      distributionValueUnit: 'établissement',
      distributionDescription: 'Distribution synthétique par quantile.',
      distributionUnavailableDescription: 'Distribution indisponible.',
      source: null,
    },
  })
  app.mount(container)
  await nextTick()
  return app
}

/** Mounts the Mobilité raccordement curve, whose y ticks are HTML labels. */
export async function mountCahierMobiliteRaccordementCurve(container: Element) {
  const published = publishedMobilite as ThemeMetadata
  const page = published.indicator_pages?.raccordement_courbe
  if (page?.family !== 'trajectory') throw new Error('Published raccordement curve metadata missing')
  const details = (page.comparison?.details ?? page.trajectory.ticks?.map((tick) => tick.detail) ?? []) as string[]
  const numeric = (detail: string) => Number(detail.replace(/^t/u, ''))
  const contentFact = (detail: string, value: number): ContentFact => ({
    label: detail,
    fact: {
      key: 'raccordement_courbe',
      detail,
      axisValue: numeric(detail),
      value,
      unit: '%',
      availability: 'complete',
      provenance: null,
      comparison: null,
      comparisonBasis: 'territory-mean',
      reason: null,
    },
  })
  const points = details.map((detail) => contentFact(detail, Math.min(1, 0.22 + numeric(detail) / 1200)))
  const evidence: MobiliteRaccordementEvidence = {
    kind: 'mobilite-raccordement',
    figureTitle: page.label ?? 'Courbe de population bretonne jointe selon le temps de trajet',
    xAxisTitle: 'Temps de trajet',
    territoryName: 'Rennes',
    level: 'commune',
    points,
    comparison: {
      statistic: 'mean',
      scope: { kind: 'selection', label: 'communes de la classe de densité' },
      selectedMemberCount: 2,
      eligibleCount: 2,
      modelZeroReasonCounts: {},
      points: points.map((point) => ({ ...point,
        fact: { ...point.fact, value: Math.min(1, (point.fact.value ?? 0) * 0.82) } })),
    },
    trajectory: page.trajectory,
    axis: {
      values: points.map((point) => ({ detail: point.fact.detail!, numericValue: point.fact.axisValue! })),
      minimum: 0,
      maximum: Math.max(...points.map((point) => point.fact.axisValue ?? 0)),
    },
    markerValue: contentFact(page.trajectory.marker!.detail, 0.38),
    comparisonLabel: 'Moyenne des communes de la classe de densité',
    prose: [],
    sources: [],
  }
  const app = createApp(CahierMobiliteRaccordementCurve, {
    figure: evidence,
    comparison: { status: 'ready' },
  })
  app.mount(container)
  await nextTick()
  return app
}

/** #997 — the page-2 compared protected/shared mean stack, for the browser proof. */
export function mobiliteNetworkMeanFigure(
  variant: 'coherent' | 'mismatch' = 'coherent',
): MobiliteBarsFigureEvidence {
  const members = ['22001', '22002']
  const scope = { kind: 'communes-epci' as const, label: 'communes de EPCI X' }
  const fact = (
    key: string,
    detail: string,
    value: number,
    unit: string,
    reference: number | null = null,
    eligibleMembers: readonly string[] = members,
  ): ContentFact => ({
    label: detail,
    fact: {
      key, detail, value, unit, availability: 'complete', provenance: null,
      comparison: reference === null ? null : {
        direction: 'plus-est-mieux', scope, rank: { position: 1, size: 2 },
        reference: { kind: 'mean', value: reference, eligibleMembers },
      },
      comparisonBasis: reference === null ? 'territory-median' : 'territory-mean',
      reason: null,
    },
  })
  const segment = (
    key: string, label: string, legendLabel: string, value: number, raw: number,
    reference: number, rawReference: number, eligibleMembers: readonly string[] = members,
  ) => ({
    key, label, legendLabel,
    value: fact('offre_cyclable', key, value, 'km / 1 000 hab.', reference, eligibleMembers),
    rawValue: fact('offre_cyclable', key.replace('_km_1000', '_longueur'), raw, 'km', rawReference,
      eligibleMembers),
  })
  return {
    figureTitle: 'Longueur du réseau par habitant',
    unit: 'km / 1 000 hab.',
    xAxisTitle: 'Réseau',
    yAxisTitle: 'km / 1 000 hab.',
    comparisonLabel: 'Moyenne des communes de EPCI X',
    categories: [
      { key: 'walkTransit', label: 'Réseau piéton', axisLabel: 'à pied', tone: 't',
        value: fact('reseaux_par_habitant', 't_km_1000', 12, 'km / 1 000 hab.', 10),
        rawValue: fact('reseaux', 't_longueur', 10, 'km', 14), segments: [], splitNote: null },
      { key: 'bike', label: 'Réseau cyclable', axisLabel: 'à vélo', tone: 'b',
        value: fact('reseaux_par_habitant', 'b_km_1000', 8, 'km / 1 000 hab.', 6),
        rawValue: fact('reseaux', 'b_longueur', 20, 'km', 12),
        segments: [
          segment('protege_km_1000', 'Protégé', 'Réseau cyclable protégé', 5, 4, 4, 8),
          segment('partage_km_1000', 'Partagé', 'Réseau cyclable partagé', 3, 2, 2, 4,
            variant === 'mismatch' ? ['22001', '22003'] : members),
        ],
        splitNote: null,
        ...(variant === 'coherent' ? { comparisonSplit: true } : {
          comparisonSplitNote: 'Répartition comparée Protégé/Partagé indisponible : les moyennes servies ne portent pas les mêmes communes.',
        }) },
      { key: 'car', label: 'Réseau automobile', axisLabel: 'en voiture', tone: 'c',
        value: fact('reseaux_par_habitant', 'c_km_1000', 80, 'km / 1 000 hab.', 70),
        rawValue: fact('reseaux', 'c_longueur', 30, 'km', 30), segments: [], splitNote: null },
    ],
  }
}

export async function mountMobiliteNetworkMeans(
  container: Element,
  variant: 'coherent' | 'mismatch' = 'coherent',
) {
  const app = createApp(CahierMobiliteComparisonBars, {
    figure: mobiliteNetworkMeanFigure(variant),
    comparison: { status: 'ready' },
  })
  app.mount(container)
  await nextTick()
  return app
}
