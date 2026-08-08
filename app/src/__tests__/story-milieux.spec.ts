import { describe, expect, it } from 'vitest'

import { storyMilieux } from '../fiche/storyMilieux'

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
 * them. The intensity is the figure's job (#65) — it stays OUT of the prose.
 * Pure, isolated, deterministic; the mapping shape is locked, the wording
 * stays factual.
 */

const LECTURES = [
  'grandir-en-se-densifiant',
  'grandir-en-setalant',
  'sen-aller-et-consommer-quand-meme',
  'les-departs-laissent-la-place-a-la-renaturation',
] as const

describe('storyMilieux — the copy keyed by the sign classification', () => {
  it('returns the setalant reading: one-liner + both forces on their own clocks in comment-lire', () => {
    const story = storyMilieux(
      'grandir-en-setalant', 200, 2250, 2550, 1.13, '2017-2023', '2021-2025',
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
      'grandir-en-setalant', 200, 2250, 2550, 1.13, '2017-2023', '2021-2025',
    )

    expect(story?.commentLire).toContain('2017 pour l’état initial')
    expect(story?.commentLire).toContain('2023 pour l’état final')
  })

  it('derives the bracketing rule from the population window — jamais codée en dur', () => {
    const story = storyMilieux(
      'grandir-en-setalant', 200, 2250, 2550, 1.13, '2019-2025', '2021-2025',
    )

    expect(story?.commentLire).toContain('2019 pour l’état initial')
    expect(story?.commentLire).toContain('2025 pour l’état final')
  })

  it('drafts a one-liner and a comment-lire for each of the four readings', () => {
    for (const lecture of LECTURES) {
      const story = storyMilieux(lecture, 100, 900, 855, 0.95, '2017-2023', '2021-2025')

      expect(story, `lecture « ${lecture} » sans copie`).not.toBeNull()
      expect(story?.uneLigne.length).toBeGreaterThan(0)
      expect(story?.commentLire.length).toBeGreaterThan(0)
    }
  })

  it('gives each reading its own one-liner (four distinct sentences)', () => {
    const uneLignes = new Set(
      LECTURES.map((lecture) =>
        storyMilieux(lecture, 100, 900, 855, 0.95, '2017-2023', '2021-2025')?.uneLigne,
      ),
    )

    expect(uneLignes.size).toBe(4)
  })

  it('the densifiant one-liner is the pivot’s — la population grandit plus vite que la terre', () => {
    const story = storyMilieux(
      'grandir-en-se-densifiant', 100, 900, 855, 0.95, '2017-2023', '2021-2025',
    )

    expect(story?.uneLigne).toBe('La population grandit plus vite que la terre artificialisée.')
    // le test « zéro consommation » est mort avec les flux CONSOENAF
    expect(story?.commentLire).not.toMatch(/zéro|consommation|consommer/)
    expect(story?.commentLire).toContain('densifie')
  })

  it('the renaturation reading states the measured decrease plainly — jamais une aspiration', () => {
    const story = storyMilieux(
      'les-departs-laissent-la-place-a-la-renaturation', -160, 420, 410, 0.98, '2017-2023', '2021-2024',
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
      'sen-aller-et-consommer-quand-meme', -150, 500, 530, 1.06, '2017-2023', '2021-2024',
    )

    expect(story?.commentLire).toContain('500 à 530 m²')
  })

  it('names the per-département millésimes when the aggregate mixes them (cross-dépt rider)', () => {
    const story = storyMilieux(
      'grandir-en-setalant', 140, 750, 830, 1.11, '2017-2023', '2021-2025 (22) · 2021-2024 (29)',
    )

    expect(story?.commentLire).toContain('2021-2025 (22) · 2021-2024 (29)')
    expect(story?.commentLire).toMatch(/millésimes des états OCS-GE diffèrent/)
    // pas de fenêtre unique inventée pour un agrégat multi-départements
    expect(story?.commentLire).not.toMatch(/entre 2021 et 2025/)
  })

  it('carries NO intensity in the prose — la figure porte l’intensité, pas le prose (#65)', () => {
    const story = storyMilieux(
      'grandir-en-setalant', 200, 2250, 2550, 1.13, '2017-2023', '2021-2025',
    )

    expect(story).not.toHaveProperty('intensite')
    expect(story?.commentLire).not.toMatch(/par habitant ajouté/)
  })

  it('returns null for an unknown classification — never invents a one-liner', () => {
    expect(storyMilieux('super', 100, 900, 855, 0.95, '2017-2023', '2021-2025')).toBeNull()
    expect(storyMilieux('', 100, 900, 855, 0.95, '2017-2023', '2021-2025')).toBeNull()
    expect(storyMilieux(null, 100, 900, 855, 0.95, '2017-2023', '2021-2025')).toBeNull()
  })
})
