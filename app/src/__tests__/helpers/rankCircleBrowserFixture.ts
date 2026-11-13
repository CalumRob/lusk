import { createApp, h, nextTick, reactive } from 'vue'

import CahierComparisonValue from '@/fiche/prototype/CahierComparisonValue.vue'
import CahierFigureScalar from '@/fiche/prototype/CahierFigureScalar.vue'
import CahierFigureTooltip from '@/fiche/prototype/CahierFigureTooltip.vue'
import type { CahierTooltipRow } from '@/fiche/cahierFigureGrammaire'
import type { NumericFact } from '@/fiche/content/territoryFacts'
import type { DirectionRang } from '@/methodes/indicateurs'

/**
 * #1004 — real-browser seam for the shared extreme-rank outline. It mounts the
 * production comparison mark and the production tooltip, never a mock of their
 * grammar, so the verifier measures the real CSS and the real rank formatter.
 */
export type RankCircleServedRank = {
  position: number
  size: number
  ties?: number | null
  direction: DirectionRang
  key: string
}

export type RankCircleComparisonState = {
  fact: NumericFact | null
  servedRank: RankCircleServedRank | null
  namedReference: { label: string; value: number; unit: string } | null
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
}

/**
 * Mounts the production scalar + comparison composition (the Mobilité ratio
 * row shape) followed by ordinary copy, so a layout jump is measurable on the
 * surrounding text as well as on the comparison slot itself.
 */
export async function mountRankCircleComparison(
  container: Element,
  initial: RankCircleComparisonState,
) {
  const state = reactive<RankCircleComparisonState>({ ...initial })
  const app = createApp({
    // The production outline lives inside `.cahier`, where `--red` is the
    // editorial margin ink; mirror that scope so the proof measures the real
    // stroke rather than a fixture-only fallback.
    render: () => h('div', { class: 'rank-circle-fixture',
      style: { '--red': 'var(--editorial-margin)' } }, [
      h('figure', { class: 'rank-circle-fixture__figure' }, [
        h(CahierFigureScalar, {
          value: '0,3',
          label: 'Bornes par station-service',
          labelRole: 'metric',
          colorValue: true,
          ariaLabel: 'Bornes par station-service : 0,3',
        }, {
          reference: () => h(CahierComparisonValue, {
            fact: state.fact ?? undefined,
            servedRank: state.servedRank ?? undefined,
            namedReference: state.namedReference,
            comparisonStatus: state.status,
          }),
        }),
        h('p', { class: 'rank-circle-fixture__note' }, 'Note de lecture après la ligne de rapport.'),
      ]),
      h('p', { class: 'rank-circle-fixture__after' }, 'Paragraphe suivant la figure.'),
    ]),
  })
  app.mount(container)
  await nextTick()
  return {
    app,
    state,
    async update(patch: Partial<RankCircleComparisonState>) {
      Object.assign(state, patch)
      await nextTick()
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    },
  }
}

/** Tooltip rows whose compared reading carries the producer-served ordinal. */
export function rankCircleTooltipRows(
  position: number,
  size: number,
  ties?: number | null,
): readonly CahierTooltipRow[] {
  const shared = typeof ties === 'number' && ties > 1
  const rank = `${shared ? '=' : ''}${position === 1 ? '1er' : `${position}e`}/${size}`
  return [{
    label: 'Réseau cyclable',
    value: '8',
    tone: 'b',
    marker: 'dot',
    comparison: {
      value: '6',
      rank,
      rankEvidence: { position, size, ...(ties === undefined ? {} : { ties }) },
      ariaLabel: `Groupe comparé : 6, rang ${rank}`,
    },
  }]
}

/** Mounts the production tooltip so its real CSS edges can be measured. */
export async function mountRankCircleTooltip(
  container: Element,
  rows: readonly CahierTooltipRow[],
) {
  const app = createApp({
    render: () => h('div', { style: { '--red': 'var(--editorial-margin)' } },
      [h(CahierFigureTooltip, { title: '15 min', rows })]),
  })
  app.mount(container)
  await nextTick()
  return app
}
