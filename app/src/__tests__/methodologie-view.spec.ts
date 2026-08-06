import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  territoiresFixture,
} from '../payload/fixtures'
import type { ChargerPayload } from '../payload/usePayload'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Payload, Vintage } from '../payload/types'
import { routes } from '../router'
import MethodologieView from '../views/MethodologieView.vue'

/**
 * /methodologie — Sources & Méthodes (layouts.md §5, issue #128). L'intro
 * factuelle (ce qu'est Lusk, le pipeline, la reproductibilité) puis la table
 * des sources : une ligne par source du registre, faits de fraîcheur joints en
 * direct depuis vintages.json. Jamais de bannière de construction
 * (principles.md §1) — la page énonce ce qui est, jamais ce qui viendra.
 */

const dataDir = join(process.cwd(), '..', 'public', 'data')

function vintagesCommites(): Vintage[] {
  return JSON.parse(readFileSync(join(dataDir, 'vintages.json'), 'utf-8')) as Vintage[]
}

const payloadAvecVintages: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: null,
  vintages: vintagesCommites(),
}

const payloadSansVintages: Payload = {
  ...payloadAvecVintages,
  vintages: null,
}

async function monter(charger: ChargerPayload, options: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/methodologie')
  await router.isReady()
  const wrapper = mount(MethodologieView, {
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: charger },
      ...options,
    },
  })
  await flushPromises()
  return { router, wrapper }
}

describe('MethodologieView — l\u2019intro factuelle', () => {
  it('renders the page title « Sources & Méthodes »', async () => {
    const { wrapper } = await monter(async () => payloadAvecVintages)

    expect(wrapper.find('h1').text()).toBe('Sources & Méthodes')
  })

  it('énonce ce qu\u2019est Lusk, le pipeline et la reproductibilité — jamais une bannière de construction', async () => {
    const { wrapper } = await monter(async () => payloadAvecVintages)

    const texte = wrapper.text()
    expect(texte).toContain('observatoire ouvert des territoires bretons')
    expect(texte).toContain('données publiques')
    expect(texte).toContain('calculées')
    expect(texte).toContain('reproductible')
    expect(texte).not.toMatch(/à venir|en construction|bientôt|under construction/i)
  })

  it('porte le lien vers le dépôt GitHub (github.com/CalumRob/lusk)', async () => {
    const { wrapper } = await monter(async () => payloadAvecVintages)

    const lien = wrapper.find('a.lien-depot')
    expect(lien.attributes('href')).toBe('https://github.com/CalumRob/lusk')
    expect(lien.attributes('target')).toBe('_blank')
  })
})

describe('MethodologieView — la section « les sources »', () => {
  it('porte l\u2019ancre #sources sur la section', async () => {
    const { wrapper } = await monter(async () => payloadAvecVintages)

    expect(wrapper.find('section#sources').exists()).toBe(true)
  })

  it('liste chaque source du registre avec ses faits éditoriaux et sa fraîcheur en direct', async () => {
    const { wrapper } = await monter(async () => payloadAvecVintages)

    const ligneSerie = wrapper.find('tr#source-serie-historique')
    expect(ligneSerie.exists()).toBe(true)
    expect(ligneSerie.text()).toContain('INSEE — Série historique du recensement')
    expect(ligneSerie.text()).toContain('INSEE')
    expect(ligneSerie.text()).toContain('Démographie')
    expect(ligneSerie.text()).toContain('2023')
    expect(ligneSerie.text()).toContain('Licence Ouverte 2.0')
    expect(ligneSerie.text()).toContain('30 juin 2026')
  })

  it('liste les 35 sources commises (l\u2019union est le contrat)', async () => {
    const { wrapper } = await monter(async () => payloadAvecVintages)

    expect(wrapper.findAll('tbody tr').length).toBe(35)
  })

  it('rend la source mobilite_snapshot avec la licence ODbL, jamais le code brut (issue #151)', async () => {
    const { wrapper } = await monter(async () => payloadAvecVintages)

    const ligne = wrapper.find('tr#source-mobilite-snapshot')
    expect(ligne.exists()).toBe(true)
    expect(ligne.text()).toContain('Licence ODbL — attribution « © OpenStreetMap contributors »')
    expect(ligne.text()).toContain('28 février 2026')
    expect(ligne.text()).toContain('6 août 2026')
    expect(ligne.text()).not.toContain('odbl')
  })

  it('porte une ancre par source, dérivée de son id', async () => {
    const { wrapper } = await monter(async () => payloadAvecVintages)

    expect(wrapper.find('tr#source-dvf-2021-dep22').exists()).toBe(true)
    expect(wrapper.find('tr#source-logements').exists()).toBe(true)
  })

  it('chaque source rend un lien vers son jeu de données', async () => {
    const { wrapper } = await monter(async () => payloadAvecVintages)

    const lienSerie = wrapper.find('tr#source-serie-historique a.lien-source')
    expect(lienSerie.attributes('href')).toBe(
      'https://www.data.gouv.fr/datasets/serie-historique-du-recensement-de-la-population',
    )

    const liens = wrapper.findAll('tbody tr a.lien-source')
    expect(liens.every((l) => l.attributes('href')?.startsWith('https://'))).toBe(true)
  })
})

describe('MethodologieView — la dégradation gracieuse', () => {
  it('vintages.json absent : les faits éditoriaux restent, la fraîcheur rend l\u2019état vide honnête', async () => {
    const { wrapper } = await monter(async () => payloadSansVintages)

    const ligneSerie = wrapper.find('tr#source-serie-historique')
    expect(ligneSerie.exists()).toBe(true)
    expect(ligneSerie.text()).toContain('INSEE — Série historique du recensement')

    const note = wrapper.find('.sources__note-fraicheur')
    expect(note.exists()).toBe(true)
    expect(wrapper.text()).toContain('actualisation des données')
    // La page ne casse jamais : 35 lignes, fraîcheur en tirets
    expect(wrapper.findAll('tbody tr').length).toBe(35)
  })

  it('une source sans ligne vintages en direct rend ses faits éditoriaux, jamais des dates inventées', async () => {
    // vintages commis sans la ligne flores_a38 → la source reste, fraîcheur nulle
    const vintages = vintagesCommites().filter((v) => v.id !== 'flores_a38')
    const { wrapper } = await monter(async () => ({ ...payloadAvecVintages, vintages }))

    const ligneFlores = wrapper.find('tr#source-flores-a38')
    expect(ligneFlores.exists()).toBe(true)
    expect(ligneFlores.text()).toContain('INSEE')
    expect(ligneFlores.text()).toContain('Économie')
    expect(ligneFlores.text()).not.toContain('30 juin 2026')
  })

  it('affiche un squelette pendant le chargement', async () => {
    const enAttente = new Promise<Payload>(() => {})
    const { wrapper } = await monter(() => enAttente)

    expect(wrapper.find('.squelette').exists()).toBe(true)
  })

  it('affiche l\u2019erreur typée avec le bouton Réessayer', async () => {
    const { wrapper } = await monter(async () => {
      throw new Error('panne')
    })

    expect(wrapper.text()).toContain('Impossible de charger les données des sources.')
    expect(wrapper.find('.bouton-reessayer').text()).toContain('Réessayer')
  })
})
