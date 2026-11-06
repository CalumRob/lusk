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
import { nativeResources } from './helpers/semanticApiFixtures'
import { PRODUCER_THEME_METADATA } from './helpers/producerThemeMetadata'

// Producer indicator identities outside the retained Methods product: the old
// Mobilité access surface was retired from the app in #870. Some declarations
// remain as page metadata, others only in the producer's indicator-key roster.
const INDICATEURS_MOBILITE_RETIRES = [
  'avg_div_b', 'avg_div_car', 'avg_div_t', 'avg_tot_b', 'avg_tot_car', 'avg_tot_t',
  'iso_administration', 'iso_alimentation', 'iso_banque', 'iso_ecole', 'iso_sante',
  'nb_buildings', 'tot_loss_b', 'tot_loss_t',
  'share_admin_b', 'share_admin_c', 'share_admin_t', 'share_bank_b', 'share_bank_c', 'share_bank_t',
  'share_food_b', 'share_food_c', 'share_food_t', 'share_health_b', 'share_health_c', 'share_health_t',
  'share_school_b', 'share_school_c', 'share_school_t',
] as const

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

  it('aligns documented indicator keys and units with producer pages and the native API catalogue', () => {
    for (const theme of THEMES_CONSTRUITS) {
      const producer = PRODUCER_THEME_METADATA[theme]
      const documented = THEMES_METHODES[theme].indicateurs
      const pages = producer.indicator_pages ?? {}
      const apiResources = nativeResources(theme)

      for (const [key, indicator] of Object.entries(documented)) {
        const page = pages[key]
        if (page) {
          expect(producer.indicator_keys, `${theme}.${key} producer key`).toContain(key)
          expect(page.indicator, `${theme}.${key} producer page identity`).toBe(key)
          const resource = apiResources.find((candidate) => candidate.resource_id === key &&
            candidate.resource_kind === 'indicator')
          expect(resource, `${theme}.${key} native indicator resource`).toBeDefined()
          expect(resource!.unit, `${theme}.${key} producer/API unit`).toBe(page.unit)
          expect(indicator.unite, `${theme}.${key} Methods unit`).toBe(page.unit)
          continue
        }

        if (theme === 'mobilite' && key === 'raccordement_reference') {
          // The reference is a named API resource linked by the producer's
          // raccordement page, not an independent indicator page.
          expect(pages.raccordement_courbe.trajectory.reference.indicator).toBe(key)
          const resource = apiResources.find((candidate) => candidate.resource_id === key &&
            candidate.shapes.includes('named_reference'))
          expect(resource, `${theme}.${key} named-reference resource`).toBeDefined()
          expect(indicator.unite, `${theme}.${key} native unit`).toBe(resource!.unit)
          continue
        }

        if (theme === 'milieux' && key === 'trajectoire_artif_par_habitant') {
          // This derived ratio is published inside the typed reading, with no
          // standalone page/resource (and therefore no producer unit field).
          const reading = producer.semantic_resources.find((resource: any) =>
            resource.resource_id === 'milieux_selected_reading')
          expect(reading?.fields, `${theme}.${key} producer reading field`).toContain(key)
          expect(producer.indicator_keys).not.toContain(key)
          expect(pages).not.toHaveProperty(key)
          expect(apiResources.some((resource) => resource.resource_id === key)).toBe(false)
          expect(indicator.unite, `${theme}.${key} no standalone unit contract`).toBe('')
          continue
        }

        throw new Error(`No producer/API fact contract for Methods indicator ${theme}.${key}`)
      }

      const excludedIndicators = theme === 'mobilite' ? INDICATEURS_MOBILITE_RETIRES : []
      for (const key of Object.keys(pages)) {
        expect(producer.indicator_keys, `${theme}.${key} producer key`).toContain(key)
        const explicitlyExcluded = (excludedIndicators as readonly string[]).includes(key)
        expect(Object.hasOwn(documented, key) || explicitlyExcluded,
          `${theme}.${key} is documented or explicitly excluded`).toBe(true)
        if (explicitlyExcluded) {
          expect(apiResources.some((resource) => resource.resource_id === key),
            `${theme}.${key} retired API route`).toBe(false)
          expect(Object.hasOwn(documented, key)).toBe(false)
          continue
        }
        const resource = apiResources.find((candidate) => candidate.resource_id === key &&
          candidate.resource_kind === 'indicator')
        expect(resource, `${theme}.${key} native producer page`).toBeDefined()
        expect(resource!.unit, `${theme}.${key} metadata/API unit`).toBe(pages[key].unit)
      }
      for (const key of excludedIndicators) {
        expect(producer.indicator_keys, `${theme}.${key} named producer exclusion`).toContain(key)
        if (Object.hasOwn(pages, key)) expect(pages, `${theme}.${key} page metadata`).toHaveProperty(key)
        expect(apiResources.some((resource) => resource.resource_id === key),
          `${theme}.${key} retired API route`).toBe(false)
        expect(Object.hasOwn(documented, key)).toBe(false)
      }

      const producerSupportKeys = theme === 'mobilite' ? ['raccordement_reference'] : []
      const documentedProducerKeys = Object.keys(documented)
        .filter((key) => (producer.indicator_keys as string[]).includes(key))
      expect(new Set(producer.indicator_keys as string[]), `${theme} producer indicator-key roster`)
        .toEqual(new Set([...documentedProducerKeys, ...excludedIndicators, ...producerSupportKeys]))
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
