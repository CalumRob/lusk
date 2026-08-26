import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import AccueilView from '../views/AccueilView.vue'
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
import type { Payload, RunReport } from '../payload/types'
import { routes } from '../router'

/**
 * L'accueil (#410 — la bascule atomique): the claim → subtitle → the TWO
 * primary calls to action (territory-first via the search, indicator-first
 * via the catalogue) → freshness line → OUTRO (Sources + the thesis teaser).
 * La carte n'est plus proposée : épargnée par ruling mais sans aucun lien.
 * Loading → skeleton; error → icon + message + Retry.
 */

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
}

async function monter(charger: ChargerFichier, options: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(AccueilView, {
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: charger },
      ...options,
    },
  })
  await flushPromises()
  return { router, wrapper }
}

/** Une promesse qui ne se résout jamais — les fichiers encore en vol d'un test progressif (#300). */
const enAttente = new Promise<unknown>(() => {})

/** Résout EXACTEMENT le wait-set de l'accueil (territoires + run-report) ;
 *  tous les autres fichiers restent en vol — la preuve « la page d'abord ». */
const chargerSeulementAttente: ChargerFichier = (fichier) =>
  fichier === 'territoires' || fichier === 'run-report'
    ? chargerAvec(payload)(fichier)
    : enAttente

describe('Accueil — le héros', () => {
  it('porte la signature discrète du mock landing sur le héros', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    const marque = wrapper.find('.accueil-hero .lusk-marque')
    expect(marque.exists()).toBe(true)
    expect(marque.text()).toContain('lusk')
  })

  it('dispose le lock-up dans la colonne de droite du héros (frère du contenu, jamais au-dessus du titre)', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    const interieur = wrapper.find('.accueil-hero-interieur')
    const contenu = wrapper.find('.accueil-hero-contenu')
    const marque = wrapper.find('.accueil-hero-marque')

    expect(interieur.exists()).toBe(true)
    expect(contenu.exists()).toBe(true)
    expect(marque.exists()).toBe(true)
    expect(contenu.element.parentElement).toBe(interieur.element)
    expect(marque.element.parentElement).toBe(interieur.element)
    expect(contenu.element.contains(marque.element)).toBe(false)
  })

  it('place le mot de la signature au-dessus de sa légende', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    const marque = wrapper.find('.accueil-hero-marque')
    const mot = wrapper.find('.lusk-marque__mot')
    const ermine = wrapper.find('.lusk-marque__ermine')
    const legende = wrapper.find('.accueil-marque-caption')
    expect(marque.element.contains(ermine.element)).toBe(true)
    expect(marque.element.contains(mot.element)).toBe(true)
    expect(ermine.element.nextElementSibling).toBe(mot.element)
    expect(mot.element.parentElement?.nextElementSibling).toBe(legende.element)
  })

  it('porte la légende du mot sous la marque — prononciation puis breton · élan, mouvement', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    expect(wrapper.find('.accueil-marque-caption').text()).toBe("/'lysk/ · breton · élan, mouvement")
  })

  it('porte le titre « Intelligence territoriale en Bretagne » — voix produit, jamais la première personne', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    const accroche = wrapper.find('.accueil-accroche').text()
    expect(accroche).toBe('Intelligence territoriale en Bretagne')
    expect(accroche).not.toMatch(/\bJe\b/)
    expect(wrapper.find('.accueil-sous-titre').exists()).toBe(true)
  })

  it('le sous-titre énonce la promesse ET le périmètre (Bretagne, données publiques)', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    const sousTitre = wrapper.find('.accueil-sous-titre').text()
    expect(sousTitre).toContain('intelligence territoriale')
    expect(sousTitre).toContain('Bretagne')
    expect(sousTitre).toContain('données publiques')
  })

  it('propose la recherche globale branchée sur les territoires', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    const input = wrapper.find('input[role="combobox"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('aria-label')).toBe('Rechercher un territoire par son nom')
  })

  it('ne propose AUCUN lien vers /carte — épargnée par ruling, sans lien face-utilisateur (#410)', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    expect(wrapper.find('a[href="/carte"]').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/la carte interactive/i)
  })
})

describe('Accueil — les deux portes d\u2019entrée égales (#410)', () => {
  it('présente exactement deux portes primaires : territoires d\u2019abord, indicateurs à égalité', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    const portes = wrapper.findAll('.accueil-portes .porte')
    expect(portes).toHaveLength(2)
    // La porte territoire porte la recherche (le chemin territory-first)…
    expect(portes[0].find('input[role="combobox"]').exists()).toBe(true)
    // …et la porte indicateurs est le chemin indicator-first, de même poids.
    const porteIndicateurs = wrapper.find('a.porte--indicateurs')
    expect(porteIndicateurs.exists()).toBe(true)
    expect(porteIndicateurs.attributes('href')).toBe('/indicateurs')
    expect(porteIndicateurs.element.parentElement).toBe(
      portes[0].element.parentElement,
    )
  })

  it('nomme les deux chemins avec le vocabulaire du produit', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    const titres = wrapper.findAll('.accueil-portes .porte-titre').map((t) => t.text().trim())
    expect(titres).toEqual(['Territoires', 'Indicateurs'])
  })

  it('mène la porte indicateurs au catalogue avec une action explicite', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    const action = wrapper.find('.porte--indicateurs .porte-action')
    expect(action.exists()).toBe(true)
    expect(action.text()).toMatch(/Explorer les indicateurs/)
  })
})

describe('Accueil — la ligne de fraîcheur', () => {
  it('affiche la fraîcheur calculée depuis le payload (ligneFraicheur)', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    expect(wrapper.text()).toContain('Données actualisées le 3 août 2026')
  })

  it('affiche la promesse honnête statique tant que run-report n\u2019est pas posé', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const { wrapper } = await monter(() => enAttente)

    expect(wrapper.text()).toContain('Données actualisées chaque semaine')
    expect(wrapper.find('.accueil-fraicheur').exists()).toBe(true)
  })

  it('retombe sur la promesse honnête statique en cas d’erreur', async () => {
    const { wrapper } = await monter(async () => {
      throw new Error('panne')
    })

    expect(wrapper.text()).toContain('Données actualisées chaque semaine')
  })
})

describe('Accueil — le carrousel est retiré (#204)', () => {
  it('ne rend plus la « Sélection aléatoire » — ni carrousel, ni tirage au hasard', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    expect(wrapper.find('.accueil-exemples').exists()).toBe(false)
    expect(wrapper.find('.carrousel-carte').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Sélection aléatoire')
  })

  it('garde le héros en bande pleine largeur, distincte de la zone de contenu', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    const hero = wrapper.find('.accueil-hero')
    const interieur = wrapper.find('.accueil-interieur')

    expect(hero.exists()).toBe(true)
    expect(interieur.exists()).toBe(true)

    // Le héros est une bande à part entière (pleine largeur), pas une zone
    // dans la page : la zone de contenu (outro) vit en dessous.
    expect(hero.element.parentElement?.classList.contains('accueil')).toBe(true)
    expect(interieur.element.contains(hero.element)).toBe(false)
  })
})

describe('Accueil — l’outro', () => {
  it('mène le lien de fraîcheur à la page Sources (#410)', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    const lien = wrapper.find('a.accueil-fraicheur')
    expect(lien.exists()).toBe(true)
    expect(lien.attributes('href')).toBe('/sources')
  })

  it('propose le lien Sources — plus de « Sources & Méthodes » (#410)', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    const lien = wrapper.find('a.accueil-sources')
    expect(lien.exists()).toBe(true)
    expect(lien.attributes('href')).toBe('/sources')
    expect(lien.text()).toBe('Sources')
    expect(wrapper.text()).not.toContain('Sources & Méthodes')
  })

  it('porte le teaser de la thèse en serif', async () => {
    const { wrapper } = await monter(chargerAvec(payload))

    expect(wrapper.find('.accueil-teaser').exists()).toBe(true)
  })
})

describe('Accueil — chargement et erreur globaux', () => {
  it('affiche l’erreur typée avec le bouton Réessayer', async () => {
    let appels = 0
    const charger: ChargerFichier = async (fichier) => {
      appels += 1
      if (appels === 1) throw new Error('Impossible de charger /data/territoires.json')
      return chargerAvec(payload)(fichier)
    }
    const { wrapper } = await monter(charger)

    expect(wrapper.text()).toContain('Impossible de charger les données.')
    const bouton = wrapper.find('.bouton-reessayer')
    expect(bouton.text()).toContain('Réessayer')
  })
})

describe('Accueil — chargement prioritaire (#300)', () => {
  it('rend la recherche utilisable dès le wait-set posé — territoires + run-report seulement, le reste en vol', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const router = createRouter({ history: createMemoryHistory(), routes })
      await router.push('/')
      await router.isReady()
      const wrapper = mount(AccueilView, {
        global: {
          plugins: [router],
          provide: { [PAYLOAD_CHARGER_KEY]: chargerSeulementAttente },
        },
      })
      // Sous les faux timers, flushPromises (setTimeout 0) ne se déclenche
      // jamais — on draine les microtâches du magasin à la main.
      await Promise.resolve()
      await nextTick()

      const accueil = wrapper.find('.accueil')
      expect(accueil.attributes('aria-busy')).toBe('false')
      expect(wrapper.find('.global-search__spinner').exists()).toBe(false)

      const input = wrapper.find('input[role="combobox"]')
      expect(input.exists()).toBe(true)
      await input.trigger('focus')
      await input.setValue('epci')
      await nextTick()
      vi.advanceTimersByTime(300)
      await nextTick()

      const options = wrapper.findAll('[role="option"]')
      expect(options).toHaveLength(2)
      expect(options.map((o) => o.text()).some((t) => t.includes('EPCI X'))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rend le héros dès le wait-set posé — les fichiers de fond encore en vol, sans squelette de page', async () => {
    const { wrapper } = await monter(chargerSeulementAttente)

    expect(wrapper.find('.accueil').attributes('aria-busy')).toBe('false')
    expect(wrapper.find('.accueil-accroche').text()).toBe('Intelligence territoriale en Bretagne')
    expect(wrapper.find('.accueil-sous-titre').exists()).toBe(true)
    expect(wrapper.find('.accueil-hero .lusk-marque').exists()).toBe(true)
    expect(wrapper.find('.accueil-erreur').exists()).toBe(false)
  })

  it('affiche la promesse statique tant que run-report n’a pas atterri, puis la ligne réelle', async () => {
    let resoudreRapport: (valeur: RunReport | null) => void = () => {}
    const rapport = new Promise<RunReport | null>((resoudre) => {
      resoudreRapport = resoudre
    })
    const charger: ChargerFichier = (fichier) =>
      fichier === 'run-report' ? rapport : chargerAvec(payload)(fichier)

    const { wrapper } = await monter(charger)

    expect(wrapper.text()).toContain('Données actualisées chaque semaine')

    resoudreRapport(runReportFraisFixture)
    await flushPromises()

    expect(wrapper.text()).toContain('Données actualisées le 3 août 2026')
  })

  it('montre l’erreur typée + Réessayer quand run-report échoue (échec du wait-set), puis récupère', async () => {
    let premierAppel = true
    const charger: ChargerFichier = async (fichier) => {
      if (fichier === 'run-report' && premierAppel) {
        premierAppel = false
        throw new Error('panne run-report')
      }
      return chargerAvec(payload)(fichier)
    }
    const { wrapper } = await monter(charger)

    expect(wrapper.text()).toContain('Impossible de charger les données.')
    expect(wrapper.find('.bouton-reessayer').exists()).toBe(true)

    await wrapper.find('.bouton-reessayer').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Impossible de charger les données.')
    expect(wrapper.text()).toContain('Données actualisées le 3 août 2026')
  })

  it('laisse la page vivante quand un fichier de fond échoue (indicateurs_habitat) — ni erreur, ni squelette', async () => {
    const charger: ChargerFichier = (fichier) => {
      if (fichier === 'indicateurs_habitat') return Promise.reject(new Error('panne habitat'))
      return chargerSeulementAttente(fichier)
    }
    const { wrapper } = await monter(charger)

    expect(wrapper.text()).not.toContain('Impossible de charger les données.')
    expect(wrapper.find('.accueil-erreur').exists()).toBe(false)
    expect(wrapper.find('.accueil-hero').exists()).toBe(true)
    expect(wrapper.find('input[role="combobox"]').exists()).toBe(true)
    expect(wrapper.find('.accueil').attributes('aria-busy')).toBe('false')
  })
})
