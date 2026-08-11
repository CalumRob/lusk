import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { SOURCES_METHODES } from '../methodes/sources'
import {
  apercuAvecNAFixture,
  chargerAvec,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  territoiresFixture,
} from '../payload/fixtures'
import type { ChargerFichier } from '../payload/usePayload'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Payload, Theme, Vintage } from '../payload/types'
import { THEMES_CANONIQUES } from '../payload/types'
import { routes } from '../router'
import MethodologieView from '../views/MethodologieView.vue'

/**
 * /methodologie — Sources & Méthodes (layouts.md §5, issue #128). L'intro
 * factuelle (ce qu'est Lusk, le pipeline, la reproductibilité) puis le shell
 * à deux niveaux (#332) : les onglets Sources | Méthodes, chacun avec sa
 * barre intérieure À propos | Programmes et subventions | les cinq thèmes.
 * Sources · <thème> filtre la table des sources à celles qui alimentent le
 * thème (l'union est le contrat, jamais un onglet « Tous »). Jamais de
 * bannière de construction (principles.md §1) — la page énonce ce qui est,
 * jamais ce qui viendra.
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

/** Les sources du registre qui alimentent un thème — le filtre attendu de la table. */
function sourcesDuTheme(theme: Theme): number {
  return Object.values(SOURCES_METHODES).filter((source) => source.themes.includes(theme)).length
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

describe('MethodologieView — le shell à deux niveaux (issue #332)', () => {
  it('rend les onglets Sources | Méthodes et la barre intérieure à 7 onglets — une visite nue atterrit sur Sources · À propos', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual([
      'Sources',
      'Méthodes',
      'À propos',
      'Programmes et subventions',
      'Mobilité',
      'Démographie',
      'Habitat',
      'Économie',
      'Milieux',
    ])
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')
    expect(wrapper.findAll('[role="tab"]')[2].attributes('aria-selected')).toBe('true')
    // la prose À propos des sources rend, la table et les blocs non
    expect(wrapper.find('section#sources-a-propos').exists()).toBe(true)
    expect(wrapper.find('section#sources').exists()).toBe(false)
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

  it('cliquer l\u2019onglet Méthodes écrit ?onglet=methodes en REPLACE et monte son contenu', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages))
    const replace = vi.spyOn(router, 'replace')

    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await flushPromises()

    expect(replace).toHaveBeenCalledWith({ query: { onglet: 'methodes' } })
    expect(router.currentRoute.value.query.onglet).toBe('methodes')
    expect(wrapper.find('section#methodes-a-propos').exists()).toBe(true)
    expect(wrapper.find('section#sources-a-propos').exists()).toBe(false)
  })

  it('?onglet=methodes à l\u2019arrivée sélectionne l\u2019onglet Méthodes', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=methodes',
    })

    expect(wrapper.findAll('[role="tab"]')[1].attributes('aria-selected')).toBe('true')
    expect(wrapper.find('section#methodes-a-propos').exists()).toBe(true)
    expect(wrapper.find('section#sources-a-propos').exists()).toBe(false)
  })

  it('cliquer un onglet intérieur écrit ?section= et monte son contenu', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages))
    const replace = vi.spyOn(router, 'replace')

    const habitat = wrapper.findAll('[role="tab"]').find((o) => o.text().trim() === 'Habitat')
    await habitat!.trigger('click')
    await flushPromises()

    expect(replace).toHaveBeenCalledWith({ query: { section: 'habitat' } })
    expect(router.currentRoute.value.query.section).toBe('habitat')
    expect(wrapper.find('section#sources').exists()).toBe(true)
  })

  it('?onglet=sources&section=habitat sélectionne l\u2019onglet ET l\u2019onglet intérieur (la table filtrée)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources&section=habitat',
    })

    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')
    const habitat = wrapper.findAll('[role="tab"]').find((o) => o.text().trim() === 'Habitat')
    expect(habitat!.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('section#sources').exists()).toBe(true)
    expect(wrapper.find('section#sources article#habitat').exists()).toBe(false)
  })

  it('changer d\u2019onglet préserve l\u2019onglet intérieur (?onglet=sources&section=habitat → Méthodes · Habitat)', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources&section=habitat',
    })

    await wrapper.findAll('[role="tab"]')[1].trigger('click') // Méthodes
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ onglet: 'methodes', section: 'habitat' })
    expect(wrapper.find('section#indicateurs article#habitat').exists()).toBe(true)
  })

  it('les panneaux portent role=tabpanel reliés aux onglets (aria-controls ↔ id, idPanneau)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources&section=habitat',
    })

    const ongletMethodes = wrapper.findAll('[role="tab"]')[1]
    expect(ongletMethodes.attributes('aria-controls')).toBe('panneau-methodes')
    const habitat = wrapper.findAll('[role="tab"]').find((o) => o.text().trim() === 'Habitat')
    expect(habitat!.attributes('aria-controls')).toBe('panneau-habitat')
    const panneau = wrapper.find('#panneau-habitat')
    expect(panneau.attributes('role')).toBe('tabpanel')
    expect(panneau.attributes('aria-labelledby')).toBe('onglet-habitat')
  })

  it('les clics d\u2019onglets remplacent l\u2019URL — back/forward restaurent l\u2019état depuis l\u2019URL', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/methodologie') // l'entrée précédente
    await router.push('/methodologie?onglet=sources&section=habitat') // l'état partagé (entrée B)
    await router.isReady()
    const wrapper = mount(MethodologieView, {
      global: {
        plugins: [router],
        provide: { [PAYLOAD_CHARGER_KEY]: chargerAvec(payloadAvecVintages) },
      },
    })
    await flushPromises()
    expect(wrapper.find('section#sources').exists()).toBe(true)

    // un clic d'onglet intérieur REPLACE l'entrée B (jamais une nouvelle entrée)
    const programmes = wrapper
      .findAll('[role="tab"]')
      .find((o) => o.text().trim() === 'Programmes et subventions')
    await programmes!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ onglet: 'sources', section: 'programmes' })
    expect(wrapper.find('section#programmes-sources').exists()).toBe(true)

    // un seul back saute le clic et revient à l'entrée précédente
    await router.back()
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.find('section#sources-a-propos').exists()).toBe(true)

    // forward restaure l'état des onglets (l'URL est l'état)
    await router.forward()
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ onglet: 'sources', section: 'programmes' })
    expect(wrapper.find('section#programmes-sources').exists()).toBe(true)
  })
})

describe('MethodologieView — la normalisation de l\u2019URL (le pattern carte, #332)', () => {
  it('?onglet=inconnu est retiré — retombe sur l\u2019état par défaut (Sources · À propos)', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=bidule',
    })
    await flushPromises()

    expect(router.currentRoute.value.query.onglet).toBeUndefined()
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')
    expect(wrapper.find('section#sources-a-propos').exists()).toBe(true)
  })

  it('?section=inconnue est retirée — retombe sur À propos', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?section=bidule',
    })
    await flushPromises()

    expect(router.currentRoute.value.query.section).toBeUndefined()
    expect(wrapper.find('section#sources-a-propos').exists()).toBe(true)
  })

  it('?onglet=sources&section=bidule : la section est retirée, l\u2019onglet reste', async () => {
    const { router } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources&section=bidule',
    })
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ onglet: 'sources' })
  })

  it('?onglet=bidule&section=habitat : l\u2019onglet est retiré, la section valide reste', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=bidule&section=habitat',
    })
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ section: 'habitat' })
    expect(wrapper.find('section#sources').exists()).toBe(true)
  })

  it('?section=habitat seule est conservée (l\u2019onglet par défaut reste sources)', async () => {
    const { router, wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?section=habitat',
    })
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ section: 'habitat' })
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')
    expect(wrapper.find('section#sources').exists()).toBe(true)
  })

  it('?onglet=methodes&section=habitat est conservé (les deux niveaux valides)', async () => {
    const { router } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=methodes&section=habitat',
    })
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ onglet: 'methodes', section: 'habitat' })
  })
})

describe('MethodologieView — Sources · À propos (le registre des sources)', () => {
  it('énonce ce qu\u2019est le registre, le contrat de parité avec vintages et les faits de fraîcheur', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages))

    const texte = wrapper.find('section#sources-a-propos').text()
    expect(texte).toContain('registre')
    expect(texte).toContain('vintages')
    expect(texte).toMatch(/fraîcheur|version|licence/i)
  })
})

describe('MethodologieView — Méthodes · À propos (le registre des indicateurs)', () => {
  it('énonce ce qu\u2019est le registre des indicateurs et le contrat avec les clés de la payload', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=methodes',
    })

    const texte = wrapper.find('section#methodes-a-propos').text()
    expect(texte).toContain('registre')
    expect(texte).toContain('indicateurs')
    expect(texte).toContain('payload')
    expect(texte).toMatch(/Stories|lecture/i)
  })
})

describe('MethodologieView — Sources · Programmes et subventions', () => {
  it('montre la table des six sources de l\u2019élément (URL, format, licence, fraîcheur)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources&section=programmes',
    })

    const section = wrapper.find('section#programmes-sources')
    expect(section.exists()).toBe(true)
    expect(section.findAll('tbody tr').length).toBe(6)
    expect(wrapper.find('tr#source-ort').text()).toMatch(/par ligne|actualisation/i)
    expect(wrapper.find('tr#source-subventions-scdl').text()).toMatch(/semaine|hebdomadaire/i)
  })
})

describe('MethodologieView — la table des sources par thème (Sources · <thème>)', () => {
  it('chaque onglet de thème montre les sources qui l\u2019alimentent (le filtre du registre)', async () => {
    for (const theme of THEMES_CANONIQUES) {
      const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
        chemin: `/methodologie?onglet=sources&section=${theme}`,
      })

      expect(
        wrapper.findAll('section#sources tbody tr').length,
        `onglet Sources · ${theme}`,
      ).toBe(sourcesDuTheme(theme))
    }
  })

  it('l\u2019union des cinq onglets de thème = les 56 sources du registre (l\u2019union est le contrat)', async () => {
    const ids: string[] = []
    for (const theme of THEMES_CANONIQUES) {
      const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
        chemin: `/methodologie?onglet=sources&section=${theme}`,
      })
      ids.push(...wrapper.findAll('section#sources tbody tr').map((l) => l.attributes('id')!))
    }

    // une source multi-thèmes apparaît sous CHACUN de ses thèmes — l'union, pas la somme
    expect(ids.length).toBeGreaterThan(56)
    expect(new Set(ids).size).toBe(56)
  })

  it('une source multi-thèmes apparaît sous chacun de ses thèmes (serie_historique → Démographie ET Milieux)', async () => {
    for (const theme of ['demographie', 'milieux']) {
      const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
        chemin: `/methodologie?onglet=sources&section=${theme}`,
      })

      expect(wrapper.find('tr#source-serie-historique').exists(), `sous ${theme}`).toBe(true)
    }
  })

  it('liste chaque source avec ses faits éditoriaux et sa fraîcheur en direct', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources&section=demographie',
    })

    const ligneSerie = wrapper.find('tr#source-serie-historique')
    expect(ligneSerie.exists()).toBe(true)
    expect(ligneSerie.text()).toContain('INSEE — Série historique du recensement')
    expect(ligneSerie.text()).toContain('INSEE')
    expect(ligneSerie.text()).toContain('Démographie')
    expect(ligneSerie.text()).toContain('2023')
    expect(ligneSerie.text()).toContain('Licence Ouverte 2.0')
    expect(ligneSerie.text()).toContain('30 juin 2026')
  })

  it('rend la source CONSOENAF avec son URL, ses dates, sa licence et l\u2019anomalie d\u2019unité (issue #177)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources&section=milieux',
    })

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
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources&section=mobilite',
    })

    const ligne = wrapper.find('tr#source-mobilite-snapshot')
    expect(ligne.exists()).toBe(true)
    expect(ligne.text()).toContain('ODbL — © OpenStreetMap contributors')
    expect(ligne.text()).toContain('28 février 2026')
    expect(ligne.text()).toContain('6 août 2026')
    expect(ligne.text()).not.toContain('odbl')
  })

  it('rend l\u2019attribution ODbL pour les trois sources concernées (OSM · Korrigo · stationnement vélo, ADR-0001)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources&section=mobilite',
    })

    for (const id of ['osm-reseaux', 'korrigo', 'stationnement-velo']) {
      const ligne = wrapper.find(`tr#source-${id}`)
      expect(ligne.exists(), `ligne « ${id} » introuvable`).toBe(true)
      expect(ligne.text()).toContain('ODbL — © OpenStreetMap contributors')
      expect(ligne.text()).not.toContain('odbl')
    }
  })

  it('la cellule licence se plie (classe dédiée) — version/date gardent le traitement tabulaire one-line (issue #331)', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources&section=mobilite',
    })

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
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources&section=habitat',
    })

    expect(wrapper.find('tr#source-dvf-2021-dep22').exists()).toBe(true)
    expect(wrapper.find('tr#source-logements').exists()).toBe(true)
  })

  it('chaque source rend un lien vers son jeu de données', async () => {
    const { wrapper } = await monter(chargerAvec(payloadAvecVintages), {
      chemin: '/methodologie?onglet=sources&section=demographie',
    })

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
    const { wrapper } = await monter(chargerAvec(payloadSansVintages), {
      chemin: '/methodologie?onglet=sources&section=demographie',
    })

    const ligneSerie = wrapper.find('tr#source-serie-historique')
    expect(ligneSerie.exists()).toBe(true)
    expect(ligneSerie.text()).toContain('INSEE — Série historique du recensement')

    const note = wrapper.find('.sources__note-fraicheur')
    expect(note.exists()).toBe(true)
    expect(wrapper.text()).toContain('actualisation des données')
    // La table ne casse jamais : les sources du thème restent, fraîcheur en tirets
    expect(wrapper.findAll('section#sources tbody tr').length).toBe(sourcesDuTheme('demographie'))
  })

  it('une source sans ligne vintages en direct rend ses faits éditoriaux, jamais des dates inventées', async () => {
    // vintages commis sans la ligne flores_a38 → la source reste, fraîcheur nulle
    const vintages = vintagesCommites().filter((v) => v.id !== 'flores_a38')
    const { wrapper } = await monter(chargerAvec({ ...payloadAvecVintages, vintages }), {
      chemin: '/methodologie?onglet=sources&section=economie',
    })

    const ligneFlores = wrapper.find('tr#source-flores-a38')
    expect(ligneFlores.exists()).toBe(true)
    expect(ligneFlores.text()).toContain('INSEE')
    expect(ligneFlores.text()).toContain('Économie')
    expect(ligneFlores.text()).not.toContain('30 juin 2026')
  })

  it('affiche un squelette pendant le chargement', async () => {
    const enAttente = new Promise<Payload>(() => {})
    const { wrapper } = await monter(() => enAttente, {
      chemin: '/methodologie?onglet=sources&section=demographie',
    })

    expect(wrapper.find('.squelette').exists()).toBe(true)
  })

  it('affiche l\u2019erreur typée avec le bouton Réessayer', async () => {
    const { wrapper } = await monter(
      async () => {
        throw new Error('panne')
      },
      { chemin: '/methodologie?onglet=sources&section=demographie' },
    )

    expect(wrapper.text()).toContain('Impossible de charger les données des sources.')
    expect(wrapper.find('.bouton-reessayer').text()).toContain('Réessayer')
  })
})
