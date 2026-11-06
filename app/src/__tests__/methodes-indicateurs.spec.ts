import { describe, expect, it } from 'vitest'

import {
  LIBELLES_DIRECTION,
  THEMES_CONSTRUITS,
  THEMES_METHODES,
  ancreIndicateur,
  indicateursParDataset,
} from '../methodes/indicateurs'
import { SOURCES_METHODES, datasetDeSource } from '../methodes/sources'
import type { DirectionRang } from '../methodes/indicateurs'

/** The app-owned Methodes registry contains editorial copy and source links, not observations. */
describe('registre Méthodes — contrat éditorial app-owned', () => {
  it('couvre les thèmes construits dans l’ordre stable du registre', () => {
    expect(THEMES_CONSTRUITS).toEqual(['demographie', 'habitat', 'economie', 'mobilite', 'milieux'])
    expect(Object.keys(THEMES_METHODES)).toEqual(THEMES_CONSTRUITS)
    for (const theme of THEMES_CONSTRUITS) {
      expect(typeof THEMES_METHODES[theme].indicateurs).toBe('object')
      expect(Array.isArray(THEMES_METHODES[theme].stories)).toBe(true)
    }
  })

  it('keeps every curated indicator entry complete and linked to a known source', () => {
    for (const theme of THEMES_CONSTRUITS) {
      for (const [key, indicator] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        expect(indicator.label.length, `${theme}.${key} label`).toBeGreaterThan(0)
        expect(indicator.definition.length, `${theme}.${key} definition`).toBeGreaterThan(20)
        expect(indicator.source.length, `${theme}.${key} source`).toBeGreaterThan(0)
        expect(['plus-est-mieux', 'moins-est-mieux'], `${theme}.${key} direction`)
          .toContain(indicator.direction)
        if (indicator.sourceId === null) continue
        const source = SOURCES_METHODES[indicator.sourceId]
        expect(source, `${theme}.${key} sourceId`).toBeDefined()
        expect(indicator.source).toBe(source!.nom)
      }
      for (const story of THEMES_METHODES[theme].stories) {
        expect(story.titre.length, `${theme}.${story.clef} title`).toBeGreaterThan(0)
        expect(story.definition.length, `${theme}.${story.clef} definition`).toBeGreaterThan(20)
        expect(['publiee', 'en-pause']).toContain(story.statut)
        for (const lecture of story.lectures) {
          expect(lecture.nom.length).toBeGreaterThan(0)
          expect(lecture.lecture.length).toBeGreaterThan(10)
        }
      }
    }
  })

  it('keeps the special Story roster for themes with a single documented reading model', () => {
    expect(THEMES_METHODES.economie.stories.map((story) => [story.clef, story.statut])).toEqual([
      ['ce-que-la-commune-abrite', 'publiee'],
      ['le-matin-la-commune-se-vide', 'en-pause'],
    ])
    expect(THEMES_METHODES.milieux.stories.map((story) => story.clef))
      .toEqual(['se-densifier-setaler-ou-sen-aller'])
    const milieux = THEMES_METHODES.milieux.stories[0]!
    expect(new Set(milieux.lectures.map((lecture) => lecture.clef))).toEqual(new Set([
      'grandir-en-se-densifiant', 'grandir-en-setalant',
      'sen-aller-et-consommer-quand-meme', 'les-departs-laissent-la-place-a-la-renaturation',
    ]))
    const renaturation = milieux.lectures.find((lecture) =>
      lecture.clef === 'les-departs-laissent-la-place-a-la-renaturation')
    expect(renaturation?.lecture).toMatch(/mesurée/)
    expect(renaturation?.lecture).not.toMatch(/potentielle, jamais mesurée/)
    expect(milieux.definition).toContain('docs/research/zan-rennes.md')
  })

  it('keeps the app-owned cyclable-network definition explicit and sourced', () => {
    const figure = THEMES_METHODES.mobilite.indicateurs.offre_cyclable
    expect(figure).toMatchObject({ label: 'L’offre cyclable', unite: 'km' })
    expect(figure!.definition.length).toBeGreaterThan(100)
    expect(figure!.source).toMatch(/Geovelo/)
    expect(figure!.definition).toMatch(/Aménagements cyclables/)
    expect(figure!.definition).toMatch(/ODbL/)
    expect(figure!.definition).toMatch(/porteur/)
    expect(figure!.definition).toContain('docs/research/openstreetmap.md')
    expect(THEMES_METHODES.mobilite.stories).toEqual([])
  })

  it('documents directions and public wording for ranking', () => {
    const directions: DirectionRang[] = ['plus-est-mieux', 'moins-est-mieux']
    for (const theme of THEMES_CONSTRUITS) {
      for (const [key, indicator] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        expect(directions, `${theme}.${key}`).toContain(indicator.direction)
      }
    }
    expect(LIBELLES_DIRECTION['plus-est-mieux']).toBe('plus = mieux')
    expect(LIBELLES_DIRECTION['moins-est-mieux']).toBe('moins = mieux')
    expect(THEMES_METHODES.habitat.indicateurs.distribution_dpe?.direction).toBe('moins-est-mieux')
    expect(THEMES_METHODES.habitat.indicateurs.part_passoires?.direction).toBe('moins-est-mieux')
  })

  it('creates stable indicator anchors without colliding with the section anchor', () => {
    expect(ancreIndicateur('part_passoires')).toBe('indicateur-part-passoires')
    expect(ancreIndicateur('evolution_1968')).toBe('indicateur-evolution-1968')
    for (const theme of THEMES_CONSTRUITS) {
      for (const key of Object.keys(THEMES_METHODES[theme].indicateurs)) {
        const anchor = ancreIndicateur(key)
        expect(anchor).toMatch(/^indicateur-[a-z0-9-]+$/)
        expect(anchor).not.toBe('indicateurs')
        expect(anchor).not.toMatch(/--|-$/)
      }
    }
  })
})

describe('matrice indicateur ↔ source', () => {
  it('joins documented indicators to their registered datasets without inventing consumers', () => {
    const matrix = indicateursParDataset()
    expect(matrix.get('dvf')).toEqual([
      { clef: 'prix_m2', label: 'Médiane prix au m²', theme: 'habitat' },
    ])
    expect(matrix.get('dpe')).toEqual([
      { clef: 'part_passoires', label: 'Part de passoires thermiques', theme: 'habitat' },
      { clef: 'distribution_dpe', label: 'Distribution des étiquettes DPE (A à G)', theme: 'habitat' },
    ])
    expect(matrix.get('ocsge_artificialisation')).toEqual([
      { clef: 'artif_par_habitant', label: 'Intensité état', theme: 'milieux' },
      { clef: 'trajectoire_artif_par_habitant', label: 'Trajectoire par habitant', theme: 'milieux' },
    ])
    const knownDatasets = new Set(Object.entries(SOURCES_METHODES)
      .map(([id, source]) => source.dataset ?? id))
    for (const dataset of matrix.keys()) expect(knownDatasets.has(dataset), dataset).toBe(true)
    for (const dataset of ['flores_a38', 'epci', 'cog_passage', 'communes_limites', 'batiments_residentiels']) {
      expect(matrix.has(dataset), dataset).toBe(false)
    }
  })

  it('includes every entry with a registered source and excludes stories', () => {
    const matrix = indicateursParDataset()
    const storyKeys = new Set(THEMES_CONSTRUITS.flatMap((theme) =>
      THEMES_METHODES[theme].stories.map((story) => story.clef)))
    for (const theme of THEMES_CONSTRUITS) {
      for (const [key, indicator] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        if (indicator.sourceId === null) continue
        const dataset = datasetDeSource(indicator.sourceId)
        expect((matrix.get(dataset) ?? []).some((consumer) => consumer.clef === key), `${theme}.${key}`).toBe(true)
      }
    }
    for (const consumers of matrix.values()) {
      for (const consumer of consumers) expect(storyKeys.has(consumer.clef)).toBe(false)
    }
  })
})
