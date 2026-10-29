import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import GraphiqueSoldes from '../components/fiche/GraphiqueSoldes.vue'
import OngletTheme from '../components/fiche/OngletTheme.vue'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  histoiresEconomieFixture,
  histoiresHabitatFixture,
  histoiresMilieuxFixture,
  histoiresMobiliteFixture,
  indicateursEconomieFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  indicateursMilieuxFixture,
  indicateursMobiliteFixture,
  indicateursProgrammesFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Histoire, Payload } from '../payload/types'

/**
 * OngletTheme — the shared subgroup block (issue #314, parent #308): the
 * overline (the theme's published label) → ONE loop over the app-owned
 * subgroups — labels + framing, the reading slot (the app template
 * with producer-resolved values, the reading's figure and its exhaustive
 * source) and the indicator grid (the compact figure first, then app order).
 * There is no per-theme branch left: Démographie exercises the shared
 * anatomy with its « Trajectoire démographique » reading and its soldes chart.
 */

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { demographie: metadonneesThemesFixtures.demographie },
}

async function monter(
  territoire: string,
  histoires: Histoire[] = histoiresDemographieFixture,
  themeMetadata = payloadDemographie.themeMetadata,
) {
  const wrapper = mount(OngletTheme, {
    props: {
      theme: 'demographie',
      payload: { ...payloadDemographie, histoires, themeMetadata },
      territoire,
    },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  await flushPromises()
  return wrapper
}

describe('OngletTheme — the shared app-owned subgroup grammar (Démographie)', () => {
  it('keeps native descriptor labels and axis membership ahead of a stale loaded catalogue', async () => {
    const indicators = indicateursHabitatFixture.filter((row) => row.key !== 'distribution_dpe' ||
      row.detail === 'A' || row.detail === 'B').map((row) => row.key === 'distribution_dpe'
      ? { ...row, nativeContract: {
        label: 'Distribution DPE — contrat API',
        shapes: ['declared_profile'],
        axisValues: ['A', 'B'],
        axes: [
          { name: 'detail', key: 'A', label: 'Étiquette A — contrat API', order: 0 },
          { name: 'detail', key: 'B', label: 'Étiquette B — contrat API', order: 1 },
        ],
      } }
      : row)
    const staleMetadata = structuredClone(metadonneesThemesFixtures.habitat)
    staleMetadata.indicator_labels.distribution_dpe = 'Ancien libellé du catalogue'
    staleMetadata.detail_labels.distribution_dpe = {
      A: 'Ancienne étiquette A', B: 'Ancienne étiquette B', C: 'Ancienne étiquette C',
    }
    const wrapper = mount(OngletTheme, {
      props: {
        theme: 'habitat',
        territoire: '22001',
        metadataStatus: 'ready',
        payload: {
          ...payloadDemographie,
          indicateurs: indicators,
          histoires: histoiresHabitatFixture,
          themeMetadata: { habitat: staleMetadata },
        },
      },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()

    const figure = wrapper.get('[data-clef="distribution_dpe"]')
    expect(figure.get('figcaption').text()).toBe('Distribution DPE — contrat API')
    expect(figure.get('[data-etiquette="A"]').attributes('title')).toContain('Étiquette A — contrat API')
    expect(figure.text()).not.toContain('Ancien libellé du catalogue')
    expect(figure.text()).not.toContain('Ancienne étiquette')
    expect(figure.find('[data-etiquette="C"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('producer category labels render from the verified catalogue and a native axis label still wins', async () => {
    // Habitat `statut` categories are producer vocabulary: the verified
    // catalogue supplies them, and a native axis label outranks the catalogue.
    const catalogueMetadata = structuredClone(metadonneesThemesFixtures.habitat)
    const wrapper = mount(OngletTheme, {
      props: {
        theme: 'habitat',
        territoire: '22001',
        metadataStatus: 'ready',
        payload: {
          ...payloadDemographie,
          indicateurs: indicateursHabitatFixture,
          histoires: histoiresHabitatFixture,
          themeMetadata: { habitat: catalogueMetadata },
        },
      },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()

    const statut = wrapper.get('[data-clef="statut"]')
    expect(statut.text()).toContain(catalogueMetadata.detail_labels.statut.proprietaire)

    const changedMetadata = structuredClone(metadonneesThemesFixtures.habitat)
    changedMetadata.detail_labels.statut = { ...changedMetadata.detail_labels.statut, proprietaire: 'Propriétaires (catégorie mise à jour)' }
    const changedWrapper = mount(OngletTheme, {
      props: {
        theme: 'habitat',
        territoire: '22001',
        metadataStatus: 'ready',
        payload: {
          ...payloadDemographie,
          indicateurs: indicateursHabitatFixture,
          histoires: histoiresHabitatFixture,
          themeMetadata: { habitat: changedMetadata },
        },
      },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()

    // The rendered figure follows the CHANGED producer category label.
    const changedStatut = changedWrapper.get('[data-clef="statut"]')
    expect(changedStatut.text()).toContain('Propriétaires (catégorie mise à jour)')

    const nativeMetadata = structuredClone(metadonneesThemesFixtures.habitat)
    nativeMetadata.detail_labels.statut = { ...nativeMetadata.detail_labels.statut, proprietaire: 'Ancien libellé propriétaire' }
    const nativeWrapper = mount(OngletTheme, {
      props: {
        theme: 'habitat',
        territoire: '22001',
        metadataStatus: 'ready',
        payload: {
          ...payloadDemographie,
          indicateurs: indicateursHabitatFixture.map((row) => row.key !== 'statut' || row.detail !== 'proprietaire'
            ? row
            : { ...row, nativeContract: {
              label: 'Statut d’occupation — contrat API',
              shapes: ['declared_profile'],
              axisValues: ['proprietaire'],
              axes: [{ name: 'detail', key: 'proprietaire', label: 'Propriétaire — contrat API', order: 0 }],
            } }),
          histoires: histoiresHabitatFixture,
          themeMetadata: { habitat: nativeMetadata },
        },
      },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()

    const nativeStatut = nativeWrapper.get('[data-clef="statut"]')
    expect(nativeStatut.text()).toContain('Propriétaire — contrat API')
    expect(nativeStatut.text()).not.toContain('Ancien libellé propriétaire')
    wrapper.unmount()
    changedWrapper.unmount()
    nativeWrapper.unmount()
  })

  it.each([
    ['demographie', 'structure_age'],
    ['habitat', 'mix_logements'],
    ['economie', 'effectifs_salaries'],
    ['milieux', 'artif_par_habitant'],
    ['mobilite', 'voitures_menage'],
  ] as const)('keeps native %s figures visible while its catalogue is unavailable', async (theme, key) => {
    const allIndicators = [
      ...indicateursDemographieFixture,
      ...indicateursHabitatFixture,
      ...indicateursEconomieFixture,
      ...indicateursMilieuxFixture,
      ...indicateursMobiliteFixture,
      ...indicateursProgrammesFixture,
    ].map((row) => theme === 'economie' && row.theme === 'economie' && row.key === 'chomage'
      ? { ...row, nativeContract: { direction: 'high' } }
      : row)
    const wrapper = mount(OngletTheme, {
      props: {
        theme,
        territoire: '22001',
        metadataStatus: 'error',
        retryMetadata: () => undefined,
        payload: {
          ...payloadDemographie,
          indicateurs: allIndicators,
          histoires: [
            ...histoiresDemographieFixture,
            ...histoiresHabitatFixture,
            ...histoiresEconomieFixture,
            ...histoiresMilieuxFixture,
            ...histoiresMobiliteFixture,
          ],
          themeMetadata: {},
        },
      },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()

    expect(wrapper.find(`[data-clef="${key}"]`).exists()).toBe(true)
    expect(wrapper.text().toLowerCase()).toContain('disponible')
    expect(wrapper.findAll('button').some((button) => button.text() === 'Réessayer l’explication')).toBe(true)
    if (theme === 'economie') {
      expect(wrapper.get('[data-clef="chomage"] .puce-rang').attributes('aria-label')).toContain('plus = mieux')
    }
    wrapper.unmount()
  })

  it('renders the theme overline from the metadata label', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Démographie')
  })

  it('renders the app subgroup labels and framing, with the resolved-reading slot separate', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.sous-groupe[data-groupe="etat-de-la-population"]').exists()).toBe(true)
    expect(wrapper.find('.sous-groupe[data-groupe="trajectoire-demographique"]').exists()).toBe(true)
    expect(wrapper.findAll('.sous-groupe-titre').map((node) => node.text())).toEqual([
      'État de la population',
      'Trajectoire démographique',
    ])
    expect(wrapper.findAll('.sous-groupe-cadrage')[0].text()).toContain('sa densité')
  })

  it('renders indicator rows in app group order — compact figure first within each subgroup', async () => {
    const wrapper = await monter('22001')

    const figures = wrapper
      .findAll('.grille-indicateurs .figure-indicateur')
      .map((f) => f.attributes('data-clef'))
    expect(figures).toEqual(['structure_age', 'densite', 'taille_menages', 'evolution_1968'])
  })

  it('does not let stale upstream subgroup presentation override the mounted fiche', async () => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    metadata.subgroups = [{
      ...metadata.subgroups[0]!,
      key: 'upstream-stale',
      label: 'Libellé amont périmé',
      framing: 'Cadrage amont périmé.',
      indicators: ['resource-amont-perime'],
      figure: { family: 'scalar', indicator: 'resource-amont-perime' },
      reading: undefined,
    }]
    const wrapper = await monter('22001', histoiresDemographieFixture, { demographie: metadata })

    expect(wrapper.find('.sous-groupe[data-groupe="upstream-stale"]').exists()).toBe(false)
    expect(wrapper.findAll('.sous-groupe-titre').map((node) => node.text())).toEqual([
      'État de la population',
      'Trajectoire démographique',
    ])
    expect(wrapper.find('.lecture-texte').text()).toContain('5,98 par an (naturel)')
    expect(wrapper.text()).not.toContain('Libellé amont périmé')
  })

  it('renders each figure with its French label and its vintage stamp', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.text()).toContain('Densité de population')
    expect(wrapper.text()).toContain('Évolution de la population depuis 1968')
    expect(wrapper.text()).toContain('Taille moyenne des ménages')
    expect(wrapper.findAll('.estampille-vintage').length).toBe(4)
  })

  it('renders app editorial wording despite stale producer presentation, and follows a changed producer label', async () => {
    const staleMetadata = structuredClone(metadonneesThemesFixtures.demographie)
    staleMetadata.indicator_labels.densite = 'Ancien libellé du catalogue'
    staleMetadata.indicator_labels.evolution_1968 = 'Ancienne évolution'
    const staleWrapper = await monter('22001', histoiresDemographieFixture, { demographie: staleMetadata })

    // Editorial app wording wins over the stale producer presentation.
    expect(staleWrapper.text()).toContain('Densité de population')
    expect(staleWrapper.text()).not.toContain('Ancien libellé du catalogue')
    // Fact-bearing producer label (observation boundary) still renders upstream.
    expect(staleWrapper.text()).toContain('Ancienne évolution')

    const changedMetadata = structuredClone(metadonneesThemesFixtures.demographie)
    changedMetadata.indicator_labels.evolution_1968 = 'Évolution depuis le recensement 1968 (contrat mis à jour)'
    const changedWrapper = await monter('22001', histoiresDemographieFixture, { demographie: changedMetadata })

    // The rendered figure follows the CHANGED fact-bearing producer label.
    expect(changedWrapper.text()).toContain('Évolution depuis le recensement 1968 (contrat mis à jour)')
    staleWrapper.unmount()
    changedWrapper.unmount()
  })
})

describe('OngletTheme — the reading slot (the app template + the row’s values)', () => {
  it('renders the reading template with the resolved params — the payload-owned copy', async () => {
    const wrapper = await monter('22001')

    const texte = wrapper.find('.lecture-texte')
    expect(texte.exists()).toBe(true)
    expect(texte.text()).toContain('Entre 2017-2023')
    expect(texte.text()).toContain('la population de Commune A1')
    expect(texte.text()).toContain('attire et se renouvelle')
    expect(texte.text()).toContain('5,98 par an (naturel)')
    expect(texte.text()).toContain('2,56 (migratoire)')
  })

  it('porte la voix récit (serif) sur la phrase de lecture, jamais la voix corps Manrope', async () => {
    const wrapper = await monter('22001')

    const texte = wrapper.find('.lecture-texte')
    expect(texte.exists()).toBe(true)
    // la classe utilitaire globale .voix-recit pose la famille serif (Newsreader)
    expect(texte.classes()).toContain('voix-recit')
  })

  it('renders the template link node as a RouterLink to Sources (la maison de la provenance, #410)', async () => {
    const wrapper = await monter('22001')

    const liens = wrapper
      .findAllComponents(RouterLinkStub)
      .map((l) => l.props('to'))
    expect(liens).toContain('/sources')
    expect(liens).not.toContain('/methodologie#demographie')
  })

  it('changes the reading with the territory — the same template, the row’s own values (vide-meurt)', async () => {
    const wrapper = await monter('29002')

    expect(wrapper.find('.lecture-texte').text()).toContain('se vide et se meurt')
    expect(wrapper.find('.lecture-texte').text()).toContain('-1,04 par an (naturel)')
  })

  it('feeds the reading’s figure (the soldes chart) the two rates, the classification and the same-scale nuage', async () => {
    const wrapper = await monter('22001') // attire-renouvelle, +5,98 / +2,56

    const graphique = wrapper.findComponent(GraphiqueSoldes)
    expect(graphique.exists()).toBe(true)
    expect(graphique.props()).toMatchObject({
      tauxNaturel: 5.982905982905983,
      tauxMigratoire: 2.564102564102564,
      classification: 'attire et se renouvelle',
      nom: 'Commune A1',
    })
    expect(graphique.props('nuage')).toHaveLength(2)
    expect(graphique.props('nuage')).toMatchObject([
      { nom: 'Commune A1', type: 'commune', territoire: '22001' },
      { nom: 'Commune D', type: 'commune', territoire: '22002' },
    ])
  })

  it('names the comparison under the chart — current territory + clickable container', async () => {
    const wrapper = await monter('22001') // commune in EPCI X

    const contexte = wrapper.find('.lecture-contexte')
    expect(contexte.text()).toContain('Commune A1')
    expect(contexte.text()).toContain('des communes de')
    expect(contexte.find('.lecture-conteneur').text()).toBe('EPCI X')
    const lien = wrapper
      .findAllComponents(RouterLinkStub)
      .find((l) => (l.props('to') as { name?: string } | undefined)?.name === 'territoire')
    expect(lien?.props('to')).toEqual({ name: 'territoire', params: { type: 'epci', id: '200000001' } })
  })

  it('cites the exhaustive source from the vintages table', async () => {
    const wrapper = await monter('22001')

    const source = wrapper.find('.lecture-source').text()
    expect(source).toContain('Source')
    expect(source).toContain('Série historique')
    expect(source).toContain('Base des EPCI')
  })
})

describe('OngletTheme — the compact figure and the grid', () => {
  it('renders the compact figure first — the app family + indicator (pyramid/structure_age)', async () => {
    const wrapper = await monter('22001')

    const compacte = wrapper.find('.figure-compacte')
    expect(compacte.exists()).toBe(true)
    expect(compacte.attributes('data-famille')).toBe('pyramid')
    expect(compacte.find('.figure-indicateur').attributes('data-clef')).toBe('structure_age')
    // the compact figure renders once — never twice in the grid
    expect(wrapper.findAll('.figure-indicateur[data-clef="structure_age"]')).toHaveLength(1)
    expect(wrapper.findAll('.figure-indicateur')).toHaveLength(4)
  })
})

describe('OngletTheme — honest edge cases', () => {
  it('renders the subgroup figures but no reading slot when the territory has no story', async () => {
    const wrapper = await monter('22001', [])

    expect(wrapper.findAll('.figure-indicateur')).toHaveLength(4)
    expect(wrapper.find('.sous-groupe-lecture').exists()).toBe(false)
    expect(wrapper.find('.lecture-texte').exists()).toBe(false)
  })

  it('renders the reading for the région, with the whole region’s communes as cloud', async () => {
    const wrapper = await monter('53') // région → all communes in the cloud

    expect(wrapper.findAll('.figure-indicateur').length).toBeGreaterThan(0)
    expect(wrapper.find('.sous-groupe-lecture').exists()).toBe(true)
    const graphique = wrapper.findComponent(GraphiqueSoldes)
    expect(graphique.exists()).toBe(true)
    expect(graphique.props('nuage')).toHaveLength(4)
  })
})
