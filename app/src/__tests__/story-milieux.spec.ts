import { describe, expect, it } from 'vitest'

import { storyMilieux } from '../fiche/storyMilieux'

/**
 * The Story copy of the Milieux theme (issue #174, ADR-0014) — « Se
 * densifier, s'étaler, ou s'en aller », the single Story: a territory's
 * growth against its land, read as EXACTLY ONE of four readings by the SIGNS
 * of the two forces (seuil 0 — ZAN is a zero-objective, a 0 is a real 0).
 * The copy is keyed by the pipeline's classification; the « comment lire »
 * carries the precision riders: the two forces and their sources (the
 * population from the série historique, never CONSOENAF's embedded fields),
 * the two-clocks gap (the indicator is deliberately fresher than the story,
 * pinned to the population clock), and — for the renaturation reading —
 * the rider that renaturation is potential, never measured. Pure, isolated,
 * deterministic; the mapping shape is locked, the wording stays factual.
 */

const LECTURES = [
  'grandir-en-se-densifiant',
  'grandir-en-setalant',
  'sen-aller-et-consommer-quand-meme',
  'les-departs-laissent-la-place-a-la-renaturation',
] as const

describe('storyMilieux — the copy keyed by the sign classification', () => {
  it('returns the setalant reading: one-liner + forces + sources in comment-lire', () => {
    const story = storyMilieux('grandir-en-setalant', 200, 51, 2550, '2017-2023')

    expect(story).toMatchObject({
      clef: 'grandir-en-setalant',
      titre: 'Se densifier, s’étaler, ou s’en aller',
      uneLigne: 'Le territoire grandit en s’étalant.',
    })
    expect(story?.commentLire).toContain('2017-2023')
    expect(story?.commentLire).toContain('200 habitants')
    expect(story?.commentLire).toContain('51 ha')
    // la règle de source : la population vient de la série historique, jamais
    // des champs embarqués de CONSOENAF
    expect(story?.commentLire).toContain('série historique')
  })

  it('drafts a one-liner and a comment-lire for each of the four readings', () => {
    for (const lecture of LECTURES) {
      const story = storyMilieux(lecture, 100, 10, 1000, '2017-2023')

      expect(story, `lecture « ${lecture} » sans copie`).not.toBeNull()
      expect(story?.uneLigne.length).toBeGreaterThan(0)
      expect(story?.commentLire.length).toBeGreaterThan(0)
    }
  })

  it('gives each reading its own one-liner (four distinct sentences)', () => {
    const uneLignes = new Set(
      LECTURES.map((lecture) => storyMilieux(lecture, 100, 10, 1000, '2017-2023')?.uneLigne),
    )

    expect(uneLignes.size).toBe(4)
  })

  it('the densifiant reading claims zero consumption — the floor is a real 0', () => {
    const story = storyMilieux('grandir-en-se-densifiant', 100, 0, null, '2017-2023')

    expect(story?.uneLigne).toBe('Le territoire grandit sans consommer de nouveaux espaces.')
    expect(story?.commentLire).toContain('zéro')
    // la densification absorbe la croissance — la lecture le dit
    expect(story?.commentLire).toContain('densifie')
  })

  it('the renaturation reading carries the rider — potentielle, jamais mesurée', () => {
    const story = storyMilieux('les-departs-laissent-la-place-a-la-renaturation', -10, 0, null, '2017-2023')

    expect(story?.uneLigne).toBe('Les départs laissent la place à la renaturation.')
    expect(story?.commentLire).toMatch(/potentielle|jamais mesurée/)
    expect(story?.commentLire).toMatch(/jamais mesurée/)
  })

  it('documents the two-clocks gap — la lecture est épinglée à l’horloge de la population', () => {
    const story = storyMilieux('grandir-en-setalant', 200, 51, 2550, '2017-2023')

    expect(story?.commentLire).toMatch(/deux horloges|horloge de la population/)
  })

  it('carries the intensity when published — X m² d’ENAF par habitant ajouté', () => {
    const avec = storyMilieux('grandir-en-setalant', 200, 51, 2550, '2017-2023')
    expect(avec?.intensite).toContain('2 550')
    expect(avec?.intensite).toMatch(/m² d’ENAF par habitant ajouté/)

    // sous le seuil (Δpopulation non significativement positif) : jamais d'intensité
    const sans = storyMilieux('sen-aller-et-consommer-quand-meme', -150, 15.5, null, '2017-2023')
    expect(sans?.intensite).toBeNull()
  })

  it('returns null for an unknown classification — never invents a one-liner', () => {
    expect(storyMilieux('super', 100, 10, null, '2017-2023')).toBeNull()
    expect(storyMilieux('', 100, 10, null, '2017-2023')).toBeNull()
    expect(storyMilieux(null, 100, 10, null, '2017-2023')).toBeNull()
  })
})
