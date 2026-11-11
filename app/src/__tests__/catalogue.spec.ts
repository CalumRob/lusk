import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import IndicateursView from '../views/IndicateursView.vue'
import {
  creerEtatDecouverteIndicateurs,
  entreesRechercheIndicateurs,
  groupesCatalogue,
} from '../indicateurs/catalogue'
import { CONTENU_CATALOGUE_INDICATEURS } from '../indicateurs/catalogueContent'
import { FAMILLES_FIGURE, THEMES_CANONIQUES } from '../payload/types'
import type { Theme } from '../payload/types'
import type { SemanticResourceDeclaration } from '../payload/semanticResourceClient'
import { rechercherIndicateurs } from '../search/recherche'
import { routes } from '../router'
import { nativeResources } from './helpers/semanticApiFixtures'

const metadataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../pipeline/inst/extdata/theme-metadata')
const ressourcesNatives = nativeResources() as unknown as SemanticResourceDeclaration[]

interface DeclarationPage {
  sources?: string[]
  family?: string
}

interface DeclarationTheme {
  indicator_pages?: Record<string, DeclarationPage>
  source_records?: Record<string, { serving_disposition?: string }>
}

function declarationsProducteur() {
  return THEMES_CANONIQUES.map((theme) => {
    const metadata = JSON.parse(
      readFileSync(resolve(metadataDir, `theme_${theme}.json`), 'utf8'),
    ) as DeclarationTheme
    const pages = Object.entries(metadata.indicator_pages ?? {}).map(([resourceKey, page]) => {
      const sources = page.sources ?? []
      for (const source of sources) {
        expect(metadata.source_records?.[source], `${theme}/${resourceKey}: source record ${source}`).toBeDefined()
      }
      const retired = sources.some(
        (source) => metadata.source_records?.[source]?.serving_disposition === 'excluded_legacy_accessibility',
      )
      return { theme, resourceKey, page, retired }
    })
    return { theme, pages }
  })
}

describe('catalogue des Pages d’indicateur app-owned', () => {
  it('garde l’ordre des thèmes et sous-groupes ayant des pages, puis les pages déclarées dans leur ordre produit', () => {
    const groupes = groupesCatalogue(ressourcesNatives)

    expect(groupes.map(({ theme }) => theme)).toEqual([...THEMES_CANONIQUES])
    expect(groupes[0]?.sousGroupes.map(({ key }) => key)).toEqual([
      'partage-de-lespace-public',
      'motorisation',
      'offre-transports-commun',
    ])
    expect(groupes[0]?.sousGroupes[0]?.entrees.map(({ indicateur }) => indicateur)).toEqual([
      'reseaux',
      'reseaux_par_habitant',
      'surface_reseaux_routiers',
      'places_stationnement_velo_1000',
      'places_stationnement_voiture_1000',
      'stationnement_velo_par_voiture',
      'offre_cyclable',
    ])
    expect(groupes.at(-1)?.sousGroupes.map(({ key }) => key)).toEqual(['subventions'])
  })

  it('porte les libellés éditoriaux et les URL publiques sans rendre les clés brutes', () => {
    const groupes = groupesCatalogue(ressourcesNatives)
    const pages = groupes.flatMap((groupe) =>
      groupe.sousGroupes.flatMap((sousGroupe) => sousGroupe.entrees),
    )
    const densite = pages.find(({ indicateur }) => indicateur === 'densite')!

    expect(groupes[0]?.label).toBe('Mobilité')
    expect(groupes[0]?.sousGroupes[0]?.label).toBe('Le partage de l’espace public')
    expect(densite.label).toBe('Densité de population')
    expect(densite.href).toBe('/indicateurs/demographie/densite')
    expect(pages.every(({ label, indicateur }) => label !== indicateur && !/^[a-z_]+$/.test(label))).toBe(true)
    expect(pages.some(({ href }) => href.endsWith('/raccordement_reference'))).toBe(false)
  })

  it('reprend les libellés natifs des ressources à seuil ou période producteur', () => {
    const pages = groupesCatalogue(ressourcesNatives).flatMap((groupe) =>
      groupe.sousGroupes.flatMap((sousGroupe) => sousGroupe.entrees),
    )

    for (const resourceKey of ['offre_tc', 'raccordement_tc', 'raccordement_courbe', 'evolution_1968']) {
      const declaration = ressourcesNatives.find((resource) => resource.resource_id === resourceKey)!
      expect(pages.find(({ indicateur }) => indicateur === resourceKey)?.label).toBe(declaration.label)
    }
  })

  it('fournit les mêmes libellés, thèmes et ordre à la recherche groupée', () => {
    const attendu = groupesCatalogue(ressourcesNatives).flatMap((groupe) =>
      groupe.sousGroupes.flatMap((sousGroupe) =>
        sousGroupe.entrees.map((entree) => ({
          theme: entree.theme,
          themeLabel: groupe.label,
          label: entree.label,
          href: entree.href,
        })),
      ),
    )

    expect(entreesRechercheIndicateurs(ressourcesNatives)).toEqual(attendu)
    expect(entreesRechercheIndicateurs(ressourcesNatives).map(({ label }) => label)).toContain('Densité de population')
  })

  it('relie les 31 pages éditoriales conservées aux déclarations producteur retenues', () => {
    const declarations = declarationsProducteur()
    const pagesDeclarees = declarations.flatMap(({ pages }) => pages)
    const conservees = pagesDeclarees.filter(({ retired }) => !retired)
    const retirees = pagesDeclarees.filter(({ retired }) => retired)
    const pagesCatalogue = CONTENU_CATALOGUE_INDICATEURS.flatMap((groupe) =>
      groupe.sousGroupes.flatMap((sousGroupe) =>
        sousGroupe.pages.map(({ resourceKey }) => `${groupe.theme}/${resourceKey}`),
      ),
    )
    // #953 publishes these three facts; #954 consumes them in the fiche without
    // adding them to the editorial /indicateurs membership (owner ruling #952 §14.8).
    const declaredSansPageEditoriale = new Set([
      'mobilite/bornes_recharge_1000',
      'mobilite/stations_service',
      'mobilite/stations_service_1000',
    ])

    // Recomputed from canonical declarations via sources -> source_records;
    // editorial labels are deliberately not compared to producer metadata.
    expect(pagesDeclarees).toHaveLength(48)
    expect(retirees).toHaveLength(14)
    expect(conservees).toHaveLength(34)
    expect(pagesCatalogue).toHaveLength(31)
    expect(new Set(pagesCatalogue).size).toBe(pagesCatalogue.length)
    expect(pagesCatalogue.sort()).toEqual(
      conservees
        .map(({ theme, resourceKey }) => `${theme}/${resourceKey}`)
        .filter((key) => !declaredSansPageEditoriale.has(key))
        .sort(),
    )
    for (const key of declaredSansPageEditoriale) {
      expect(pagesCatalogue).not.toContain(key)
      expect(entreesRechercheIndicateurs(ressourcesNatives).some((entry) =>
        `${entry.theme}/${entry.href.split('/').at(-1)}` === key,
      )).toBe(false)
    }

    for (const key of pagesCatalogue) {
      const [theme, resourceKey] = key.split('/') as [Theme, string]
      expect(entreesRechercheIndicateurs(ressourcesNatives).some((entry) =>
        entry.theme === theme && entry.href === `/indicateurs/${theme}/${resourceKey}`,
      )).toBe(true)
    }
  })

  it('garde chaque famille de page producteur dans la grammaire Repères supportée', () => {
    for (const { theme, pages } of declarationsProducteur()) {
      for (const { resourceKey, page } of pages) {
        const family = page.family ?? 'scalar'
        expect(FAMILLES_FIGURE as readonly string[], `${theme}/${resourceKey}`).toContain(family)
      }
    }
  })
})

describe('catalogue et recherche — labels factuels liés à la découverte native', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rend les titres natifs dans le catalogue public sans lire les lignes de faits', async () => {
    const resources = nativeResources().map((resource) => {
      if (resource.resource_id === 'offre_tc') return { ...resource, label: 'Part des bâtiments à moins de 350 m d’un arrêt' }
      if (resource.resource_id === 'evolution_1968') return { ...resource, label: 'Évolution de la population depuis 1975' }
      if (resource.resource_id === 'distribution_dpe') return { ...resource, label: 'Répartition selon la classe énergétique publiée' }
      if (resource.resource_id === 'subventions_annuelles') return { ...resource, label: 'Aides régionales attribuées' }
      return resource
    })
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/resources')
      return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources }))
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs')
    await router.isReady()
    const wrapper = mount(IndicateursView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.find('.catalogue').attributes('aria-busy')).toBe('false')
    const labels = wrapper.findAll('.catalogue-liste a').map((link) => link.text())
    expect(labels).toContain('Part des bâtiments à moins de 350 m d’un arrêt')
    expect(labels).toContain('Évolution de la population depuis 1975')
    expect(labels).toContain('Répartition selon la classe énergétique publiée')
    expect(labels).toContain('Aides régionales attribuées')
    expect(labels).not.toContain('Part des bâtiments près d’un arrêt (à 500 m)')
    expect(labels).not.toContain('Évolution de la population depuis 1968')
    expect(fetcher).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('suit les seuils, périodes, classifications et périmètres actualisés dans la découverte', async () => {
    const labelsModifies: Record<string, string> = {
      densite: 'Libellé natif plus long, sans fait supplémentaire',
      offre_tc: 'Part des bâtiments à moins de 350 m d’un arrêt',
      evolution_1968: 'Évolution de la population depuis 1975',
      distribution_dpe: 'Répartition selon la classe de diagnostic énergétique publiée',
      subventions_annuelles: 'Aides attribuées par la Région aux territoires',
      subventions_par_domaine: 'Aides de la Région ventilées par domaine',
    }
    const resources = nativeResources().map((resource) => ({
      ...resource,
      ...(labelsModifies[resource.resource_id] ? { label: labelsModifies[resource.resource_id] } : {}),
    }))
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/resources')
      return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources }))
    })
    vi.stubGlobal('fetch', fetcher)

    // Discovery only: no observation rows are available to infer these routes or labels.
    const etat = creerEtatDecouverteIndicateurs()
    const [decouvertes, decouvertesPartagees] = await Promise.all([
      etat.charger(), etat.charger(),
    ])
    expect(decouvertesPartagees).toBe(decouvertes)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const groupes = groupesCatalogue(decouvertes)
    const recherche = entreesRechercheIndicateurs(decouvertes)
    const pages = groupes.flatMap((groupe) => groupe.sousGroupes.flatMap((sousGroupe) => sousGroupe.entrees))

    // Theme/subgroup organization and page order remain app-owned; the full
    // native discovery still contains all 34 routes even though it has no facts.
    expect(groupes.map(({ theme }) => theme)).toEqual([...THEMES_CANONIQUES])
    expect(groupes[0]?.sousGroupes.map(({ key }) => key)).toEqual([
      'partage-de-lespace-public', 'motorisation', 'offre-transports-commun',
    ])
    expect(pages).toHaveLength(31)
    expect(pages.find(({ indicateur }) => indicateur === 'densite')?.label).toBe('Densité de population')
    for (const resourceKey of Object.keys(labelsModifies).filter((key) => key !== 'densite')) {
      const label = labelsModifies[resourceKey]
      expect(pages.find(({ indicateur }) => indicateur === resourceKey)?.label).toBe(label)
      expect(recherche.find(({ href }) => href.endsWith(`/${resourceKey}`))?.label).toBe(label)
    }
    expect(rechercherIndicateurs(recherche, '350 m').map(({ label }) => label))
      .toEqual([labelsModifies.offre_tc])
    expect(rechercherIndicateurs(recherche, '1975').map(({ label }) => label))
      .toEqual([labelsModifies.evolution_1968])
    expect(rechercherIndicateurs(recherche, '500 m')).toEqual([])
    expect(rechercherIndicateurs(recherche, '1968')).toEqual([])
  })

  it('ne crée pas de route depuis le seul contenu app si la découverte native retire la ressource', () => {
    const decouvertesSansEvolution = ressourcesNatives.filter((resource) => resource.resource_id !== 'evolution_1968')
    const groupes = groupesCatalogue(decouvertesSansEvolution)
    const trajectoire = groupes.find(({ theme }) => theme === 'demographie')?.sousGroupes
      .find(({ key }) => key === 'trajectoire-demographique')

    expect(trajectoire).toBeDefined()
    expect(trajectoire?.entrees).toEqual([])
    expect(entreesRechercheIndicateurs(decouvertesSansEvolution).some(({ href }) =>
      href.endsWith('/evolution_1968'))).toBe(false)
  })

  it('admits catalogue and search routes only when the native shape matches the app page family', () => {
    const resources = ressourcesNatives.map((resource) => resource.resource_id === 'prix_m2'
      ? { ...resource, shapes: ['scalar'] }
      : resource)
    const pages = groupesCatalogue(resources).flatMap((groupe) =>
      groupe.sousGroupes.flatMap((sousGroupe) => sousGroupe.entrees),
    )
    const recherche = entreesRechercheIndicateurs(resources)

    expect(pages.some(({ href }) => href === '/indicateurs/habitat/prix_m2')).toBe(false)
    expect(recherche.some(({ href }) => href === '/indicateurs/habitat/prix_m2')).toBe(false)
    expect(pages).toHaveLength(30)
    expect(['reseaux', 'structure_age', 'distribution_dpe', 'raccordement_courbe', 'subventions_par_domaine']
      .every((key) => pages.some(({ indicateur }) => indicateur === key))).toBe(true)
  })

  it('keeps catalogue retry focus through pending and failure, then focuses its success status', async () => {
    let rejectRetry!: (error: Error) => void
    let attempts = 0
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/resources')
      attempts += 1
      if (attempts === 1) return Promise.reject(new Error('discovery unavailable'))
      if (attempts === 2) return new Promise<Response>((_resolve, reject) => { rejectRetry = reject })
      return Promise.resolve(new Response(JSON.stringify({
        contract: 'semantic-resource-catalogue-v1', resources: nativeResources(),
      })))
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(IndicateursView, {
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()

    const retry = wrapper.find('.catalogue-retry')
    const retryButton = retry.element as HTMLButtonElement
    retryButton.focus()
    await retry.trigger('click')
    await flushPromises()

    expect(wrapper.find('.catalogue-retry').element).toBe(retryButton)
    expect(document.activeElement).toBe(retryButton)
    expect(retry.attributes('aria-disabled')).toBe('true')
    expect(wrapper.find('.catalogue-etat [role="status"]').text())
      .toContain('Chargement du catalogue')
    expect(wrapper.find('.catalogue').attributes('aria-busy')).toBe('true')

    rejectRetry(new Error('still unavailable'))
    await flushPromises()

    expect(wrapper.find('.catalogue-retry').element).toBe(retryButton)
    expect(document.activeElement).toBe(retryButton)
    expect(wrapper.find('[role="alert"]').text()).toContain('indisponible')
    expect(retry.attributes('aria-disabled')).toBe('false')

    await retry.trigger('click')
    await flushPromises()

    const success = wrapper.find('[data-testid="catalogue-retry-success"]')
    expect(success.text()).toContain('de nouveau disponible')
    expect(success.attributes('role')).toBe('status')
    expect(success.attributes('aria-live')).toBe('polite')
    expect(document.activeElement).toBe(success.element)
    expect(wrapper.findAll('.catalogue-liste a').length).toBeGreaterThan(0)
    expect(fetcher).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })

  it('does not steal focus moved away from catalogue retry before success', async () => {
    let finishRetry!: (response: Response) => void
    let attempts = 0
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/resources')
      attempts += 1
      if (attempts === 1) return Promise.reject(new Error('discovery unavailable'))
      return new Promise<Response>((resolve) => { finishRetry = resolve })
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(IndicateursView, {
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()

    const retry = wrapper.find('.catalogue-retry')
    ;(retry.element as HTMLButtonElement).focus()
    await retry.trigger('click')
    await flushPromises()
    const otherControl = document.createElement('button')
    otherControl.textContent = 'Autre commande'
    document.body.append(otherControl)
    otherControl.focus()

    finishRetry(new Response(JSON.stringify({
      contract: 'semantic-resource-catalogue-v1', resources: nativeResources(),
    })))
    await flushPromises()

    expect(document.activeElement).toBe(otherControl)
    expect(wrapper.find('[data-testid="catalogue-retry-success"]').exists()).toBe(true)
    wrapper.unmount()
    otherControl.remove()
  })
})
