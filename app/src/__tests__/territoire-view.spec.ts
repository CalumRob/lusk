import { flushPromises, mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import TerritoireView from '../views/TerritoireView.vue'
import {
  apercuAvecNAFixture,
  chargerAvec,
  histoiresDemographieFixture,
  histoiresHabitatFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { ChargerFichier } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { PayloadError } from '../payload/validate'
import { routes } from '../router'

/**
 * La fiche d'identité — the shell (site-map.md §Fiche): breadcrumb, H1 with
 * the territory's real name (trouverTerritoire), type chip, context
 * switcher, then the payload-driven ThemeTabs with Aperçu as default and the
 * ?theme= URL state, the page bg wearing the selected theme's -wash.
 * Loading → skeleton; PayloadError → icon + message + Retry; unknown
 * territory → honest empty state. C2/C3 slot their content into the Aperçu
 * and theme placeholders.
 */

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
}

const payloadAvecHabitat: Payload = {
  ...payloadDemographie,
  indicateurs: [...indicateursDemographieFixture, ...indicateursHabitatFixture],
  histoires: [...histoiresDemographieFixture, ...histoiresHabitatFixture],
}

async function monter(chemin: string, charger: ChargerFichier) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(TerritoireView, {
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: charger },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

describe('TerritoireView — chargement, erreur, introuvable', () => {
  it('shows a skeleton while the payload loads', async () => {
    const enAttente = new Promise<Payload>(() => {})
    const { wrapper } = await monter('/territoire/commune/29002', () => enAttente)

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.find('.squelette').exists()).toBe(true)
  })

  it('shows the typed error state with a Retry button, never the raw error string', async () => {
    let appels = 0
    const charger: ChargerFichier = async (fichier) => {
      if (fichier !== 'territoires') return chargerAvec(payloadDemographie)(fichier)
      appels += 1
      if (appels === 1) throw new Error('Impossible de charger /data/territoires.json')
      return chargerAvec(payloadDemographie)(fichier)
    }
    const { wrapper } = await monter('/territoire/commune/29002', charger)

    expect(wrapper.find('.etat-erreur').exists()).toBe(true)
    expect(wrapper.text()).toContain('Impossible de charger les données')
    expect(wrapper.text()).not.toContain('/data/territoires.json')
    expect(wrapper.text()).not.toContain('Payload invalide')

    await wrapper.find('.bouton-reessayer').trigger('click')
    await flushPromises()

    expect(wrapper.find('.etat-erreur').exists()).toBe(false)
    expect(wrapper.find('h1').text()).toBe('Commune C')
    expect(appels).toBe(2)
  })

  it('shows the honest empty state for an unknown territory, not a crash', async () => {
    const { wrapper } = await monter('/territoire/commune/99999', chargerAvec(payloadDemographie))

    expect(wrapper.find('.etat-vide').exists()).toBe(true)
    expect(wrapper.text()).toContain('Territoire introuvable.')
    expect(wrapper.find('.etat-vide a[href="/communes"]').exists()).toBe(true)
    expect(wrapper.find('h1').exists()).toBe(false)
  })

  it('treats a route type that does not match the payload as not found', async () => {
    const { wrapper } = await monter('/territoire/epci/22001', chargerAvec(payloadDemographie))

    expect(wrapper.find('.etat-vide').exists()).toBe(true)
  })
})

describe('TerritoireView — l’en-tête de la fiche', () => {
  it('renders the territory’s real name, type chip and breadcrumb', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    const h1 = wrapper.find('.fiche-titre h1')
    expect(h1.text()).toBe('Commune C')
    expect(wrapper.find('.puce-type').text()).toBe('Commune')

    const fil = wrapper.find('.fil-ariane')
    expect(fil.text()).toContain('Accueil')
    expect(fil.text()).not.toContain('Données')
    expect(fil.text()).toContain('Les communes')
    expect(fil.find('a[href="/"]').exists()).toBe(true)
    expect(fil.find('a[href="/communes"]').exists()).toBe(true)
  })

  it('renders the context switcher (commune → EPCI → département → région)', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    const switcher = wrapper.find('.contexte-switcher')
    const liens = switcher.findAll('a').map((l) => l.text())
    expect(liens).toEqual(['EPCI Y', 'Département 29', 'Bretagne'])
    expect(switcher.find('[aria-current="page"]').text()).toBe('Commune C')
  })

  it('groups the type chip and the context switcher into a centered actions row under the title', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    const identite = wrapper.find('.fiche-identite')
    expect(identite.exists()).toBe(true)
    expect(identite.find('.fiche-titre h1').text()).toBe('Commune C')

    const actions = identite.find('.fiche-actions')
    expect(actions.exists()).toBe(true)
    expect(actions.find('.puce-type').text()).toBe('Commune')
    expect(actions.find('.contexte-switcher').exists()).toBe(true)
  })
})

describe('TerritoireView — les onglets (ADR-0007)', () => {
  it('renders only the themes present in the payload, Aperçu first', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual(['Aperçu', 'Démographie'])
  })

  it('renders every payload theme in canonical order when several exist', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadAvecHabitat))

    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual(['Aperçu', 'Démographie', 'Habitat'])
  })

  it('opens on Aperçu by default (absent ?theme=) and renders its content', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    const apercu = wrapper.findAll('[role="tab"]')[0]
    expect(apercu.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-apercu')
    // the Aperçu tab's real content: basic stats + Programmes et subventions
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Population')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Programmes et subventions')
  })

  it('selects the theme from ?theme= and renders its block', async () => {
    const { wrapper } = await monter(
      '/territoire/commune/29002?theme=demographie',
      chargerAvec(payloadDemographie),
    )

    const demographie = wrapper.findAll('[role="tab"]')[1]
    expect(demographie.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-demographie')
    const panneau = wrapper.find('[role="tabpanel"]')
    expect(panneau.text()).toContain('Démographie')
    expect(panneau.text()).toContain('Densité de population')
    // the reading slot renders the metadata template with the row's values (29002 : vide-meurt)
    expect(panneau.text()).toContain('la population de Commune C vide-meurt : -1,04 par an (naturel)')
  })

  it('writes ?theme= into the URL when a theme tab is chosen', async () => {
    const { router, wrapper } = await monter(
      '/territoire/commune/29002',
      chargerAvec(payloadDemographie),
    )

    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.theme).toBe('demographie')
  })

  it('clears ?theme= from the URL when Aperçu is chosen', async () => {
    const { router, wrapper } = await monter(
      '/territoire/commune/29002?theme=demographie',
      chargerAvec(payloadDemographie),
    )

    await wrapper.findAll('[role="tab"]')[0].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')
  })

  it('falls back to Aperçu and cleans the URL for a theme absent from the payload', async () => {
    const { router, wrapper } = await monter(
      '/territoire/commune/29002?theme=habitat',
      chargerAvec(payloadDemographie),
    )

    await flushPromises()
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')
    expect(router.currentRoute.value.query.theme).toBeUndefined()
  })
})

describe('TerritoireView — la coloration de la page (le -wash du thème)', () => {
  it('wears the selected theme’s wash; Aperçu stays on the brand ramp', async () => {
    const { wrapper } = await monter(
      '/territoire/commune/29002?theme=demographie',
      chargerAvec(payloadDemographie),
    )

    expect(wrapper.find('.fiche').classes()).toContain('fiche--theme-demographie')
  })

  it('uses the general (brand) state on Aperçu', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    expect(wrapper.find('.fiche').classes()).toContain('fiche--theme-apercu')
  })
})

describe('TerritoireView — le filigrane de la fiche', () => {
  it('renders the watermark behind the Aperçu tab, accents on the brand anchor', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    const filigrane = wrapper.find('.filigrane-fiche')
    expect(filigrane.exists()).toBe(true)
    expect(filigrane.attributes('aria-hidden')).toBe('true')
    expect(filigrane.attributes('style')).toContain('--filigrane-accent: var(--brand-500)')
  })

  it('wears the theme’s anchor on a theme tab', async () => {
    const { wrapper } = await monter(
      '/territoire/commune/29002?theme=demographie',
      chargerAvec(payloadDemographie),
    )

    const filigrane = wrapper.find('.filigrane-fiche')
    expect(filigrane.attributes('style')).toContain(
      '--filigrane-accent: var(--theme-demographie-line)',
    )
  })

  it('is not rendered when the fiche is missing (empty state)', async () => {
    const { wrapper } = await monter('/territoire/commune/99999', chargerAvec(payloadDemographie))

    expect(wrapper.find('.filigrane-fiche').exists()).toBe(false)
  })
})

describe('TerritoireView — la fiche progressive (le wait-set dérivé de l’URL, PRD #296 / #302)', () => {
  it('rend le header (fil d’ariane, H1, puce-type, contexte) depuis territoires seul, avant la fin du wait-set', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const charger: ChargerFichier = async (fichier) => {
      if (
        fichier === 'apercu' ||
        fichier === 'programmes' ||
        fichier === 'vintages' ||
        fichier.startsWith('indicateurs_') ||
        fichier.startsWith('histoires_')
      ) {
        return enAttente
      }
      return chargerAvec(payloadDemographie)(fichier)
    }
    const { wrapper } = await monter('/territoire/commune/29002', charger)

    // L'identité vit de la référence seule — pas d'attente sur le wait-set.
    expect(wrapper.find('.fiche-chargement').exists()).toBe(false)
    expect(wrapper.find('.fiche-titre h1').text()).toBe('Commune C')
    expect(wrapper.find('.puce-type').text()).toBe('Commune')
    expect(wrapper.find('.contexte-switcher').exists()).toBe(true)
    expect(wrapper.find('.fil-ariane').text()).toContain('Les communes')
    // Le corps, lui, reste honnête : le squelette tant que le wait-set pend.
    expect(wrapper.find('.fiche-chargement-contenu').exists()).toBe(true)
    expect(wrapper.find('[role="tabpanel"]').exists()).toBe(false)
  })

  it('sans ?theme= rend l’onglet Aperçu dès que territoires + apercu + programmes + vintages sont réglés, les paires de thèmes encore pendantes', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const charger: ChargerFichier = async (fichier) => {
      if (fichier.startsWith('indicateurs_') || fichier.startsWith('histoires_')) return enAttente
      return chargerAvec(payloadDemographie)(fichier)
    }
    const { wrapper } = await monter('/territoire/commune/29002', charger)

    // Le wait-set de l'Aperçu est réglé → l'onglet Aperçu rend, sans squelette.
    expect(wrapper.find('.fiche-chargement-contenu').exists()).toBe(false)
    const panneau = wrapper.find('[role="tabpanel"]')
    expect(panneau.attributes('id')).toBe('panneau-apercu')
    expect(panneau.text()).toContain('Population')
    expect(panneau.text()).toContain('Programmes et subventions')
    // Les thèmes pendent encore → aucun onglet de thème (le tab bar honnête).
    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual(['Aperçu'])
  })

  it('avec ?theme=habitat rend le bloc habitat dès que sa paire est réglée, les autres thèmes encore pendants', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const charger: ChargerFichier = async (fichier) => {
      if (
        fichier !== 'territoires' &&
        fichier !== 'run-report' &&
        fichier !== 'indicateurs_habitat' &&
        fichier !== 'histoires_habitat' &&
        fichier !== 'theme_habitat'
      ) {
        return enAttente
      }
      return chargerAvec(payloadAvecHabitat)(fichier)
    }
    const { wrapper } = await monter('/territoire/commune/22001?theme=habitat', charger)

    // Le wait-set du thème demandé est réglé → son bloc rend, les autres pendent.
    expect(wrapper.find('.fiche-chargement-contenu').exists()).toBe(false)
    const panneau = wrapper.find('[role="tabpanel"]')
    expect(panneau.attributes('id')).toBe('panneau-habitat')
    // le bloc est piloté par la métadonnée : l'overline publiée, le sous-groupe
    // et la lecture résolue (jamais une liste d'indicateurs app-side)
    expect(panneau.text()).toContain('Habitat')
    expect(panneau.text()).toContain('L’état du parc')
    expect(panneau.text()).toContain('parc-performant')
    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual(['Aperçu', 'Habitat'])
    expect(wrapper.findAll('[role="tab"]')[1].attributes('aria-selected')).toBe('true')
  })

  it('fait apparaître les onglets de thème progressivement, chacun dès que SA paire atterrit — jamais avant ses données', async () => {
    let resoudreIndicateursDemo: (v: unknown) => void = () => {}
    let resoudreHistoiresDemo: (v: unknown) => void = () => {}
    let resoudreIndicateursHabitat: (v: unknown) => void = () => {}
    let resoudreHistoiresHabitat: (v: unknown) => void = () => {}
    const indicateursDemo = new Promise<unknown>((resoudre) => {
      resoudreIndicateursDemo = resoudre
    })
    const histoiresDemo = new Promise<unknown>((resoudre) => {
      resoudreHistoiresDemo = resoudre
    })
    const indicateursHabitat = new Promise<unknown>((resoudre) => {
      resoudreIndicateursHabitat = resoudre
    })
    const histoiresHabitat = new Promise<unknown>((resoudre) => {
      resoudreHistoiresHabitat = resoudre
    })
    const charger: ChargerFichier = async (fichier) => {
      switch (fichier) {
        case 'indicateurs_demographie':
          return indicateursDemo
        case 'histoires_demographie':
          return histoiresDemo
        case 'indicateurs_habitat':
          return indicateursHabitat
        case 'histoires_habitat':
          return histoiresHabitat
        default:
          return chargerAvec(payloadAvecHabitat)(fichier)
      }
    }
    const { wrapper } = await monter('/territoire/commune/22001', charger)

    // Aucun thème encore → l'Aperçu seul.
    expect(wrapper.findAll('[role="tab"]').map((o) => o.text().trim())).toEqual(['Aperçu'])

    // La paire démographie atterrit → son onglet apparaît, seul.
    resoudreIndicateursDemo(indicateursDemographieFixture)
    resoudreHistoiresDemo(histoiresDemographieFixture)
    await flushPromises()
    expect(wrapper.findAll('[role="tab"]').map((o) => o.text().trim())).toEqual([
      'Aperçu',
      'Démographie',
    ])

    // La paire habitat atterrit → son onglet s'ajoute (l'ordre canonique).
    resoudreIndicateursHabitat(indicateursHabitatFixture)
    resoudreHistoiresHabitat(histoiresHabitatFixture)
    await flushPromises()
    expect(wrapper.findAll('[role="tab"]').map((o) => o.text().trim())).toEqual([
      'Aperçu',
      'Démographie',
      'Habitat',
    ])
  })

  it('une paire de thème d’arrière-plan en échec laisse la fiche vivante — son onglet simplement absent, jamais une erreur de page', async () => {
    const charger: ChargerFichier = async (fichier) => {
      if (fichier === 'indicateurs_habitat' || fichier === 'histoires_habitat') {
        throw new PayloadError('fetch', `${fichier}.json`, 'réseau')
      }
      return chargerAvec(payloadDemographie)(fichier)
    }
    const { wrapper } = await monter('/territoire/commune/29002', charger)

    // La fiche vit : l'Aperçu rend, l'échec d'arrière-plan ne remonte pas.
    expect(wrapper.find('.etat-erreur').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Impossible de charger les données')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Population')
    // L'onglet habitat n'existe tout simplement pas (l'absence honnête).
    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual(['Aperçu', 'Démographie'])
  })

  it('un échec dans le wait-set (la paire du thème demandé) montre l’erreur typée avec Retry, et Retry remet la fiche debout', async () => {
    let habitatEchoue = true
    const charger: ChargerFichier = async (fichier) => {
      if (fichier === 'indicateurs_habitat' && habitatEchoue) {
        habitatEchoue = false
        throw new PayloadError('fetch', 'indicateurs_habitat.json', 'réseau')
      }
      return chargerAvec(payloadAvecHabitat)(fichier)
    }
    const { wrapper } = await monter('/territoire/commune/22001?theme=habitat', charger)

    // Le wait-set du thème demandé a échoué → l'erreur typée + Retry.
    expect(wrapper.find('.etat-erreur').exists()).toBe(true)
    expect(wrapper.text()).toContain('Impossible de charger les données')
    expect(wrapper.text()).not.toContain('indicateurs_habitat.json')

    await wrapper.find('.bouton-reessayer').trigger('click')
    await flushPromises()

    // Retry ne refetch que l'échoué → le bloc habitat demandé rend.
    expect(wrapper.find('.etat-erreur').exists()).toBe(false)
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-habitat')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('L’état du parc')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('parc-performant')
  })

  it('garde l’URL ?theme= demandée quand son wait-set échoue — Retry peut la remettre debout sans normalisation prématurée', async () => {
    const charger: ChargerFichier = async (fichier) => {
      if (fichier === 'indicateurs_habitat') {
        throw new PayloadError('fetch', 'indicateurs_habitat.json', 'réseau')
      }
      return chargerAvec(payloadAvecHabitat)(fichier)
    }
    const { router } = await monter('/territoire/commune/22001?theme=habitat', charger)

    // L'échec n'est pas une absence : l'URL n'est pas réécrite.
    expect(router.currentRoute.value.query.theme).toBe('habitat')
  })

  it('élimine le squelette du corps quand le wait-set se règle, même si des thèmes d’arrière-plan pendent encore (l’Aperçu d’abord)', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const charger: ChargerFichier = async (fichier) => {
      if (fichier.startsWith('indicateurs_') || fichier.startsWith('histoires_')) return enAttente
      return chargerAvec(payloadDemographie)(fichier)
    }
    const { wrapper } = await monter('/territoire/commune/29002', charger)

    expect(wrapper.find('.fiche-chargement-contenu').exists()).toBe(false)
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-apercu')
    expect(wrapper.find('.squelette').exists()).toBe(false)
  })

  it('un thème non canonique demandé retombe sur le set de l’Aperçu et l’URL est nettoyée (la normalisation d’avant, toujours en vie)', async () => {
    const { router, wrapper } = await monter(
      '/territoire/commune/29002?theme=bidule',
      chargerAvec(payloadDemographie),
    )

    await flushPromises()
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')
    expect(router.currentRoute.value.query.theme).toBeUndefined()
  })
})
