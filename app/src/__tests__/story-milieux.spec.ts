import { describe, expect, it } from 'vitest'

import { storyMilieux } from '../fiche/storyMilieux'
import type { HistoireMilieux } from '../payload/types'

/**
 * The Story copy of the Milieux theme (issue #174, ADR-0014, re-keyed by spec
 * #225) — « Se densifier, s'étaler, ou s'en aller », the single Story: a
 * territory's growth against its land, read as EXACTLY ONE of four readings by
 * the SIGNS of the two forces (seuil 0 — ZAN is a zero-objective, a 0 is a
 * real 0). The copy is keyed by the pipeline's classification. The land force
 * is the OCS-GE per-capita STATE trajectory (not the CONSOENAF flow) — so the
 * renaturation reading is MEASURED (artif_m3 < artif_m2 is real
 * désartificialisation) and the per-capita figure exists for EVERY territory.
 * The « comment lire » quotes both forces on their own clocks (the population
 * window and the OCS-GE state window), states the bracketing population rule
 * once, and names the per-département millésimes when the aggregate mixes
 * them. The mapper consumes the SCALAIRES_STORY declaration (ADR-0019) — the
 * artif scalars' field names are the declaration's, never hardcoded. Pure,
 * isolated, deterministic; the mapping shape is locked, the wording stays
 * factual.
 */

/** Une ligne Milieux valide du contrat (validate.ts) — les états et la trajectoire restent nullables (#243). */
function uneHistoire(overrides: Partial<HistoireMilieux> = {}): HistoireMilieux {
  return {
    territoire: '22001',
    type: 'commune',
    theme: 'milieux',
    story_key: 'se-densifier-setaler-ou-sen-aller',
    periode_pop: '2017-2023',
    periode_artif: '2021-2025',
    delta_population: 0,
    artif_m2: 0,
    artif_m3: 0,
    artif_m2_par_habitant: 0,
    artif_m3_par_habitant: 0,
    trajectoire_artif_par_habitant: 1,
    classification: 'grandir-en-setalant',
    ...overrides,
  }
}

const LECTURES = [
  'grandir-en-se-densifiant',
  'grandir-en-setalant',
  'sen-aller-et-consommer-quand-meme',
  'les-departs-laissent-la-place-a-la-renaturation',
] as const

describe('storyMilieux — the copy keyed by the sign classification', () => {
  it('returns the setalant reading: one-liner + both forces on their own clocks in comment-lire', () => {
    const story = storyMilieux(
      uneHistoire({
        classification: 'grandir-en-setalant',
        delta_population: 200,
        artif_m2_par_habitant: 2250,
        artif_m3_par_habitant: 2550,
        trajectoire_artif_par_habitant: 1.13,
        periode_pop: '2017-2023',
        periode_artif: '2021-2025',
      }),
    )

    expect(story).toMatchObject({
      clef: 'grandir-en-setalant',
      titre: 'Se densifier, s’étaler, ou s’en aller',
      uneLigne: 'Le territoire grandit en s’étalant.',
    })
    // la fenêtre de population ET la fenêtre des états OCS-GE, chacune sur sa
    // propre horloge — jamais fusionnées
    expect(story?.commentLire).toContain('Entre 2017-2023')
    expect(story?.commentLire).toContain('200 habitants')
    expect(story?.commentLire).toContain('entre 2021 et 2025')
    expect(story?.commentLire).toContain('millésimes OCS-GE')
    expect(story?.commentLire).toContain('2 250 à 2 550 m²')
    // la trajectoire par habitant — la seconde force publiée (le ratio M3/M2)
    expect(story?.commentLire).toContain('trajectoire par habitant de 1,13')
  })

  it('states the bracketing population rule once — le recensement le plus proche de chaque état', () => {
    const story = storyMilieux(
      uneHistoire({
        delta_population: 200,
        artif_m2_par_habitant: 2250,
        artif_m3_par_habitant: 2550,
        trajectoire_artif_par_habitant: 1.13,
      }),
    )

    expect(story?.commentLire).toContain('2017 pour l’état initial')
    expect(story?.commentLire).toContain('2023 pour l’état final')
  })

  it('derives the bracketing rule from the population window — jamais codée en dur', () => {
    const story = storyMilieux(
      uneHistoire({
        periode_pop: '2019-2025',
        delta_population: 200,
        artif_m2_par_habitant: 2250,
        artif_m3_par_habitant: 2550,
        trajectoire_artif_par_habitant: 1.13,
      }),
    )

    expect(story?.commentLire).toContain('2019 pour l’état initial')
    expect(story?.commentLire).toContain('2025 pour l’état final')
  })

  it('drafts a one-liner and a comment-lire for each of the four readings', () => {
    for (const lecture of LECTURES) {
      const story = storyMilieux(
        uneHistoire({
          classification: lecture,
          delta_population: 100,
          artif_m2_par_habitant: 900,
          artif_m3_par_habitant: 855,
          trajectoire_artif_par_habitant: 0.95,
        }),
      )

      expect(story, `lecture « ${lecture} » sans copie`).not.toBeNull()
      expect(story?.uneLigne.length).toBeGreaterThan(0)
      expect(story?.commentLire.length).toBeGreaterThan(0)
    }
  })

  it('gives each reading its own one-liner (four distinct sentences)', () => {
    const uneLignes = new Set(
      LECTURES.map((lecture) =>
        storyMilieux(
          uneHistoire({
            classification: lecture,
            delta_population: 100,
            artif_m2_par_habitant: 900,
            artif_m3_par_habitant: 855,
            trajectoire_artif_par_habitant: 0.95,
          }),
        )?.uneLigne,
      ),
    )

    expect(uneLignes.size).toBe(4)
  })

  it('the densifiant one-liner is the pivot’s — la population grandit plus vite que la terre', () => {
    const story = storyMilieux(
      uneHistoire({
        classification: 'grandir-en-se-densifiant',
        delta_population: 100,
        artif_m2_par_habitant: 900,
        artif_m3_par_habitant: 855,
        trajectoire_artif_par_habitant: 0.95,
      }),
    )

    expect(story?.uneLigne).toBe('La population grandit plus vite que la terre artificialisée.')
    // le test « zéro consommation » est mort avec les flux CONSOENAF
    expect(story?.commentLire).not.toMatch(/zéro|consommation|consommer/)
    expect(story?.commentLire).toContain('densifie')
  })

  it('the renaturation reading states the measured decrease plainly — jamais une aspiration', () => {
    const story = storyMilieux(
      uneHistoire({
        classification: 'les-departs-laissent-la-place-a-la-renaturation',
        delta_population: -160,
        artif_m2_par_habitant: 420,
        artif_m3_par_habitant: 410,
        trajectoire_artif_par_habitant: 0.98,
        periode_artif: '2021-2024',
      }),
    )

    expect(story?.uneLigne).toBe('Les départs laissent la place à la renaturation.')
    expect(story?.commentLire).toContain('l’état final est inférieur à l’état initial')
    expect(story?.commentLire).toContain('désartificialisation')
    expect(story?.commentLire).toContain('mesurée')
    // les disclaimers de l'ancienne copie sont morts avec les flux
    expect(story?.commentLire).not.toMatch(/potentielle|jamais mesurée/)
    expect(story?.commentLire).not.toContain('absence de nouvelle consommation')
  })

  it('quotes the per-capita state for a shrinking territory — définie pour tout territoire (US 7)', () => {
    const story = storyMilieux(
      uneHistoire({
        classification: 'sen-aller-et-consommer-quand-meme',
        delta_population: -150,
        artif_m2_par_habitant: 500,
        artif_m3_par_habitant: 530,
        trajectoire_artif_par_habitant: 1.06,
        periode_artif: '2021-2024',
      }),
    )

    expect(story?.commentLire).toContain('500 à 530 m²')
  })

  it('names the per-département millésimes when the aggregate mixes them (cross-dépt rider)', () => {
    const story = storyMilieux(
      uneHistoire({
        delta_population: 140,
        artif_m2_par_habitant: 750,
        artif_m3_par_habitant: 830,
        trajectoire_artif_par_habitant: 1.11,
        periode_artif: '2021-2025 (22) · 2021-2024 (29)',
      }),
    )

    expect(story?.commentLire).toContain('2021-2025 (22) · 2021-2024 (29)')
    expect(story?.commentLire).toMatch(/millésimes des états OCS-GE diffèrent/)
    // pas de fenêtre unique inventée pour un agrégat multi-départements
    expect(story?.commentLire).not.toMatch(/entre 2021 et 2025/)
  })

  it('carries NO intensity in the prose — la figure porte l’intensité, pas le prose (#65)', () => {
    const story = storyMilieux(
      uneHistoire({
        delta_population: 200,
        artif_m2_par_habitant: 2250,
        artif_m3_par_habitant: 2550,
        trajectoire_artif_par_habitant: 1.13,
      }),
    )

    expect(story).not.toHaveProperty('intensite')
    expect(story?.commentLire).not.toMatch(/par habitant ajouté/)
  })

  it('returns null for an unknown classification — never invents a one-liner', () => {
    expect(storyMilieux(uneHistoire({ classification: 'super' }))).toBeNull()
    expect(storyMilieux(uneHistoire({ classification: '' }))).toBeNull()
    expect(storyMilieux(uneHistoire({ classification: null }))).toBeNull()
  })

  it('returns null for the incomplete-window cases of the contract #243 — never an invented reading', () => {
    // trajectoire manquante (M2 = 0 — le ratio est indéfini)
    expect(storyMilieux(uneHistoire({ trajectoire_artif_par_habitant: null }))).toBeNull()
    // état manquant (le trou NA)
    expect(storyMilieux(uneHistoire({ artif_m2_par_habitant: null }))).toBeNull()
    expect(storyMilieux(uneHistoire({ artif_m3_par_habitant: null }))).toBeNull()
    // fenêtre des états manquante (aucune donnée OCS-GE)
    expect(storyMilieux(uneHistoire({ periode_artif: null }))).toBeNull()
  })
})
