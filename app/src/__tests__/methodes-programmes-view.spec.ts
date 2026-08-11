import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import {
  COUVERTURES_PROGRAMMES,
  LIGNE_JAMAIS_RESULTATS,
  REGLE_BADGE_ORT,
  SOURCES_PROGRAMMES,
  VOCABULAIRE_PROGRAMMES,
} from '../methodes/programmes'
import { ancreSource } from '../methodes/sources'
import {
  apercuAvecNAFixture,
  chargerAvec,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  territoiresFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Payload, Vintage } from '../payload/types'
import { routes } from '../router'
import MethodologieView from '../views/MethodologieView.vue'

/**
 * /methodologie — l'élément « Programmes et subventions » (issue #180,
 * layouts.md §5) dans le shell à deux niveaux (#332) : l'onglet
 * Méthodes · Programmes et subventions (l'éditorial — le vocabulaire des
 * badges, les trois sortes de couverture, la règle du badge ORT, la ligne
 * « jamais les résultats », SANS la table des sources) et l'onglet
 * Sources · Programmes et subventions (la table de ses SIX sources — URL,
 * format, licence, fraîcheur — les faits que le pipeline ingère réellement,
 * jamais inventés). Jamais de bannière de construction (principles.md §1) :
 * la page énonce ce qui est.
 */

const dataDir = join(process.cwd(), '..', 'public', 'data')

function vintagesCommites(): Vintage[] {
  return JSON.parse(readFileSync(join(dataDir, 'vintages.json'), 'utf-8')) as Vintage[]
}

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: null,
  vintages: vintagesCommites(),
  programmes: null,
}

async function monter(chemin: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(MethodologieView, {
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: chargerAvec(payload) },
    },
  })
  await flushPromises()
  return wrapper
}

describe('MethodologieView — Méthodes · Programmes et subventions (l\u2019éditorial)', () => {
  it('rend la section à son ancre #programmes, sans la table des sources', async () => {
    const wrapper = await monter('/methodologie?onglet=methodes&section=programmes')

    expect(wrapper.find('section#programmes').exists()).toBe(true)
    expect(wrapper.find('section#programmes .sources-tableau').exists()).toBe(false)
    expect(wrapper.find('section#programmes-sources').exists()).toBe(false)
  })

  it('porte le titre « Programmes et subventions »', async () => {
    const wrapper = await monter('/methodologie?onglet=methodes&section=programmes')

    expect(wrapper.find('section#programmes h2').text()).toBe('Programmes et subventions')
  })

  it('porte la ligne « adhésion et montants attribués, jamais les résultats »', async () => {
    const wrapper = await monter('/methodologie?onglet=methodes&section=programmes')

    expect(wrapper.find('section#programmes').text()).toContain(LIGNE_JAMAIS_RESULTATS)
  })

  it('documente les trois sortes de couverture, avec leurs sigles', async () => {
    const wrapper = await monter('/methodologie?onglet=methodes&section=programmes')

    const texte = wrapper.find('section#programmes').text()
    for (const couverture of COUVERTURES_PROGRAMMES) {
      expect(texte, `couverture « ${couverture.titre} » absente`).toContain(couverture.titre)
      expect(texte).toContain(couverture.texte)
    }
  })

  it('documente la règle du badge ORT', async () => {
    const wrapper = await monter('/methodologie?onglet=methodes&section=programmes')

    expect(wrapper.find('section#programmes').text()).toContain(REGLE_BADGE_ORT)
  })

  it('affiche le vocabulaire des badges (sigle — nom complet)', async () => {
    const wrapper = await monter('/methodologie?onglet=methodes&section=programmes')

    const texte = wrapper.find('section#programmes').text()
    for (const [sigle, nom] of Object.entries(VOCABULAIRE_PROGRAMMES)) {
      expect(texte, `sigle « ${sigle} » absent`).toContain(sigle)
      expect(texte, `nom « ${nom} » absent`).toContain(nom)
    }
  })

  it('ne rend aucune bannière de construction', async () => {
    const wrapper = await monter('/methodologie?onglet=methodes&section=programmes')

    expect(wrapper.text()).not.toMatch(/à venir|en construction|bientôt|under construction/i)
  })
})

describe('MethodologieView — Sources · Programmes et subventions (la table des six sources)', () => {
  it('rend la table à son ancre #programmes-sources, sans l\u2019éditorial', async () => {
    const wrapper = await monter('/methodologie?onglet=sources&section=programmes')

    expect(wrapper.find('section#programmes-sources').exists()).toBe(true)
    expect(wrapper.find('section#programmes-sources .sources-tableau').exists()).toBe(true)
    expect(wrapper.find('section#programmes').exists()).toBe(false)
  })

  it('liste chaque source du registre avec ses faits (URL, format, licence, fraîcheur)', async () => {
    const wrapper = await monter('/methodologie?onglet=sources&section=programmes')

    expect(wrapper.findAll('section#programmes-sources tbody tr').length).toBe(
      Object.keys(SOURCES_PROGRAMMES).length,
    )
    for (const [id, source] of Object.entries(SOURCES_PROGRAMMES)) {
      const ligne = wrapper.find(`tr#${ancreSource(id)}`)
      expect(ligne.exists(), `ligne « ${id} » introuvable`).toBe(true)
      const texte = ligne.text()
      expect(texte).toContain(source.nom)
      expect(texte).toContain(source.editeur)
      expect(texte).toContain(source.format)
      expect(texte).toContain(source.licence)
      expect(texte).toContain(source.fraicheur)
    }
  })

  it('chaque source rend un lien vers son jeu de données', async () => {
    const wrapper = await monter('/methodologie?onglet=sources&section=programmes')

    for (const [id, source] of Object.entries(SOURCES_PROGRAMMES)) {
      const lien = wrapper.find(`tr#${ancreSource(id)} a.lien-source`)
      expect(lien.exists(), `lien « ${id} » introuvable`).toBe(true)
      expect(lien.attributes('href')).toBe(source.url)
    }
  })

  it('l\u2019ORT rend sa fraîcheur PAR LIGNE, jamais la métadonnée de page périmée', async () => {
    const wrapper = await monter('/methodologie?onglet=sources&section=programmes')

    const ligne = wrapper.find('tr#source-ort')
    expect(ligne.text()).toMatch(/par ligne|actualisation/i)
    expect(ligne.text()).toContain('XLSX')
    // la métadonnée de page (mai 2025, périmée d'environ 15 mois) n'est jamais affichée
    expect(ligne.text()).not.toContain('mai 2025')
  })

  it('la subvention rend sa fraîcheur hebdomadaire', async () => {
    const wrapper = await monter('/methodologie?onglet=sources&section=programmes')

    const ligne = wrapper.find('tr#source-subventions-scdl')
    expect(ligne.text()).toMatch(/semaine|hebdomadaire/i)
  })
})
