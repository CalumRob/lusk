import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import TerritoireView from '../views/TerritoireView.vue'
import { varianteDeUrl } from '../fiche/prototype/variantes'
import {
  histoiresDemographieFixture,
  histoiresHabitatFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  indicateursProgrammesFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
} from '../payload/fixtures'
import type { Histoire, Indicateur, Theme } from '../payload/types'
import {
  TERRITORY_READ_MODEL_CHARGER_KEY,
  validerModeleTerritoire,
} from '../payload/territoryReadModel'
import type { ChargerModeleTerritoire } from '../payload/territoryReadModel'
import { PayloadError } from '../payload/validate'
import { routes } from '../router'

const indicateurs: Indicateur[] = [
  ...indicateursProgrammesFixture,
  ...indicateursDemographieFixture,
  ...indicateursHabitatFixture,
]
const histoires: Histoire[] = [...histoiresDemographieFixture, ...histoiresHabitatFixture]

const modelePublie22001 = JSON.parse(readFileSync(
  resolve(process.cwd(), '../public/data/modeles-lecture/territoires/commune/22001.json'),
  'utf8',
)) as Record<string, any>

function modeleAvecContextesComparaison() {
  const model = structuredClone(modelePublie22001)
  return validerModeleTerritoire(
    model,
    'territoires/commune/22001.json',
    { type: 'commune', territoire: '22001' },
  )
}

function modelFor(territoire: string) {
  const target = territoiresFixture.find((candidate) => candidate.territoire === territoire)!
  const themes = Object.fromEntries(
    (['programmes', 'demographie', 'habitat'] as Theme[]).map((theme) => [theme, {
      theme,
      indicateurs: indicateurs.filter((row) => row.theme === theme),
      histoires: histoires.filter((row) => row.theme === theme),
      theme_metadata: metadonneesThemesFixtures[theme],
      profils_acces_bpe: null,
      distribution_acces_batiments: null,
      rampe_acces_batiments: null,
    }]),
  )
  return validerModeleTerritoire({
    schema_version: '1',
    snapshot_id: '2026-09-15',
    territory: target,
    territoires: territoiresFixture,
    themes,
  }, `territoires/${target.type}/${territoire}.json`, {
    type: target.type,
    territoire,
  })
}

async function monter(
  chemin: string,
  charger: ChargerModeleTerritoire = vi.fn(async (_type, territoire) => modelFor(territoire)),
) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(TerritoireView, {
    global: {
      plugins: [router],
      provide: { [TERRITORY_READ_MODEL_CHARGER_KEY]: charger },
    },
  })
  await flushPromises()
  return { router, wrapper, charger }
}

describe('TerritoireView — modèle atomique par territoire', () => {
  it('affiche les six onglets pendant que l’unique modèle charge', async () => {
    const charger = vi.fn(() => new Promise<never>(() => {}))
    const { wrapper, router } = await monter('/territoire/commune/29002', charger)

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(6)
    expect(wrapper.find('.squelette').exists()).toBe(true)
    await wrapper.findAll('[role="tab"]')[3]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.theme).toBe('habitat')
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('rend l’identité et le contexte depuis la même réponse', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')

    expect(wrapper.find('.fiche-titre h1').text()).toBe('Commune C')
    expect(wrapper.find('.puce-type').text()).toBe('Commune')
    expect(wrapper.find('.fiche-actions .contexte-switcher').exists()).toBe(true)
    const breadcrumb = wrapper.find('.fil-ariane')
    expect(breadcrumb.text()).toContain('Accueil')
    expect(breadcrumb.text()).toContain('Les communes')
    expect(breadcrumb.find('a[href="/"]').exists()).toBe(true)
    expect(breadcrumb.find('a[href="/communes"]').exists()).toBe(true)
    expect(wrapper.find('.contexte-switcher').text()).toContain('EPCI Y')
    expect(wrapper.find('.contexte-switcher').text()).toContain('Département 29')
    expect(wrapper.find('.contexte-switcher').text()).toContain('Bretagne')
  })

  it('présente toujours les six thèmes dans l’ordre produit', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text().trim())).toEqual([
      'Programmes et subventions',
      'Mobilité',
      'Démographie',
      'Habitat',
      'Économie',
      'Milieux',
    ])
  })

  it('ouvre Programmes et subventions par défaut', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-programmes')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Programmes et subventions')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Programmes et contrats')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Aucun programme référencé.')
  })

  it('sélectionne un thème depuis l’URL sans nouvelle requête', async () => {
    const charger = vi.fn<ChargerModeleTerritoire>(async (_type, territoire) => modelFor(territoire))
    const { wrapper } = await monter('/territoire/commune/29002?theme=demographie', charger)
    expect(wrapper.findAll('[role="tab"]')[2]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-demographie')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Densité de population')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain(
      'la population de Commune C se vide et se meurt : -1,04 par an (naturel)',
    )
    expect(wrapper.find('.fiche').classes()).toContain('fiche--theme-demographie')
    expect(wrapper.find('.filigrane-fiche').attributes('style')).toContain(
      '--filigrane-accent: var(--theme-demographie-line)',
    )
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('change d’onglet sans recharger le modèle', async () => {
    const charger = vi.fn<ChargerModeleTerritoire>(async (_type, territoire) => modelFor(territoire))
    const { wrapper, router } = await monter('/territoire/commune/29002', charger)
    await wrapper.findAll('[role="tab"]')[3]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.theme).toBe('habitat')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-habitat')
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('normalise un thème inconnu vers le défaut', async () => {
    const { wrapper, router } = await monter('/territoire/commune/29002?theme=bidule')
    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true')
  })

  it('canonicalise un mode de comparaison inconnu sans perdre le thème ni la variante', async () => {
    const { router } = await monter(
      '/territoire/commune/29002?theme=mobilite&comparaison=inconnu&variant=E',
    )
    expect(router.currentRoute.value.query).toEqual({ theme: 'mobilite', variant: 'E' })
  })

  it.each(['densite', 'epci', 'bretagne'] as const)(
    'applique le contexte %s à la fiche rendue', async (mode) => {
    const label = modeleAvecContextesComparaison().themes.mobilite?.comparisons[mode]?.scope.label
    const varianteE = varianteDeUrl('E')
    expect(varianteE?.clef).toBe('E')
    await (varianteE?.composant as any).__asyncLoader?.()
    const charger = vi.fn(async () => modeleAvecContextesComparaison())
    const { router, wrapper } = await monter(
      `/territoire/commune/22001?theme=mobilite&variant=E&comparaison=${mode}`,
      charger,
    )

    expect(router.currentRoute.value.query.comparaison).toBe(mode)
    await flushPromises()
    expect(wrapper.find('.cahier-comparison-note').text()).toContain(label)
    wrapper.unmount()
  })

  it('expose le contexte sélectionné comme une divulgation synchronisable', async () => {
    const charger = vi.fn(async () => modeleAvecContextesComparaison())
    const { router, wrapper } = await monter(
      '/territoire/commune/22001?theme=mobilite&variant=E&comparaison=densite',
      charger,
    )

    const selector = wrapper.get('.cahier-comparison-note')
    const trigger = selector.get('button[aria-haspopup="listbox"]')

    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.attributes('aria-current')).toBe('true')
    const contexts = modeleAvecContextesComparaison().themes.mobilite!.comparisons
    expect(trigger.text()).toContain(contexts.densite!.scope.label)
    expect(selector.get('.cahier-comparison-note__scope').text()).toBe(contexts.densite!.scope.label)
    expect(selector.get('.cahier-comparison-note__arrow').text()).toBe('←')
    expect(selector.get('.cahier-comparison-note__arrow').classes()).not.toContain('is-open')

    await trigger.trigger('click')

    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(selector.get('.cahier-comparison-note__arrow').classes()).toContain('is-open')
    const options = selector.findAll('[role="option"][aria-selected="false"]')
    expect(options.map((option) => option.text())).toEqual([
      contexts.epci!.scope.label,
      contexts.bretagne!.scope.label,
    ])
    expect(options[0]!.attributes('title')).toBeUndefined()

    await selector
      .get('[role="option"][aria-selected="false"]')
      .trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.comparaison).toBe('epci')
    expect(wrapper.get('.cahier-comparison-note button').text()).toContain(
      contexts.epci!.scope.label,
    )
    const comparisonNotes = wrapper.findAll('.cahier-comparison-note')
    expect(comparisonNotes.length).toBeGreaterThan(5)
    expect(comparisonNotes.every((note) => note.find('button[aria-haspopup="listbox"]').exists())).toBe(true)
    wrapper.unmount()
  })

  it('ne branche pas le sélecteur de comparaison sur la variante D', async () => {
    const varianteD = varianteDeUrl('D')
    expect(varianteD?.clef).toBe('D')
    await (varianteD?.composant as any).__asyncLoader?.()
    const charger = vi.fn(async () => modeleAvecContextesComparaison())
    const { wrapper } = await monter(
      '/territoire/commune/22001?theme=mobilite&variant=D&comparaison=epci',
      charger,
    )

    await flushPromises()
    const comparisonNotes = wrapper.findAll('.cahier-comparison-note')
    expect(comparisonNotes.length).toBeGreaterThan(0)
    expect(comparisonNotes.every((note) => !note.find('button[aria-haspopup="listbox"]').exists())).toBe(true)
    wrapper.unmount()
  })

  it('permet de changer de contexte au clavier et expose l’aide de la densité', async () => {
    const charger = vi.fn(async () => modeleAvecContextesComparaison())
    const { router, wrapper } = await monter(
      '/territoire/commune/22001?theme=mobilite&variant=E&comparaison=epci',
      charger,
    )

    const selector = wrapper.get('.cahier-comparison-note')
    const trigger = selector.get('button[aria-haspopup="listbox"]')
    await trigger.trigger('keydown', { key: 'Enter' })

    expect(trigger.attributes('aria-expanded')).toBe('true')
    const densityLabel = modeleAvecContextesComparaison().themes.mobilite!.comparisons.densite!.scope.label
    const density = selector.findAll('[role="option"][aria-selected="false"]').find((option) => option.find('.cahier-comparison-note__option-label').text() === densityLabel)
    expect(density).toBeDefined()
    expect(density!.attributes('title')).toBe(
      'Classe définie par l’Insee selon le nombre d’habitants et leur concentration sur le territoire communal.',
    )
    const descriptionId = density!.attributes('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(selector.get(`#${descriptionId}`).text()).toContain('Classe définie par l’Insee')

    await density!.trigger('focus')
    await density!.trigger('keydown', { key: 'Escape' })
    expect(trigger.attributes('aria-expanded')).toBe('false')

    await trigger.trigger('keydown', { key: 'Enter' })
    const reopenedDensity = selector.findAll('[role="option"][aria-selected="false"]').find((option) => option.find('.cahier-comparison-note__option-label').text() === densityLabel)
    expect(reopenedDensity).toBeDefined()
    await reopenedDensity!.trigger('focus')
    await reopenedDensity!.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(router.currentRoute.value.query.comparaison).toBe('densite')
    wrapper.unmount()
  })

  it('affiche l’erreur typée et réessaie le même endpoint', async () => {
    const charger = vi
      .fn()
      .mockRejectedValueOnce(new PayloadError('fetch', 'territoires/commune/29002.json', 'panne'))
      .mockResolvedValueOnce(modelFor('29002'))
    const { wrapper } = await monter('/territoire/commune/29002', charger)

    expect(wrapper.find('.etat-erreur').exists()).toBe(true)
    expect(wrapper.text()).toContain('Impossible de charger les données')
    expect(wrapper.text()).not.toContain('territoires/commune/29002.json')
    expect(wrapper.text()).not.toContain('panne')
    await wrapper.get('.bouton-reessayer').trigger('click')
    await flushPromises()
    expect(wrapper.find('.etat-erreur').exists()).toBe(false)
    expect(wrapper.find('.fiche-titre h1').text()).toBe('Commune C')
    expect(charger).toHaveBeenCalledTimes(2)
  })
})
