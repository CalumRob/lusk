import { flushPromises, mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import ListeTerritoires from '../components/ListeTerritoires.vue'
import type { ConfigListe } from '../listes/listes'
import type { Fichier } from '../payload/loader'
import {
  apercuAvecNAFixture,
  chargerAvec,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { ChargerFichier } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { routes } from '../router'

/**
 * ListeTerritoires — the shared data-list view (layouts.md §4, ui-elements.md
 * §Table): breadcrumb + H1, name search, département chips and the EPCI
 * filter (URL query, shareable), a sortable table (aria-sort) with
 * nom | code | EPCI | actions, mobile cards below 768px, honest empty/loading/
 * error states. Each row is a link directory entry: its fiche plus the map.
 * Filters live in the URL (shareable); the search box is local state.
 */

const configCommunes: ConfigListe = {
  type: 'commune',
  titre: 'Les communes',
  placeholderRecherche: 'Rechercher une commune',
  colonnes: [
    { cle: 'nom', libelle: 'Nom', triable: true },
    { cle: 'code', libelle: 'Code', triable: true },
    { cle: 'epci', libelle: 'EPCI', triable: true },
  ],
  libelleVide: 'Aucune commune.',
  filtreDepartement: true,
  filtreEpci: true,
}

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
}

async function monter(chemin: string, charger: ChargerFichier, config = configCommunes) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(ListeTerritoires, {
    props: { config },
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: charger },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

const nomsLignes = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('tbody tr .cellule-nom a').map((a) => a.text())

describe('ListeTerritoires — chargement, erreur, vide', () => {
  it('shows a skeleton while the payload loads', async () => {
    const enAttente = new Promise<Payload>(() => {})
    const { wrapper } = await monter('/communes', () => enAttente)

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.find('.squelette').exists()).toBe(true)
  })

  it('shows the typed error state with a Retry button, never the raw error string', async () => {
    const demandes: Fichier[] = []
    let territoiresEchoue = true
    const charger: ChargerFichier = async (fichier) => {
      demandes.push(fichier)
      if (fichier !== 'territoires') return chargerAvec(payloadDemographie)(fichier)
      if (territoiresEchoue) {
        territoiresEchoue = false
        throw new Error('Impossible de charger /data/territoires.json')
      }
      return chargerAvec(payloadDemographie)(fichier)
    }
    const { wrapper } = await monter('/communes', charger)

    expect(wrapper.find('.etat-erreur').exists()).toBe(true)
    expect(wrapper.text()).toContain('Impossible de charger les données')
    expect(wrapper.text()).not.toContain('/data/territoires.json')

    await wrapper.find('.bouton-reessayer').trigger('click')
    await flushPromises()

    expect(wrapper.find('.etat-erreur').exists()).toBe(false)
    expect(wrapper.find('tbody tr').exists()).toBe(true)
    // Le retry ne refetch que le fichier échoué — jamais le reste du set.
    expect(demandes.filter((f) => f === 'territoires')).toHaveLength(2)
    const autres = new Map<string, number>()
    for (const f of demandes) {
      if (f !== 'territoires') autres.set(f, (autres.get(f) ?? 0) + 1)
    }
    for (const compte of autres.values()) expect(compte).toBe(1)
  })

  it('shows the honest empty state with a hint when a filter/search empties the list', async () => {
    const { wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    await wrapper.find('input[type="search"]').setValue('zzz')

    expect(wrapper.find('.etat-vide').exists()).toBe(true)
    expect(wrapper.text()).toContain('Aucune commune.')
    expect(wrapper.text()).toContain('Élargissez votre recherche ou retirez les filtres.')
    expect(wrapper.find('tbody').exists()).toBe(false)
  })
})

describe('ListeTerritoires — la page d’abord (le wait-set de référence)', () => {
  it('renders fully from territoires alone — les autres fichiers ne résolvent jamais', async () => {
    const jamais = new Promise<unknown>(() => {})
    const charger: ChargerFichier = async (fichier) =>
      fichier === 'territoires' ? chargerAvec(payloadDemographie)(fichier) : jamais
    const { wrapper } = await monter('/communes', charger)

    // Aucun squelette, aucune erreur — la page est vivante de la table seule.
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('.etat-erreur').exists()).toBe(false)
    expect(nomsLignes(wrapper)).toEqual(['Commune A1', 'Commune B', 'Commune C', 'Commune D'])
    expect(wrapper.find('tbody tr .cellule-epci').text()).toBe('EPCI X')

    // Les puces et les options du filtre EPCI dérivent de la table seule.
    expect(wrapper.findAll('.puce').map((p) => p.text())).toEqual(['22', '29'])
    expect(wrapper.findAll('.filtre-epci-select option').map((o) => o.text())).toEqual([
      'Tous les EPCI',
      'EPCI X',
      'EPCI Y',
    ])

    // Le filtre département et la recherche fonctionnent sans le reste du payload.
    await wrapper.findAll('.puce')[1].trigger('click')
    await flushPromises()
    expect(nomsLignes(wrapper)).toEqual(['Commune B', 'Commune C'])

    await wrapper.findAll('.puce')[1].trigger('click')
    await flushPromises()
    await wrapper.find('input[type="search"]').setValue('commune a')
    expect(nomsLignes(wrapper)).toEqual(['Commune A1'])
  })
})

describe('ListeTerritoires — l’en-tête', () => {
  it('renders the breadcrumb Accueil / Les communes and the H1', async () => {
    const { wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    const fil = wrapper.find('.fil-ariane')
    expect(fil.text()).toContain('Accueil')
    expect(fil.text()).not.toContain('Données')
    expect(fil.text()).toContain('Les communes')
    expect(fil.find('a[href="/"]').exists()).toBe(true)
    expect(wrapper.find('h1').text()).toBe('Les communes')
  })

  it('keeps the actions layout inside table cells', async () => {
    const { wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    expect(wrapper.find('thead .colonne-actions').element.tagName).toBe('TH')
    expect(wrapper.find('tbody .colonne-actions-contenu').exists()).toBe(true)
  })
})

describe('ListeTerritoires — le tableau triable', () => {
  it('sorts by name by default and marks the Nom column ascending', async () => {
    const { wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    expect(nomsLignes(wrapper)).toEqual(['Commune A1', 'Commune B', 'Commune C', 'Commune D'])

    const tds = wrapper.findAll('thead th')
    expect(tds[0].attributes('aria-sort')).toBe('ascending')
    expect(tds[1].attributes('aria-sort')).toBe('none')
    expect(tds[2].attributes('aria-sort')).toBe('none')
  })

  it('sorts by code when its header is clicked, with aria-sort updated', async () => {
    const { wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    await wrapper.findAll('thead th button')[1].trigger('click')

    // code order: 22001, 22002, 29001, 29002
    expect(wrapper.findAll('tbody tr .cellule-code').map((c) => c.text())).toEqual([
      '22001',
      '22002',
      '29001',
      '29002',
    ])
    const tds = wrapper.findAll('thead th')
    expect(tds[0].attributes('aria-sort')).toBe('none')
    expect(tds[1].attributes('aria-sort')).toBe('ascending')
  })

  it('toggles the direction on a second click of the same column', async () => {
    const { wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    await wrapper.findAll('thead th button')[1].trigger('click')
    await wrapper.findAll('thead th button')[1].trigger('click')

    expect(wrapper.findAll('tbody tr .cellule-code').map((c) => c.text())).toEqual([
      '29002',
      '29001',
      '22002',
      '22001',
    ])
    expect(wrapper.findAll('thead th')[1].attributes('aria-sort')).toBe('descending')
  })

  it('sorts by the EPCI column using the resolved EPCI name', async () => {
    const { wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    await wrapper.findAll('thead th button')[2].trigger('click')

    // EPCI X (22001, 22002) sorts before EPCI Y (29001, 29002)
    expect(wrapper.findAll('tbody tr .cellule-code').map((c) => c.text())).toEqual([
      '22001',
      '22002',
      '29001',
      '29002',
    ])
  })

  it('renders the resolved EPCI name in the EPCI column, never the SIREN', async () => {
    const { wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    // default sort by name: Commune A1 (EPCI X), Commune B (EPCI Y)…
    const premieresEpci = wrapper
      .findAll('tbody tr .cellule-epci')
      .slice(0, 2)
      .map((c) => c.text())
    expect(premieresEpci).toEqual(['EPCI X', 'EPCI Y'])
  })

  it('renders the row action: the fiche link — plus aucun lien vers /carte (#410)', async () => {
    const { wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    const premiereLigne = wrapper.find('tbody tr')
    expect(premiereLigne.find('.cellule-nom a').attributes('href')).toBe(
      '/territoire/commune/22001',
    )
    const actions = premiereLigne.findAll('.colonne-actions a')
    expect(actions).toHaveLength(1)
    expect(actions[0].text()).toBe('Voir la fiche')
    expect(actions[0].attributes('href')).toBe('/territoire/commune/22001')
  })
})

describe('ListeTerritoires — la recherche', () => {
  it('filters by name, accent-insensitively', async () => {
    const { wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    await wrapper.find('input[type="search"]').setValue('commune b')

    expect(nomsLignes(wrapper)).toEqual(['Commune B'])
  })
})

describe('ListeTerritoires — les puces département (URL partagé)', () => {
  it('renders the département chips from the rows, unpressed by default', async () => {
    const { wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    const puces = wrapper.findAll('.puce')
    expect(puces.map((p) => p.text())).toEqual(['22', '29'])
    for (const puce of puces) expect(puce.attributes('aria-pressed')).toBe('false')
  })

  it('filters by département, writes ?departement= to the URL and presses the chip', async () => {
    const { router, wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    await wrapper.findAll('.puce')[1].trigger('click')
    await flushPromises()

    expect(nomsLignes(wrapper)).toEqual(['Commune B', 'Commune C'])
    expect(router.currentRoute.value.query.departement).toBe('29')
    expect(wrapper.findAll('.puce')[1].attributes('aria-pressed')).toBe('true')
  })

  it('toggles the chip off and clears the URL', async () => {
    const { router, wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    await wrapper.findAll('.puce')[1].trigger('click')
    await wrapper.findAll('.puce')[1].trigger('click')

    expect(nomsLignes(wrapper)).toEqual(['Commune A1', 'Commune B', 'Commune C', 'Commune D'])
    expect(router.currentRoute.value.query.departement).toBeUndefined()
  })

  it('reads a shareable ?departement= from the URL on mount', async () => {
    const { wrapper } = await monter(
      '/communes?departement=29',
      chargerAvec(payloadDemographie),
    )

    expect(nomsLignes(wrapper)).toEqual(['Commune B', 'Commune C'])
    expect(wrapper.findAll('.puce')[1].attributes('aria-pressed')).toBe('true')
  })
})

describe('ListeTerritoires — le filtre EPCI (URL partagé)', () => {
  it('lists the EPCIs by name, with an all-EPCIs option', async () => {
    const { wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    const options = wrapper.findAll('.filtre-epci-select option')
    expect(options.map((o) => o.text())).toEqual(['Tous les EPCI', 'EPCI X', 'EPCI Y'])
  })

  it('filters by EPCI and writes ?epci= to the URL', async () => {
    const { router, wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    await wrapper.find('.filtre-epci-select').setValue('200000002')
    await flushPromises()

    expect(nomsLignes(wrapper)).toEqual(['Commune B', 'Commune C'])
    expect(router.currentRoute.value.query.epci).toBe('200000002')
  })

  it('restricts the EPCI options to the selected département', async () => {
    const { wrapper } = await monter(
      '/communes?departement=22',
      chargerAvec(payloadDemographie),
    )

    const options = wrapper.findAll('.filtre-epci-select option')
    expect(options.map((o) => o.text())).toEqual(['Tous les EPCI', 'EPCI X'])
  })

  it('drops an EPCI filter that the new département cannot contain', async () => {
    const { router, wrapper } = await monter(
      '/communes?epci=200000002',
      chargerAvec(payloadDemographie),
    )

    await wrapper.findAll('.puce')[0].trigger('click') // département 22
    await flushPromises()

    expect(router.currentRoute.value.query.departement).toBe('22')
    expect(router.currentRoute.value.query.epci).toBeUndefined()
    expect(nomsLignes(wrapper)).toEqual(['Commune A1', 'Commune D'])
  })
})

describe('ListeTerritoires — les cartes mobiles', () => {
  it('renders the same rows as stacked cards, each linking to its fiche', async () => {
    const { wrapper } = await monter('/communes', chargerAvec(payloadDemographie))

    const cartes = wrapper.findAll('.liste-cartes li')
    expect(cartes).toHaveLength(4)
    expect(cartes[0].find('.carte-nom').text()).toBe('Commune A1')
    expect(cartes[0].find('.carte-code').text()).toBe('22001')
    expect(cartes[0].find('.carte-epci').text()).toBe('EPCI X')
    expect(cartes[0].find('a[href="/territoire/commune/22001"]').exists()).toBe(true)
    expect(cartes[0].find('a[href="/carte"]').exists()).toBe(false)
  })

  it('filters the cards exactly like the table', async () => {
    const { wrapper } = await monter(
      '/communes?departement=29',
      chargerAvec(payloadDemographie),
    )

    expect(wrapper.findAll('.liste-cartes li')).toHaveLength(2)
  })
})
