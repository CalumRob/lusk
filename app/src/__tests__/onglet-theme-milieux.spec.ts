import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import GraphiqueQuadrantMilieux from '../components/fiche/GraphiqueQuadrantMilieux.vue'
import OngletTheme from '../components/fiche/OngletTheme.vue'
import type { HistoireMilieux } from '../payload/types'
import {
  apercuAvecNAFixture,
  histoiresMilieuxFixture,
  indicateursMilieuxFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload, Theme } from '../payload/types'

/**
 * OngletTheme — the Milieux block through the SHARED subgroup anatomy
 * (issue #314) : le sous-groupe « L'artificialisation » — la lecture du
 * template de métadonnée (les deux horloges nommées, la classification et la
 * trajectoire), le GRAPHE QUADRANT au premier plan de la lecture (le nuage
 * des pairs au même échelle, ADR-0011 + ADR-0017), la source exhaustive, la
 * figure compacte « Intensité état » (famille trajectory) puis la série
 * annuelle. La fenêtre et la trajectoire ZAN sont mortes avec les flux
 * CONSOENAF : leurs figures ne rendent plus. Une lecture absente (M2 = 0, ou
 * le trou NA) échoue honnêtement — jamais inventée.
 */

const payloadMilieux: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursMilieuxFixture,
  histoires: histoiresMilieuxFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { milieux: metadonneesThemesFixtures.milieux },
}

async function monter(territoire: string, payload: Payload = payloadMilieux, theme: Theme = 'milieux') {
  const wrapper = mount(OngletTheme, {
    props: { theme, payload, territoire },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  await flushPromises()
  return wrapper
}

describe('OngletTheme — the Milieux subgroup (la lecture + les deux figures Intensité état · Série annuelle)', () => {
  it('renders the theme overline and the 2 figures — the compact état first, then the annual series', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Milieux')
    expect(wrapper.find('.sous-groupe-titre').text()).toBe('L’artificialisation')
    const figures = wrapper
      .findAll('.grille-indicateurs .figure-indicateur')
      .map((f) => f.attributes('data-clef'))
    expect(figures).toEqual(['artif_par_habitant', 'conso_enaf_annuel'])
    expect(wrapper.find('.figure-compacte').attributes('data-famille')).toBe('trajectory')
  })

  it('labels the two figures in French public (the product terms)', async () => {
    const wrapper = await monter('22001')

    const libelles = wrapper.findAll('.figure-indicateur-libelle').map((l) => l.text())
    expect(libelles).toEqual([
      'Intensité état',
      'Consommation d’ENAF — série annuelle',
    ])
  })

  it('renders the two removed figures NOTHING — la fenêtre et la trajectoire ZAN quittent le bloc', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.figure-indicateur[data-clef="conso_enaf_fenetre"]').exists()).toBe(false)
    expect(wrapper.find('.figure-indicateur[data-clef="trajectoire_zan"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Trajectoire ZAN')
    expect(wrapper.text()).not.toContain('Consommation d’ENAF 2021-2025')
  })

  it('renders the Intensité état figure as the two state rows (M2 then M3, m²/hab)', async () => {
    const wrapper = await monter('22001') // M2 2021 : 2 250 · M3 2025 : 2 550 m²/hab

    const etat = wrapper.find('.figure-indicateur[data-clef="artif_par_habitant"]')
    expect(etat.text()).toContain('2021')
    expect(etat.text()).toContain('2 250')
    expect(etat.text()).toContain('2025')
    expect(etat.text()).toContain('2 550')
    expect(etat.text()).toContain('m²/hab')
  })

  it('renders the multi-detail annual series with its year labels (2011 … 2024)', async () => {
    const wrapper = await monter('22001')

    const annuel = wrapper.find('.figure-indicateur[data-clef="conso_enaf_annuel"]')
    expect(annuel.text()).toContain('2011')
    expect(annuel.text()).toContain('2024')
  })
})

describe('OngletTheme — the reading slot (le template + le graphe quadrant)', () => {
  it('renders the reading from the metadata template — les deux horloges nommées, la classification, la trajectoire', async () => {
    const wrapper = await monter('22001') // grandir-en-setalant

    const texte = wrapper.find('.lecture-texte')
    expect(texte.exists()).toBe(true)
    expect(texte.text()).toContain('Entre 2017-2023 et 2021-2025')
    expect(texte.text()).toContain('Commune A1')
    expect(texte.text()).toContain('grandir-en-setalant')
    expect(texte.text()).toContain('trajectoire 1,13 par habitant')
  })

  it('mounts the quadrant graph inside the reading slot, above the grid', async () => {
    const wrapper = await monter('22001')

    const graphique = wrapper.findComponent(GraphiqueQuadrantMilieux)
    expect(graphique.exists()).toBe(true)
    const lecture = wrapper.find('.sous-groupe-lecture')
    expect(lecture.element.contains(graphique.element)).toBe(true)
    expect(lecture.element.compareDocumentPosition(wrapper.find('.grille-indicateurs').element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('feeds the quadrant graph the two forces, the classification and the same-scale nuage', async () => {
    const wrapper = await monter('22001') // taux +14,49 ‰/an (#306), Δm²/hab = 2550 − 2250 = +300

    const graphique = wrapper.findComponent(GraphiqueQuadrantMilieux)
    expect(graphique.props()).toMatchObject({
      tauxVariationPopulation: 14.4927536231884,
      deltaM2ParHabitant: 300,
      classification: 'grandir-en-setalant',
      nom: 'Commune A1',
      periodePop: '2017-2023',
      periodeArtif: '2021-2025',
    })
    // le nuage au même échelle : la commune voit les communes de SON EPCI
    expect(graphique.props('nuage')).toHaveLength(2)
    expect(graphique.props('nuage')).toMatchObject([
      { nom: 'Commune A1', type: 'commune', territoire: '22001' },
      { nom: 'Commune D', type: 'commune', territoire: '22002' },
    ])
  })

  it('renders the sen-aller reading for a territory that consumes while emptying', async () => {
    const wrapper = await monter('29001') // sen-aller-et-consommer-quand-meme

    expect(wrapper.find('.lecture-texte').text()).toContain(
      'sen-aller-et-consommer-quand-meme (trajectoire 1,06 par habitant)',
    )
  })

  it('renders the renaturation reading stating the measured decrease plainly (spec #225)', async () => {
    const histoires = histoiresMilieuxFixture.map((h) =>
      h.territoire === '29002'
        ? {
            ...h,
            delta_population: -10,
            // la renaturation MESURÉE : l'état final par habitant chute
            artif_m3: 99,
            artif_m3_par_habitant: 380,
            trajectoire_artif_par_habitant: 0.95,
            classification: 'les-departs-laissent-la-place-a-la-renaturation',
          }
        : h,
    )
    const wrapper = await monter('29002', { ...payloadMilieux, histoires })

    expect(wrapper.find('.lecture-texte').text()).toContain(
      'les-departs-laissent-la-place-a-la-renaturation (trajectoire 0,95 par habitant)',
    )
  })

  it('renders the exhaustive source line — la série historique, jamais CONSOENAF (spec #225)', async () => {
    const wrapper = await monter('22001')

    const source = wrapper.find('.lecture-source').text()
    expect(source).toContain('INSEE — Série historique du recensement')
    expect(source).not.toContain('CONSOENAF')
  })
})

describe('OngletTheme — Milieux, honest edge cases', () => {
  it('renders no reading slot for a territory without its row — the absent data stays silent', async () => {
    const histoires = histoiresMilieuxFixture.filter((h) => h.territoire !== '29001')
    const wrapper = await monter('29001', { ...payloadMilieux, histoires })

    expect(wrapper.find('.sous-groupe-lecture').exists()).toBe(false)
    expect(wrapper.find('.lecture-absent').exists()).toBe(false)
  })

  it('renders the honest absence note for an M2 = 0 territory — la lecture absente, jamais inventée (fix #243)', async () => {
    // La découverte #243 : un territoire sans AUCUNE terre artificialisée à
    // l'état initial (M2 = 0) a une trajectoire M3/M2 INDÉFINIE — le pipeline
    // publie trajectoire null + classification null, le slot affiche une note
    // honnête au lieu d'une lecture fabriquée sur un rapport sans sens.
    const histoires = (histoiresMilieuxFixture as HistoireMilieux[]).map((h) =>
      h.territoire === '22001'
        ? {
            ...h,
            artif_m2: 0,
            artif_m2_par_habitant: 0,
            trajectoire_artif_par_habitant: null,
            classification: null,
          }
        : h,
    )
    const wrapper = await monter('22001', { ...payloadMilieux, histoires })

    expect(wrapper.find('.sous-groupe-lecture').exists()).toBe(true)
    const note = wrapper.find('.lecture-absent')
    expect(note.exists()).toBe(true)
    expect(note.attributes('role')).toBe('note')
    expect(note.text()).toContain('n’est pas disponible pour ce territoire')
    // pas de graphe quadrant, pas de lecture inventée
    expect(wrapper.findComponent(GraphiqueQuadrantMilieux).exists()).toBe(false)
    // les figures de l'état restent sous le bloc
    const figures = wrapper.findAll('.figure-indicateur').map((f) => f.attributes('data-clef'))
    expect(figures).toEqual(['artif_par_habitant', 'conso_enaf_annuel'])
  })

  it('does NOT render the Milieux reading in another theme’s tab — the (territoire, groupe) gate (issue #219)', async () => {
    // le payload porte la Story Milieux — le sous-groupe Démographie (sa propre
    // métadonnée) ne lit que SES lignes : jamais la lecture Milieux dans l'onglet
    const wrapper = await monter('22001', payloadMilieux, 'demographie')

    // sans métadonnée Démographie (le payload est Milieux seul), l'overline
    // porte la clé honnête — le loader garantit la métadonnée d'un thème présent
    expect(wrapper.find('.onglet-theme-overline').text()).toBe('demographie')
    expect(wrapper.find('.sous-groupe-lecture').exists()).toBe(false)
    expect(wrapper.find('.lecture-texte').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Se densifier, s’étaler, ou s’en aller')
  })
})
