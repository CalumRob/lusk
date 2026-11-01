import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import FigureOffreCyclable from '../components/fiche/FigureOffreCyclable.vue'
import OngletTheme from '../components/fiche/OngletTheme.vue'
import {
  apercuAvecNAFixture,
  histoiresMobiliteFixture,
  indicateursMobiliteFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload, ThemeMetadata } from '../payload/types'
import { sousGroupesFiche } from '../fiche/content/ficheGrammar'

/**
 * OngletTheme — the Mobilité block through the SHARED subgroup anatomy
 * (issue #314): the app-owned four subgroup layout — the reading slot in
 * « L'accès aux services », the compact « L'offre cyclable » figure in
 * « Le partage de l'espace public », and producer rows kept in their app
 * presentation order with ranks and vintages intact. The vélo salience keeps its
 * row-driven no-chart honesty. Consumes the payload selectors — never raw JSON.
 */

const payloadMobilite: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursMobiliteFixture,
  histoires: histoiresMobiliteFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { mobilite: metadonneesThemesFixtures.mobilite },
}

async function monter(territoire: string, payload: Payload = payloadMobilite) {
  const wrapper = mount(OngletTheme, {
    props: { theme: 'mobilite', payload, territoire },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  await flushPromises()
  return wrapper
}

function monterFigureOffreCyclable(territoire: string) {
  return mount(FigureOffreCyclable, {
    props: {
      clef: 'offre_cyclable',
      lignes: indicateursMobiliteFixture.filter((row) => row.territoire === territoire && row.key === 'offre_cyclable'),
      reseaux: indicateursMobiliteFixture.filter((row) => row.territoire === territoire && row.key === 'reseaux'),
      libelle: 'L’offre cyclable',
      labelsDetail: metadonneesThemesFixtures.mobilite?.detail_labels?.offre_cyclable,
      theme: 'mobilite',
    },
  })
}

describe('OngletTheme — the shared subgroup anatomy (Mobilité, la grille + le sous-bloc)', () => {
  it('renders the app subgroup and producer figures — compact figure first, then app order', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Mobilité')
    // #627 - the acces-aux-services subgroup has neither figures nor a
    // reading any more: on the shared path it stays silent (the honest
    // absent-data state, never an empty shell), so the first rendered
    // subgroup is the retained partage one.
    expect(wrapper.find('[data-groupe="acces-aux-services"]').exists()).toBe(false)
    expect(wrapper.find('.sous-groupe-titre').text()).toBe('Le partage de l’espace public')
    const figures = wrapper
      .findAll('.grille-indicateurs .figure-indicateur')
      .map((f) => f.attributes('data-clef'))
    // #627 - the acces-aux-services unit keeps its structural identity but
    // renders no figures (the production AEDAR evidence owns its body); the
    // retained subgroups render their grammar figures in app order.
    expect(figures).toEqual([
      'offre_cyclable',
      'reseaux',
      'reseaux_par_habitant',
      'surface_reseaux_routiers',
      'places_stationnement_velo_1000',
      'voitures_menage',
      'bornes_recharge',
      'offre_tc',
    ])
    expect(wrapper.find('[data-groupe="acces-aux-services"] .figure-indicateur').exists()).toBe(false)
  })

  it('preserves the production compact figure family for cycling offer', async () => {
    // #869 — the served public/data projection strips the subgroup figures
    // (app-owned since ficheGrammar took the presentation); #627 retires the
    // acces-aux-services figure with the legacy surface. The production
    // compact figure now lives in the app grammar alone.
    const publishedMetadata = JSON.parse(readFileSync(
      join(process.cwd(), '../public/data/theme_mobilite.json'), 'utf8',
    )) as ThemeMetadata
    for (const subgroup of publishedMetadata.subgroups) {
      expect(subgroup.figure, `${subgroup.key} served figure`).toBeUndefined()
    }
    const grammarFigure = sousGroupesFiche('mobilite')
      .find((subgroup) => subgroup.key === 'partage-de-lespace-public')?.figure
    expect(grammarFigure).toEqual({ family: 'composition', indicator: 'offre_cyclable' })
    expect(sousGroupesFiche('mobilite')
      .find((subgroup) => subgroup.key === 'acces-aux-services')?.figure).toBeUndefined()

    const wrapper = await monter('22001', {
      ...payloadMobilite,
      themeMetadata: { ...payloadMobilite.themeMetadata, mobilite: publishedMetadata },
    })

    const compacte = wrapper.find('.sous-groupe[data-groupe="partage-de-lespace-public"] .figure-compacte')
    expect(compacte.exists()).toBe(true)
    expect(compacte.attributes('data-famille')).toBe('composition')
    expect(compacte.find('.figure-indicateur').attributes('data-clef')).toBe('offre_cyclable')
    expect(wrapper.findAll('.figure-indicateur[data-clef="offre_cyclable"]')).toHaveLength(1)
    expect(wrapper.find('.sous-groupe[data-groupe="acces-aux-services"] .figure-compacte').exists()).toBe(false)
  })

  it('reads the factual public-transport framing from retained producer metadata', async () => {
    const upstream = JSON.parse(readFileSync(
      join(process.cwd(), '../public/data/theme_mobilite.json'), 'utf8',
    )) as ThemeMetadata
    upstream.subgroups.find((subgroup) => subgroup.key === 'offre-transports-commun')!.framing =
      'Cadrage factuel du réseau fourni par le producteur.'
    const wrapper = await monter('22001', {
      ...payloadMobilite,
      themeMetadata: { mobilite: upstream },
    })

    expect(wrapper.find('[data-groupe="offre-transports-commun"] .sous-groupe-titre').text())
      .toBe('L’offre de transports en commun')
    expect(wrapper.find('[data-groupe="offre-transports-commun"] .sous-groupe-cadrage').text())
      .toBe('Cadrage factuel du réseau fourni par le producteur.')
  })

  it('withholds the factual public-transport framing without verified metadata — never an app literal', async () => {
    const wrapper = await monter('22001', {
      ...payloadMobilite,
      themeMetadata: {},
    })

    expect(wrapper.find('[data-groupe="offre-transports-commun"] .sous-groupe-titre').text())
      .toBe('L’offre de transports en commun')
    expect(wrapper.find('[data-groupe="offre-transports-commun"] .sous-groupe-cadrage').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('500 mètres')
    expect(wrapper.text()).not.toContain('90 minutes')
  })

  it('labels say « à pied ou en transports en commun », NEVER « sans voiture » — no exception any more', async () => {
    const wrapper = await monter('22001')

    const libelles = wrapper.findAll('.figure-indicateur-libelle').map((l) => l.text())
    for (const libelle of libelles) {
      expect(libelle).not.toContain('sans voiture')
    }
    expect(libelles).toContain('Voitures par ménage')
    expect(libelles).toContain('Bornes de recharge pour véhicules électriques')
    // #627 - the retired accessibility figures (iso_*/share_*/avg_*) never
    // render on the shared path, and `nb_buildings` stays out of the fiche.
    expect(libelles).not.toContain('Bâtiments résidentiels analysés')
    expect(wrapper.text()).not.toContain('Part des bâtiments sans accès')
  })

  it('renders the multi-detail figures with their own detail labels (voitures ×3, reseaux ×3)', async () => {
    const wrapper = await monter('22001')

    const voitures = wrapper.find('.figure-indicateur[data-clef="voitures_menage"]')
    expect(voitures.text()).toContain('Ménages sans voiture')
    expect(voitures.text()).toContain('Ménages avec 1 voiture')
    expect(voitures.text()).toContain('Ménages avec 2 voitures ou plus')
    const reseaux = wrapper.find('.figure-indicateur[data-clef="reseaux"]')
    expect(reseaux.text()).toContain('Longueur — à pied ou en transports en commun')
    expect(reseaux.text()).toContain('Longueur — à vélo')
    expect(reseaux.text()).toContain('Longueur — en voiture')
    // pas de barre segmentée : les modes restent trois lectures séparées.
    expect(reseaux.find('.barre-segmentee').exists()).toBe(true)
  })

  it('renders the regional three-part motorisation composition', async () => {
    const wrapper = await monter('53')
    const voitures = wrapper.find('.figure-indicateur[data-clef="voitures_menage"]')
    expect(voitures.exists()).toBe(true)
    expect(voitures.text()).toContain('Ménages sans voiture')
    expect(voitures.text()).toContain('Ménages avec 1 voiture')
    expect(voitures.text()).toContain('Ménages avec 2 voitures ou plus')
  })

  it('stamps the block with no snapshot estampille — the analysis retired with the legacy surface', async () => {
    const wrapper = await monter('22001')

    // #627 - the slow-clock stamp described the retired snapshot analysis;
    // the production AEDAR evidence carries its own provenance and the
    // retained Mobilité facts use their ordinary vintage chips.
    expect(wrapper.find('.estampille-snapshot').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Analyse calculée le')
  })
})

// #627 - the reading slot for Mobilité retired with the « Vingt minutes
// sans voiture » snapshot: the app grammar declares no reading for the theme
// and the production cahier owns its editorial body. The reading slot
// machinery itself stays covered by the Démographie/Milieux/Économie/
// Habitat OngletTheme specs.
describe('FigureOffreCyclable — sa présentation spécialisée reste testée hors du binding fiche', () => {
  it("renders the headline « X % de l'infrastructure routière » — computed app-side from the payload rows", async () => {
    // la région 53 : 4 913,233 km ÷ 101 353,736 km ≈ 4,8 % (l'e2e #231)
    const wrapper = monterFigureOffreCyclable('53')

    const figure = wrapper.find('.figure-indicateur[data-clef="offre_cyclable"]')
    expect(figure.exists()).toBe(true)
    expect(figure.find('.valeur-numerique').text()).toBe('4,8 %')
    expect(figure.text()).toContain('de l’infrastructure routière')
  })

  it('renders the protégé vs partagé bars in km / 1 000 hab with their labels', async () => {
    const wrapper = monterFigureOffreCyclable('53')

    const figure = wrapper.find('.figure-indicateur[data-clef="offre_cyclable"]')
    expect(figure.text()).toContain('Protégé')
    expect(figure.text()).toContain('Partagé')
    expect(figure.text()).toContain('0,96')
    expect(figure.text()).toContain('0,47')
    expect(figure.text()).toContain('km / 1 000 hab')
    expect(figure.find('.barre-segmentee').exists()).toBe(true)
    expect(figure.findAll('.barre-segment')).toHaveLength(2)
  })

  it('shows 0 for a commune at 0 km — never an absent figure, never « à venir »', async () => {
    const wrapper = monterFigureOffreCyclable('22001')

    const figure = wrapper.find('.figure-indicateur[data-clef="offre_cyclable"]')
    expect(figure.exists()).toBe(true)
    expect(figure.find('.valeur-numerique').text()).toBe('0 %')
    expect(figure.text()).toContain('de l’infrastructure routière')
    expect(figure.text()).not.toContain('à venir')
  })

  it('keeps its vintage stamp (osm_reseaux) and its per-detail ranks as labels', async () => {
    const wrapper = monterFigureOffreCyclable('22001')

    const figure = wrapper.find('.figure-indicateur[data-clef="offre_cyclable"]')
    expect(figure.find('.estampille-vintage').text()).toContain(
      'OpenStreetMap — réseaux routier/cyclable/piéton',
    )
    expect(figure.findAll('.puce-rang')).toHaveLength(2)
    // offre_cyclable : plus = mieux → glyphe ▲ sur chaque détail (#371)
    expect(figure.findAll('.puce-rang').map((p) => p.text())).toEqual([
      "▲ 20e/38 de l'EPCI",
      "▲ 10e/38 de l'EPCI",
    ])
  })

  it("reads the c network denominator from the SAME territory (la règle « dans l'EPCI : X % »)", async () => {
    // l'EPCI X : 34,2 km ÷ 1 140,338 km ≈ 3 %
    const wrapper = monterFigureOffreCyclable('200000001')

    const figure = wrapper.find('.figure-indicateur[data-clef="offre_cyclable"]')
    expect(figure.find('.valeur-numerique').text()).toBe('3 %')
    expect(figure.text()).toContain('de l’infrastructure routière')
  })
})

describe('OngletTheme — the Mobilité block, honest edge cases', () => {
  it('renders no subgroup content and no reading when the territory has neither figures nor Story', async () => {
    const wrapper = await monter('29002')

    expect(wrapper.findAll('.figure-indicateur')).toHaveLength(0)
    expect(wrapper.find('.sous-groupe-lecture').exists()).toBe(false)
    expect(wrapper.find('.estampille-snapshot').exists()).toBe(false)
  })
})
