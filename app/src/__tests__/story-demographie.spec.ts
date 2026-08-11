import { describe, expect, it } from 'vitest'

import { storyDemographie } from '../fiche/storyDemographie'
import type { HistoireDemographie } from '../payload/types'

/**
 * The Story copy mapping (docs/themes/demographie.md, ADR-0011): the
 * classification is one of four quadrant readings by the SIGNS of the two
 * annualized rates; the copy is a one-liner per reading plus a "comment lire"
 * line that quotes the territory's actual rates. Within the two mixed
 * quadrants the copy is MAGNITUDE-AWARE (issue #73 follow-up): compensation
 * is only claimed when the positive force outweighs the negative one — Moréac
 * (+1,43 / −4,15 → net −2,72) reads "la population diminue malgré les
 * naissances", never "compensent". The mapper consumes the SCALAIRES_STORY
 * declaration (ADR-0019) — the two rate field names are the declaration's,
 * never hardcoded. Pure, isolated, deterministic. Wording is PROVISIONAL and
 * stays factual/neutral; the mapping shape is locked.
 */

/** Une ligne Démographie valide du contrat (validate.ts) — les taux sont des nombres, la classification une chaîne. */
function uneHistoire(overrides: Partial<HistoireDemographie> = {}): HistoireDemographie {
  return {
    territoire: '22001',
    type: 'commune',
    theme: 'demographie',
    story_key: 'trajectoire-demographique',
    groupe: 'etat-et-dynamique',
    salience_reason: 'defaut',
    solde_naturel: 0,
    solde_migratoire: 0,
    taux_solde_naturel: 0,
    taux_solde_migratoire: 0,
    classification: 'attire-renouvelle',
    periode: null,
    ...overrides,
  }
}

describe('storyDemographie — the copy keyed by the rate-quadrant classification', () => {
  it('returns the attire-renouvelle reading: dated title + one-liner + rates in comment-lire', () => {
    const story = storyDemographie(
      uneHistoire({
        classification: 'attire-renouvelle',
        taux_solde_naturel: 4.99,
        taux_solde_migratoire: 5.49,
        periode: '2017-2023',
      }),
    )

    expect(story).toMatchObject({
      classification: 'attire-renouvelle',
      titre: 'Trajectoire démographique (2017-2023)',
      uneLigne: 'Le territoire attire et se renouvelle.',
    })
    expect(story?.commentLire).toContain('+4,99/an pour 1 000 hab.')
    expect(story?.commentLire).toContain('+5,49/an pour 1 000 hab.')
  })

  it('dates the title only when the pipeline published the period (issue #113)', () => {
    expect(
      storyDemographie(
        uneHistoire({ taux_solde_naturel: 4.99, taux_solde_migratoire: 5.49 }),
      )?.titre,
    ).toBe('Trajectoire démographique')
  })

  it('drafts a one-liner and a comment-lire for each of the four readings', () => {
    for (const lecture of [
      'attire-renouvelle',
      'attire-meurt',
      'vide-meurt',
      'vide-renouvelle',
    ]) {
      const story = storyDemographie(
        uneHistoire({
          classification: lecture,
          taux_solde_naturel: -1.5,
          taux_solde_migratoire: 2.5,
          periode: '2017-2023',
        }),
      )

      expect(story).not.toBeNull()
      expect(story?.uneLigne.length).toBeGreaterThan(0)
      expect(story?.commentLire.length).toBeGreaterThan(0)
    }
  })

  it('gives each reading its own one-liner (four distinct sentences)', () => {
    const uneLignes = new Set(
      ['attire-renouvelle', 'attire-meurt', 'vide-meurt', 'vide-renouvelle'].map(
        (lecture) =>
          storyDemographie(
            uneHistoire({
              classification: lecture,
              taux_solde_naturel: -1.5,
              taux_solde_migratoire: 2.5,
              periode: '2017-2023',
            }),
          )?.uneLigne,
      ),
    )

    expect(uneLignes.size).toBe(4)
  })

  it('names the natural force for attire-meurt and vide-meurt without dramatic wording', () => {
    const attireMeurt = uneHistoire({
      classification: 'attire-meurt',
      taux_solde_naturel: -1.5,
      taux_solde_migratoire: 2.5,
      periode: '2017-2023',
    })
    const videMeurt = uneHistoire({
      classification: 'vide-meurt',
      taux_solde_naturel: -1.5,
      taux_solde_migratoire: -2.5,
      periode: '2017-2023',
    })

    expect(storyDemographie(attireMeurt)?.uneLigne).toContain('solde naturel')
    expect(storyDemographie(videMeurt)?.uneLigne).toContain('diminue')
    // copy decision (issue #73): no "dying"/"exodus" — factual words only
    expect(storyDemographie(videMeurt)?.uneLigne).not.toMatch(/meurt|meure|exode/i)
    expect(storyDemographie(attireMeurt)?.commentLire).not.toMatch(/meurt|meure|exode/i)
  })

  it('quotes the territory’s actual rates in « comment lire » (per-year per-1000, signed)', () => {
    const story = storyDemographie(
      uneHistoire({
        classification: 'vide-renouvelle',
        taux_solde_naturel: 2.1,
        taux_solde_migratoire: -3.3,
        periode: '2017-2023',
      }),
    )

    expect(story?.commentLire).toContain('+2,10/an pour 1 000 hab.')
    expect(story?.commentLire).toContain('-3,30/an pour 1 000 hab.')
  })

  it('vide-renouvelle: claims compensation ONLY when births outweigh departures', () => {
    // births dominate (|naturel| > |migration|) → compensation is honest
    const quiCompense = storyDemographie(
      uneHistoire({
        classification: 'vide-renouvelle',
        taux_solde_naturel: 4.0,
        taux_solde_migratoire: -2.0,
        periode: '2017-2023',
      }),
    )
    expect(quiCompense?.uneLigne).toBe('Les naissances compensent les départs.')
    expect(quiCompense?.commentLire).toContain('se maintient grâce aux naissances')

    // the tie (|naturel| = |migration|) → net zero, maintenance still honest
    const exAequo = storyDemographie(
      uneHistoire({
        classification: 'vide-renouvelle',
        taux_solde_naturel: 2.0,
        taux_solde_migratoire: -2.0,
        periode: '2017-2023',
      }),
    )
    expect(exAequo?.uneLigne).toBe('Les naissances compensent les départs.')

    // Moréac 56140: natural +1,43 / migration −4,15 → net −2,72 → NO compensation
    const moreac = storyDemographie(
      uneHistoire({
        classification: 'vide-renouvelle',
        taux_solde_naturel: 1.428125,
        taux_solde_migratoire: -4.150489,
        periode: '2017-2023',
      }),
    )
    expect(moreac?.uneLigne).toBe('La population diminue malgré les naissances.')
    expect(moreac?.commentLire).toContain('+1,43/an pour 1 000 hab.')
    expect(moreac?.commentLire).toContain('-4,15/an pour 1 000 hab.')
    expect(moreac?.commentLire).toContain('la population diminue malgré les naissances')
  })

  it('attire-meurt: claims compensation ONLY when arrivals outweigh the natural deficit', () => {
    // arrivals dominate → compensation is honest
    const quiCompense = storyDemographie(
      uneHistoire({
        classification: 'attire-meurt',
        taux_solde_naturel: -2.0,
        taux_solde_migratoire: 4.0,
        periode: '2017-2023',
      }),
    )
    expect(quiCompense?.uneLigne).toBe('Les arrivées compensent un solde naturel négatif.')
    expect(quiCompense?.commentLire).toContain('se maintient grâce aux arrivées')

    // the natural deficit dominates → population declines despite arrivals
    const deficit = storyDemographie(
      uneHistoire({
        classification: 'attire-meurt',
        taux_solde_naturel: -4.0,
        taux_solde_migratoire: 2.0,
        periode: '2017-2023',
      }),
    )
    expect(deficit?.uneLigne).toBe('La population diminue malgré les arrivées.')
    expect(deficit?.commentLire).toContain('la population diminue malgré les arrivées')
  })

  it('returns null for an unknown classification — never invents a one-liner', () => {
    // la classification est une chaîne requise par le contrat (validate.ts) —
    // l'inconnue est le seul cas honnête de lecture absente
    expect(storyDemographie(uneHistoire({ classification: 'inconnu' }))).toBeNull()
    expect(storyDemographie(uneHistoire({ classification: '' }))).toBeNull()
  })
})
