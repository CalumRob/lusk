import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import AccueilView from '../views/AccueilView.vue'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { ChargerPayload } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { routes } from '../router'

/**
 * L'accueil — the landing (layouts.md §1 + site-map.md): the claim → subtitle →
 * search → carte link + freshness line → OUTRO (Sources & Méthodes + the
 * thesis teaser). Order rationale: claim → prove → entice → trust. Loading →
 * skeleton; error → icon + message + Retry.
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

async function monter(charger: ChargerPayload, options: Record<string, unknown> = {}) {
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

describe('Accueil — le héros', () => {
  it('porte la signature discrète du mock landing sur le héros', async () => {
    const { wrapper } = await monter(async () => payload)

    const marque = wrapper.find('.accueil-hero .lusk-marque')
    expect(marque.exists()).toBe(true)
    expect(marque.text()).toContain('lusk')
  })

  it('dispose le lock-up dans la colonne de droite du héros (frère du contenu, jamais au-dessus du titre)', async () => {
    const { wrapper } = await monter(async () => payload)

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
    const { wrapper } = await monter(async () => payload)

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
    const { wrapper } = await monter(async () => payload)

    expect(wrapper.find('.accueil-marque-caption').text()).toBe("/'lysk/ · breton · élan, mouvement")
  })

  it('porte le titre « Intelligence territoriale en Bretagne » — voix produit, jamais la première personne', async () => {
    const { wrapper } = await monter(async () => payload)

    const accroche = wrapper.find('.accueil-accroche').text()
    expect(accroche).toBe('Intelligence territoriale en Bretagne')
    expect(accroche).not.toMatch(/\bJe\b/)
    expect(wrapper.find('.accueil-sous-titre').exists()).toBe(true)
  })

  it('le sous-titre énonce la promesse ET le périmètre (Bretagne, données publiques)', async () => {
    const { wrapper } = await monter(async () => payload)

    const sousTitre = wrapper.find('.accueil-sous-titre').text()
    expect(sousTitre).toContain('intelligence territoriale')
    expect(sousTitre).toContain('Bretagne')
    expect(sousTitre).toContain('données publiques')
  })

  it('propose la recherche globale branchée sur les territoires', async () => {
    const { wrapper } = await monter(async () => payload)

    const input = wrapper.find('input[role="combobox"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('aria-label')).toBe('Rechercher un territoire par son nom')
  })

  it('propose le lien vers la carte interactive', async () => {
    const { wrapper } = await monter(async () => payload)

    const lien = wrapper.find('a.accueil-carte')
    expect(lien.exists()).toBe(true)
    expect(lien.attributes('href')).toBe('/carte')
    expect(lien.text()).toMatch(/[Cc]arte/)
  })
})

describe('Accueil — la ligne de fraîcheur', () => {
  it('affiche la fraîcheur calculée depuis le payload (ligneFraicheur)', async () => {
    const { wrapper } = await monter(async () => payload)

    expect(wrapper.text()).toContain('Données actualisées le 3 août 2026')
  })

  it('affiche un squelette pendant le chargement', async () => {
    const enAttente = new Promise<Payload>(() => {})
    const { wrapper } = await monter(() => enAttente)

    expect(wrapper.find('.squelette').exists()).toBe(true)
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
    const { wrapper } = await monter(async () => payload)

    expect(wrapper.find('.accueil-exemples').exists()).toBe(false)
    expect(wrapper.find('.carrousel-carte').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Sélection aléatoire')
  })

  it('garde le héros en bande pleine largeur, distincte de la zone de contenu', async () => {
    const { wrapper } = await monter(async () => payload)

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
  it('propose le lien Sources & Méthodes', async () => {
    const { wrapper } = await monter(async () => payload)

    const lien = wrapper.find('a.accueil-methodes')
    expect(lien.exists()).toBe(true)
    expect(lien.attributes('href')).toBe('/methodologie')
  })

  it('porte le teaser de la thèse en serif', async () => {
    const { wrapper } = await monter(async () => payload)

    expect(wrapper.find('.accueil-teaser').exists()).toBe(true)
  })
})

describe('Accueil — chargement et erreur globaux', () => {
  it('affiche l’erreur typée avec le bouton Réessayer', async () => {
    let appels = 0
    const charger: ChargerPayload = async () => {
      appels += 1
      if (appels === 1) throw new Error('Impossible de charger /data/territoires.json')
      return payload
    }
    const { wrapper } = await monter(charger)

    expect(wrapper.text()).toContain('Impossible de charger les données.')
    const bouton = wrapper.find('.bouton-reessayer')
    expect(bouton.text()).toContain('Réessayer')
  })
})
