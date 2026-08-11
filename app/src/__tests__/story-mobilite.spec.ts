import { describe, expect, it } from 'vitest'

import { storyMobilite } from '../fiche/storyMobilite'
import { histoiresMobiliteFixture } from '../payload/fixtures'
import type { HistoireMobilite } from '../payload/types'

/**
 * The Mobilité Story (issue #142, RÉSOLUE par #312, ADR-0012) — the
 * flagship's headline: the default « Vingt minutes sans voiture » (div_loss_t,
 * la lecture) and the salience « Ce que le vélo préserve » (le delta), ONE
 * resolved reading per territoire — the payload carries the selected story,
 * the mapper renders it, it never picks. The copy is generated from the
 * payload rows — never hand-written per territoire; the title « Vingt minutes
 * sans voiture » is the ONE sanctioned "sans voiture" phrase, the « comment
 * lire » carries the precision « à pied ou en transports en commun » and
 * quotes the snapshot date.
 */

const lignePour = (territoire: string): HistoireMobilite | null =>
  histoiresMobiliteFixture.find(
    (h): h is HistoireMobilite => h.theme === 'mobilite' && h.territoire === territoire,
  ) ?? null

describe('storyMobilite — vingt-minutes-sans-voiture (le défaut)', () => {
  it('reads the commune’s div_loss_t — "Sans voiture, 38 types de services disparaissent."', () => {
    const story = storyMobilite(lignePour('22001'))

    expect(story).not.toBeNull()
    expect(story?.storyKey).toBe('vingt-minutes-sans-voiture')
    expect(story?.titre).toBe('Vingt minutes sans voiture')
    expect(story?.uneLigne).toBe('Sans voiture, 38 types de services disparaissent.')
    expect(story?.divLossT).toBe(38)
    expect(story?.divLossB).toBe(38)
    expect(story?.delta).toBe(0)
  })

  it('carries the distribution signature — the precomputed density, never the matrix', () => {
    const story = storyMobilite(lignePour('22001'))

    expect(story?.distribution).not.toBeNull()
    expect(story?.distribution?.min).toBe(28)
    expect(story?.distribution?.max).toBe(47)
    expect(story?.distribution?.dens).toHaveLength(10)
    expect(story?.distribution?.dec).toHaveLength(10)
    expect(story?.distribution?.dens[0]).toBeCloseTo(0.005915, 6)
    expect(story?.distribution?.dec[0]).toBeCloseTo(33.7, 6)
  })

  it('the « comment lire » carries the precision « à pied ou en transports en commun » and the snapshot date', () => {
    const story = storyMobilite(lignePour('22001'))

    expect(story?.commentLire).toContain('À pied ou en transports en commun à 20 minutes')
    expect(story?.commentLire).toContain('alimentation')
    expect(story?.commentLire).toContain('Analyse calculée le 6 août 2026')
  })

  it('stamps the story with the snapshot’s vintage (issue #74)', () => {
    const story = storyMobilite(lignePour('22001'))

    expect(story?.vintage).toContain("Lusk — analyse d'accessibilité")
    expect(story?.vintage).toContain('réf. 28 févr. 2026')
  })
})

describe('storyMobilite — ce-que-le-velo-preserve (la saillance résolue)', () => {
  it('renders the vélo reading where the payload resolved it (issue #312 — le pool n’est jamais émis)', () => {
    const story = storyMobilite(lignePour('22002'))

    expect(story).not.toBeNull()
    expect(story?.storyKey).toBe('ce-que-le-velo-preserve')
    expect(story?.titre).toBe('Ce que le vélo préserve')
    expect(story?.uneLigne).toBe('Le vélo préserve déjà 11 types de services.')
    expect(story?.delta).toBe(11)
    // le vélo porte le delta seul — jamais la distribution (hors contrat)
    expect(story?.distribution).toBeNull()
  })

  it('reads realized access only — never potential infrastructure', () => {
    const story = storyMobilite(lignePour('22002'))

    expect(story?.commentLire).toContain('à pied ou en transports en commun à 20 minutes')
    expect(story?.commentLire).toContain('accès déjà réalisé')
    expect(story?.commentLire).not.toContain('apporteraient')
    expect(story?.commentLire).toContain('Analyse calculée le 6 août 2026')
  })
})

describe('storyMobilite — honest edges', () => {
  it('returns null for a territory without any Mobilité Story', () => {
    expect(storyMobilite(null)).toBeNull()
  })

  it('is deterministic — the same row gives the same story', () => {
    expect(storyMobilite(lignePour('22001'))?.uneLigne).toBe(
      storyMobilite(lignePour('22001'))?.uneLigne,
    )
    expect(storyMobilite(lignePour('22001'))?.distribution).toEqual(
      storyMobilite(lignePour('22001'))?.distribution,
    )
  })
})
