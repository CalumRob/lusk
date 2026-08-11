import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { THEMES_CONSTRUITS } from '../methodes/indicateurs'
import {
  apercuAvecNAFixture,
  chargerAvec,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  territoiresFixture,
} from '../payload/fixtures'
import type { ChargerFichier } from '../payload/usePayload'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Payload, Vintage } from '../payload/types'
import { routes } from '../router'
import MethodologieView from '../views/MethodologieView.vue'

/**
 * /methodologie — Sources & Méthodes (layouts.md §5, issue #128). L'intro
 * factuelle (ce qu'est Lusk, le pipeline, la reproductibilité) puis le shell
 * à onglets (#332) : Sources | Indicateurs | Programmes — la table des
 * sources dans son onglet (une ligne par source du registre, faits de
 * fraîcheur joints en direct depuis vintages.json). Jamais de bannière de
 * construction (principles.md §1) — la page énonce ce qui est, jamais ce qui
 * viendra.
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
  programmes: null,
}

const payloadSansVintages: Payload = {
  ...payloadAvecVintages,
  vintages: null,
  programmes: null,
}

async function monter(charger: ChargerFichier, options: { chemin?: string } = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(options.chemin ?? '/methodologie')
  await router.isReady()
  const wrapper = mount(MethodologieView, {
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: charger },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

describe('MethodologieView — l\u2019intro factuelle', () => {
  it('renders the page title « Sources & Méthodes »', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    expect(wrapper.find('h1').text()).toBe('Sources & Méthodes')
  })

  it('énonce ce qu\u2019est Lusk, le pipeline et la reproductibilité — jamais une bannière de construction', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    const texte = wrapper.text()
    expect(texte).toContain('observatoire ouvert des territoires bretons')
    expect(texte).toContain('données publiques')
    expect(texte).toContain('calculées')
    expect(texte).toContain('reproductible')
    expect(texte).not.toMatch(/à venir|en construction|bientôt|under construction/i)
  })

  it('porte le lien vers le dépôt GitHub (github.com/CalumRob/lusk)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    const lien = wrapper.find('a.lien-depot')
    expect(lien.attributes('href')).toBe('https://github.com/CalumRob/lusk')
    expect(lien.attributes('target')).toBe('_blank')
  })
})

describe('MethodologieView — la section « les sources »', () => {
  it('porte l\u2019ancre #sources sur la section', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    expect(wrapper.find('section#sources').exists()).toBe(true)
  })

  it('liste chaque source du registre avec ses faits éditoriaux et sa fraîcheur en direct', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    const ligneSerie = wrapper.find('tr#source-serie-historique')
    expect(ligneSerie.exists()).toBe(true)
    expect(ligneSerie.text()).toContain('INSEE — Série historique du recensement')
    expect(ligneSerie.text()).toContain('INSEE')
    expect(ligneSerie.text()).toContain('Démographie')
    expect(ligneSerie.text()).toContain('2023')
    expect(ligneSerie.text()).toContain('Licence Ouverte 2.0')
    expect(ligneSerie.text()).toContain('30 juin 2026')
  })

  it('liste les 56 sources commises (l\u2019union est le contrat)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    // Le comptage est borné à la table de la section #sources - la page porte
    // aussi la table des sources de l'élément Programmes & financements (6
    // lignes, issue #180) : les deux registres sont documentés séparément.
    // 56 depuis l'issue #243 : les HUIT archives OCS-GE millésimées remplacent
    // les quatre différentielles (49 + 8 − 4) + les TROIS patchs correctifs M2 —
    // l'union est le contrat.
    expect(wrapper.findAll('section#sources tbody tr').length).toBe(56)
  })

  it('rend la source CONSOENAF avec son URL, ses dates, sa licence et l\u2019anomalie d\u2019unité (issue #177)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    const ligne = wrapper.find('tr#source-consoenaf')
    expect(ligne.exists()).toBe(true)
    expect(ligne.text()).toContain('Cerema')
    expect(ligne.text()).toContain('CONSOENAF')
    // l'anomalie d'unité documentée dans le libellé — le dictionnaire dit
    // hectares, le fichier distribue des m², la conversion est explicite
    expect(ligne.text()).toMatch(/mètres carrés|m²/)
    // les faits de fraîcheur en direct depuis la table vintages
    expect(ligne.text()).toContain('Licence Ouverte 2.0')
    expect(ligne.text()).toContain('1 janvier 2025')
    expect(ligne.text()).toContain('24 juillet 2026')
    const lien = ligne.find('a.lien-source')
    expect(lien.attributes('href')).toBe(
      'https://www.data.gouv.fr/datasets/consommation-despaces-naturels-agricoles-et-forestiers-du-1er-janvier-2011-au-1er-janvier-2025',
    )
  })

  it('rend la source mobilite_snapshot avec la licence ODbL, jamais le code brut (issue #151)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    const ligne = wrapper.find('tr#source-mobilite-snapshot')
    expect(ligne.exists()).toBe(true)
    expect(ligne.text()).toContain('ODbL — © OpenStreetMap contributors')
    expect(ligne.text()).toContain('28 février 2026')
    expect(ligne.text()).toContain('6 août 2026')
    expect(ligne.text()).not.toContain('odbl')
  })

  it('rend l\u2019attribution ODbL pour les trois sources concernées (OSM · Korrigo · stationnement vélo, ADR-0001)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    for (const id of ['osm-reseaux', 'korrigo', 'stationnement-velo']) {
      const ligne = wrapper.find(`tr#source-${id}`)
      expect(ligne.exists(), `ligne « ${id} » introuvable`).toBe(true)
      expect(ligne.text()).toContain('ODbL — © OpenStreetMap contributors')
      expect(ligne.text()).not.toContain('odbl')
    }
  })

  it('la cellule licence se plie (classe dédiée) — version/date gardent le traitement tabulaire one-line (issue #331)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    const ligne = wrapper.find('tr#source-mobilite-snapshot')
    const celluleLicence = ligne.find('td[data-label="Licence"]')
    expect(celluleLicence.classes()).toContain('cellule-licence')
    expect(celluleLicence.classes()).not.toContain('cellule-fraicheur')

    // version + dates gardent le traitement one-line (nowrap + tabular-nums)
    for (const libelle of ['Version', 'Date de référence', 'Date de publication']) {
      const cellule = ligne.find(`td[data-label="${libelle}"]`)
      expect(cellule.classes(), `cellule « ${libelle} »`).toContain('cellule-fraicheur')
    }
  })

  it('porte une ancre par source, dérivée de son id', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    expect(wrapper.find('tr#source-dvf-2021-dep22').exists()).toBe(true)
    expect(wrapper.find('tr#source-logements').exists()).toBe(true)
  })

  it('chaque source rend un lien vers son jeu de données', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

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
    const { wrapper } = await monter(chargerAvec(payloadSansVintages))

    const ligneSerie = wrapper.find('tr#source-serie-historique')
    expect(ligneSerie.exists()).toBe(true)
    expect(ligneSerie.text()).toContain('INSEE — Série historique du recensement')

    const note = wrapper.find('.sources__note-fraicheur')
    expect(note.exists()).toBe(true)
    expect(wrapper.text()).toContain('actualisation des données')
    // La page ne casse jamais : 56 lignes dans la table des sources, fraîcheur
    // en tirets (les HUIT archives OCS-GE millésimées #243 remplacent les
    // quatre différentielles depuis la régénération réelle, + les TROIS patchs
    // correctifs M2 ; la table des sources de l'élément Programmes &
    // financements, 6 lignes statiques, reste rendue - elle ne dépend pas des
    // vintages, issue #180).
    expect(wrapper.findAll('section#sources tbody tr').length).toBe(56)
  })

  it('une source sans ligne vintages en direct rend ses faits éditoriaux, jamais des dates inventées', async () => {
    // vintages commis sans la ligne flores_a38 → la source reste, fraîcheur nulle
    const vintages = vintagesCommites().filter((v) => v.id !== 'flores_a38')
    const { wrapper } = await monter(chargerAvec({ ...payloadAvecVintages, vintages }))

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

describe('MethodologieView — le shell à onglets (issue #332)', () => {
  it('rend trois onglets — Sources | Indicateurs | Programmes — et atterrit sur Sources', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual(['Sources', 'Indicateurs', 'Programmes'])
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')
    // une visite nue atterrit sur Sources : la table rend, les autres panneaux non
    expect(wrapper.find('section#sources').exists()).toBe(true)
    expect(wrapper.find('section#indicateurs').exists()).toBe(false)
    expect(wrapper.find('section#programmes').exists()).toBe(false)
  })

  it('garde l\u2019intro au-dessus des onglets, comme bloc d\u2019orientation permanent', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    const intro = wrapper.find('.methodologie__intro')
    const onglets = wrapper.find('[role="tablist"]')
    expect(intro.exists()).toBe(true)
    expect(intro.element.compareDocumentPosition(onglets.element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('cliquer un onglet écrit ?onglet= en REPLACE et monte son panneau', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages))
    const replace = vi.spyOn(router, 'replace')

    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await flushPromises()

    expect(replace).toHaveBeenCalledWith({ query: { onglet: 'indicateurs' } })
    expect(router.currentRoute.value.query.onglet).toBe('indicateurs')
    expect(wrapper.find('section#indicateurs').exists()).toBe(true)
    expect(wrapper.find('section#sources').exists()).toBe(false)
  })

  it('?onglet=indicateurs à l\u2019arrivée sélectionne l\u2019onglet et rend sa section', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=indicateurs',
    })

    expect(wrapper.findAll('[role="tab"]')[1].attributes('aria-selected')).toBe('true')
    expect(wrapper.find('section#indicateurs').exists()).toBe(true)
    expect(wrapper.find('section#sources').exists()).toBe(false)
  })

  it('?onglet=programmes rend la section Programmes & financements', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=programmes',
    })

    expect(wrapper.findAll('[role="tab"]')[2].attributes('aria-selected')).toBe('true')
    expect(wrapper.find('section#programmes').exists()).toBe(true)
    expect(wrapper.find('section#sources').exists()).toBe(false)
  })

  it('?onglet=sources sélectionne explicitement l\u2019onglet Sources (l\u2019état par défaut, jamais réécrit)', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources',
    })
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ onglet: 'sources' })
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')
    expect(wrapper.find('section#sources').exists()).toBe(true)
  })

  it('cliquer Sources depuis un autre onglet revient à l\u2019URL nue (sa forme canonique)', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=programmes',
    })

    await wrapper.findAll('[role="tab"]')[0].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.find('section#sources').exists()).toBe(true)
  })

  it('les panneaux portent role=tabpanel reliés aux onglets (aria-controls ↔ id, idPanneau)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=indicateurs',
    })

    const onglet = wrapper.findAll('[role="tab"]')[1]
    expect(onglet.attributes('aria-controls')).toBe('panneau-indicateurs')
    const panneau = wrapper.find('#panneau-indicateurs')
    expect(panneau.attributes('role')).toBe('tabpanel')
    expect(panneau.attributes('aria-labelledby')).toBe('onglet-indicateurs')
  })

  it('les clics d\u2019onglets remplacent l\u2019URL — back/forward restaurent l\u2019état depuis l\u2019URL', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/methodologie') // l'entrée précédente
    await router.push('/methodologie?onglet=indicateurs') // l'état partagé (entrée B)
    await router.isReady()
    const wrapper = mount(MethodologieView, {
      global: {
        plugins: [router],
        provide: { [PAYLOAD_CHARGER_KEY]: chargerAvec(payloadAvecVintages) },
      },
    })
    await flushPromises()
    expect(wrapper.findAll('[role="tab"]')[1].attributes('aria-selected')).toBe('true')

    // un clic d'onglet REPLACE l'entrée B (jamais une nouvelle entrée par clic)
    await wrapper.findAll('[role="tab"]')[2].trigger('click') // Programmes
    await flushPromises()
    expect(router.currentRoute.value.query.onglet).toBe('programmes')
    expect(wrapper.find('section#programmes').exists()).toBe(true)

    // un seul back saute le clic et revient à l'entrée précédente
    await router.back()
    await flushPromises()
    expect(router.currentRoute.value.query.onglet).toBeUndefined()
    expect(wrapper.find('section#sources').exists()).toBe(true)

    // forward restaure l'état des onglets (l'URL est l'état)
    await router.forward()
    await flushPromises()
    expect(router.currentRoute.value.query.onglet).toBe('programmes')
    expect(wrapper.find('section#programmes').exists()).toBe(true)
  })
})

describe('MethodologieView — la normalisation de l\u2019URL (le pattern carte, #332)', () => {
  it('?onglet=inconnu est normalisé — retombe sur l\u2019état par défaut (Sources)', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=bidule',
    })
    await flushPromises()

    expect(router.currentRoute.value.query.onglet).toBeUndefined()
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')
    expect(wrapper.find('section#sources').exists()).toBe(true)
  })

  it('?theme=habitat sans ?onglet= est retiré (un thème hors section n\u2019est pas un état)', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?theme=habitat',
    })
    await flushPromises()

    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.find('section#sources').exists()).toBe(true)
  })

  it('?onglet=sources&theme=habitat : le thème est retiré (les sources n\u2019ont pas encore d\u2019onglets de thème, #335)', async () => {
    const { router } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources&theme=habitat',
    })
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ onglet: 'sources' })
  })

  it('?onglet=programmes&theme=habitat : le thème est retiré', async () => {
    const { router } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=programmes&theme=habitat',
    })
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ onglet: 'programmes' })
  })
})

describe('MethodologieView — le thème dans l\u2019onglet indicateurs (?theme=, #332)', () => {
  it('sans ?theme=, l\u2019onglet indicateurs montre tous les thèmes construits (« Tous » par défaut)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=indicateurs',
    })

    for (const theme of THEMES_CONSTRUITS) {
      expect(wrapper.find(`section#indicateurs article#${theme}`).exists()).toBe(true)
    }
    const tous = wrapper.findAll('[role="tab"]').find((o) => o.text().trim() === 'Tous')
    expect(tous!.attributes('aria-selected')).toBe('true')
  })

  it('?onglet=indicateurs&theme=habitat sélectionne la section ET le thème à l\u2019intérieur', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=indicateurs&theme=habitat',
    })

    expect(wrapper.find('section#indicateurs').exists()).toBe(true)
    expect(wrapper.find('section#indicateurs article#habitat').exists()).toBe(true)
    expect(wrapper.find('section#indicateurs article#demographie').exists()).toBe(false)
    const habitat = wrapper.findAll('[role="tab"]').find((o) => o.text().trim() === 'Habitat')
    expect(habitat!.attributes('aria-selected')).toBe('true')
  })

  it('cliquer un thème écrit ?onglet=indicateurs&theme=<slug> et filtre les blocs', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=indicateurs',
    })

    const habitat = wrapper.findAll('[role="tab"]').find((o) => o.text().trim() === 'Habitat')
    await habitat!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ onglet: 'indicateurs', theme: 'habitat' })
    expect(wrapper.find('section#indicateurs article#habitat').exists()).toBe(true)
    expect(wrapper.find('section#indicateurs article#demographie').exists()).toBe(false)
  })

  it('cliquer « Tous » retire ?theme= (l\u2019état par défaut du sélecteur)', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=indicateurs&theme=habitat',
    })

    const tous = wrapper.findAll('[role="tab"]').find((o) => o.text().trim() === 'Tous')
    await tous!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ onglet: 'indicateurs' })
    expect(wrapper.find('section#indicateurs article#demographie').exists()).toBe(true)
  })

  it('?onglet=indicateurs&theme=inconnu : le thème est normalisé (retiré), la section reste', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=indicateurs&theme=bidule',
    })
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ onglet: 'indicateurs' })
    expect(wrapper.find('section#indicateurs').exists()).toBe(true)
  })
})
