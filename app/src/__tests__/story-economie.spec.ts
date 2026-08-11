import { describe, expect, it } from 'vitest'

import { storyEconomie } from '../fiche/storyEconomie'
import { histoiresEconomieFixture } from '../payload/fixtures'
import type { HistoireEconomie } from '../payload/types'

/**
 * The Économie Story (issue #121, RÉSOLUE par #312): the LQ is the Story,
 * never a block indicator. ONE resolved reading row per (territoire, groupe) —
 * « ce que la commune abrite » (the top-5 specialisations by LQ, folded into
 * the flat params top1_*..top5_* — communes, EPCIs, départements) and
 * « ce que la Bretagne abrite » (the region's top-5 by presence — its LQ is
 * degenerate, it reads n + part du parc). The copy is generated from the
 * payload rows — never hand-written per territory (reproducibility rule); the
 * vintage rides on the rows themselves (issue #74). Null for a territory
 * without an Économie Story — never an invented reading.
 */

const lignePour = (territoire: string): HistoireEconomie | null =>
  histoiresEconomieFixture.find(
    (h): h is HistoireEconomie => h.theme === 'economie' && h.territoire === territoire,
  ) ?? null

describe('storyEconomie — ce-que-la-commune-abrite (top-5 spécialisations LQ)', () => {
  it('reads the commune’s top-5 from the folded params, labels from the payload', () => {
    const story = storyEconomie(lignePour('22001'), 'Commune A1')

    expect(story).not.toBeNull()
    expect(story?.storyKey).toBe('ce-que-la-commune-abrite')
    expect(story?.titre).toBe('Ce que la commune abrite')
    expect(story?.lignes.map((l) => l.rang)).toEqual([1, 2, 3, 4, 5])
    expect(story?.lignes[0]).toEqual({
      rang: 1,
      label: 'Élevage de volailles',
      mesure: 'LQ 23,7 · 12 établissements',
    })
    expect(story?.lignes[1].label).toBe(
      "Commerce de gros (commerce interentreprises) d'animaux vivants",
    )
  })

  it('drafts a one-liner naming the specialisation of active establishments — never the three activities — and a comment-lire on the LQ', () => {
    const story = storyEconomie(lignePour('22001'), 'Commune A1')

    expect(story?.uneLigne).toBe(
      'Commune A1 se distingue par la spécialisation de ses établissements actifs.',
    )
    expect(story?.uneLigne).not.toContain('Élevage de volailles')
    expect(story?.commentLire).toContain('quotient de localisation')
    expect(story?.commentLire).toContain('moyenne bretonne')
  })

  it('uses the single fixed title « Ce que la commune abrite » for every territory type (issue #153)', () => {
    expect(storyEconomie(lignePour('22001'), 'Commune A1')?.titre).toBe(
      'Ce que la commune abrite',
    )
    expect(storyEconomie(lignePour('200000001'), 'EPCI X')?.titre).toBe(
      'Ce que la commune abrite',
    )
    expect(storyEconomie(lignePour('22'), 'Département 22')?.titre).toBe(
      'Ce que la commune abrite',
    )
  })

  it('carries a precision naming the matière — « Spécialisation des établissements actifs » (issues #153 + #156)', () => {
    expect(storyEconomie(lignePour('22001'), 'Commune A1')?.precision).toBe(
      'Spécialisation des établissements actifs',
    )
    expect(storyEconomie(lignePour('200000001'), 'EPCI X')?.precision).toBe(
      'Spécialisation des établissements actifs',
    )
    expect(storyEconomie(lignePour('22'), 'Département 22')?.precision).toBe(
      'Spécialisation des établissements actifs',
    )
  })

  it('states in its own copy that the reading is about establishments, never jobs (issue #156)', () => {
    const story = storyEconomie(lignePour('22001'), 'Commune A1')

    expect(story?.uneLigne).toContain('établissements actifs')
    expect(story?.precision).toContain('établissements')
    expect(story?.commentLire).toContain('établissements actifs')
    expect(story?.commentLire).toContain('jamais sur les emplois')
  })

  it('stamps the story with its own vintage from the payload row (issue #74)', () => {
    const story = storyEconomie(lignePour('22001'), 'Commune A1')

    expect(story?.vintage).toContain('data.bretagne.bzh')
    expect(story?.vintage).toContain('réf. 31 mars 2026')
  })
})

describe('storyEconomie — ce-que-la-bretagne-abrite (top-5 par présence, région)', () => {
  it('reads the région’s top-5 by presence: n + part du parc, no LQ', () => {
    const story = storyEconomie(lignePour('53'), 'Bretagne')

    expect(story).not.toBeNull()
    expect(story?.storyKey).toBe('ce-que-la-bretagne-abrite')
    expect(story?.titre).toBe('Ce que la Bretagne abrite')
    // the présence reading carries no precision — its matière lives in its
    // own comment-lire (issue #153: the precision is the specialisation's)
    expect(story?.precision).toBeUndefined()
    expect(story?.lignes.map((l) => l.rang)).toEqual([1, 2, 3, 4, 5])
    expect(story?.lignes[0]).toEqual({
      rang: 1,
      label: "Location de terrains et d'autres biens immobiliers",
      mesure: '124 881 établissements · 16,5 % du parc breton',
    })
  })

  it('drafts the presence one-liner and a comment-lire explaining why the LQ is absent', () => {
    const story = storyEconomie(lignePour('53'), 'Bretagne')

    expect(story?.uneLigne).toBe(
      'La Bretagne abrite surtout Location de terrains et d\'autres biens immobiliers, ' +
        'Location de logements et Autres organisations fonctionnant par adhésion volontaire.',
    )
    expect(story?.commentLire).toContain('présence')
    expect(story?.commentLire).toContain('parc breton')
  })
})

describe('storyEconomie — honest edges', () => {
  it('returns null for a territory without an Économie Story — never invents a reading', () => {
    expect(storyEconomie(null, 'Commune D')).toBeNull()
  })

  it('is deterministic — the same row gives the same story', () => {
    const une = storyEconomie(lignePour('200000001'), 'EPCI X')
    const deux = storyEconomie(lignePour('200000001'), 'EPCI X')

    expect(une?.lignes).toEqual(deux?.lignes)
    expect(une?.uneLigne).toBe(deux?.uneLigne)
    expect(une?.precision).toBe(deux?.precision)
  })
})
