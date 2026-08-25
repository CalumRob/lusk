import { flushPromises, mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import OngletTheme from '../components/fiche/OngletTheme.vue'
import { LIBELLE_HANDOFF, passarellesLecture } from '../fiche/explorationHandoff'
import { routes } from '../router'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  histoiresEconomieFixture,
  histoiresMilieuxFixture,
  histoiresMobiliteFixture,
  indicateursDemographieFixture,
  indicateursEconomieFixture,
  indicateursMilieuxFixture,
  indicateursMobiliteFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload, ScalarPageMetadata, ThemeMetadata } from '../payload/types'

/**
 * Les passarelles des GRANDES LECTURES (#473) : chaque figure de lecture
 * (GraphiqueSoldes, GraphiqueDistributionMobilite, FigureListeLQ,
 * GraphiqueQuadrantMilieux) offre la main aux Pages d'indicateur PUBLIÉES de
 * ses constituants — l'affordance compacte partagée (#468 : « Explorer »,
 * nouvelle fenêtre, vraie ancre), sous la lecture pour ne jamais concurrencer
 * le récit. Les quantités calculées pour la seule lecture (div_loss_*, les
 * taux de solde, la signature dens/dec, le top-N LQ) n'ont AUCUNE page :
 * aucune passarelle, jamais une page inventée (l'audit du ticket #473).
 */

/** Les sept constituants PUBLIÉS que la lecture flagship interprète. */
const CLEFS_ACCES = [
  'tot_loss_t',
  'tot_loss_b',
  'iso_alimentation',
  'iso_sante',
  'iso_administration',
  'iso_ecole',
  'iso_banque',
] as const

const LABELS_PERTES_TOTALES: Record<'tot_loss_t' | 'tot_loss_b', string> = {
  tot_loss_t: 'Perte totale d’accès — à pied ou en transports en commun',
  tot_loss_b: 'Perte totale d’accès — à vélo',
}

function pageScalaire(clef: string, libelle: string): ScalarPageMetadata {
  return {
    indicator: clef,
    detail: null,
    label: libelle,
    definition: `Définition publiée de ${libelle}.`,
    unit: 'types de services perdus',
    calculation: 'Calcul publié par le pipeline.',
    direction: 'low',
    caveats: '',
    levels: ['commune', 'epci', 'departement'],
    sources: ['mobilite_snapshot'],
    family: 'scalar',
  }
}

/** Le clone TYPÉ de la métadonnée Mobilité enrichi des SEPT pages d'accès —
 *  les pertes totales rejoignent le registre (le payload committé les porte). */
function mobiliteAvecPagesAcces(): ThemeMetadata {
  const clone = structuredClone(metadonneesThemesFixtures.mobilite)
  const sousGroupe = clone.subgroups[0]!
  sousGroupe.indicators = [...sousGroupe.indicators, 'tot_loss_t', 'tot_loss_b']
  clone.indicator_keys = [...clone.indicator_keys, 'tot_loss_t', 'tot_loss_b']
  clone.sources.tot_loss_t = 'mobilite_snapshot'
  clone.sources.tot_loss_b = 'mobilite_snapshot'
  clone.indicator_labels.tot_loss_t = LABELS_PERTES_TOTALES.tot_loss_t
  clone.indicator_labels.tot_loss_b = LABELS_PERTES_TOTALES.tot_loss_b
  clone.indicator_pages = Object.fromEntries(
    CLEFS_ACCES.map((clef) => [
      clef,
      pageScalaire(clef, clone.indicator_labels[clef] ?? LABELS_PERTES_TOTALES[clef as 'tot_loss_t' | 'tot_loss_b'] ?? clef),
    ]),
  )
  return clone
}

/** Le clone TYPÉ Milieux enrichi de la seule page « Intensité état » (M2→M3). */
function milieuxAvecPageEtat(): ThemeMetadata {
  const clone = structuredClone(metadonneesThemesFixtures.milieux)
  clone.indicator_pages = {
    artif_par_habitant: {
      indicator: 'artif_par_habitant',
      detail: null,
      label: 'Intensité état',
      definition: 'Surface artificialisée par habitant à chaque État OCS-GE.',
      unit: 'm²/hab',
      calculation: 'État artificialisé divisé par la population du même millésime.',
      direction: 'low',
      caveats: '',
      levels: ['commune', 'epci', 'departement'],
      sources: ['ocsge_artificialisation_22_2025'],
      family: 'trajectory',
      trajectory: { endpoints: ['M2', 'M3'] },
    },
  }
  return clone
}

function payloadPour(theme: 'demographie' | 'milieux' | 'mobilite' | 'economie', metadata: ThemeMetadata): Payload {
  const parTheme = {
    demographie: {
      indicateurs: indicateursDemographieFixture,
      histoires: histoiresDemographieFixture,
    },
    milieux: {
      indicateurs: indicateursMilieuxFixture,
      histoires: histoiresMilieuxFixture,
    },
    mobilite: {
      indicateurs: indicateursMobiliteFixture,
      histoires: histoiresMobiliteFixture,
    },
    economie: {
      indicateurs: indicateursEconomieFixture,
      histoires: histoiresEconomieFixture,
    },
  }[theme]
  return {
    territoires: territoiresFixture,
    ...parTheme,
    apercu: apercuAvecNAFixture,
    runReport: runReportFraisFixture,
    vintages: vintagesFixture,
    programmes: null,
    themeMetadata: { [theme]: metadata },
  }
}

async function monter(theme: 'demographie' | 'milieux' | 'mobilite' | 'economie', payload: Payload, territoire: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(OngletTheme, {
    props: { theme, payload, territoire },
    global: { plugins: [router] },
  })
  await flushPromises()
  return wrapper
}

describe('la rangée « Explorer » de la lecture flagship Mobilité (#473)', () => {
  it('rend SEPT passarelles compactes — les constituants publiés de la lecture, territoire et niveau emportés', async () => {
    const wrapper = await monter('mobilite', payloadPour('mobilite', mobiliteAvecPagesAcces()), '22001')

    const rangee = wrapper.find('.lecture-passarelles')
    expect(rangee.exists()).toBe(true)
    // la lecture garde la primauté narrative : la rangée ferme la carte, SOUS la source
    expect(rangee.find('.lecture-passarelles-etiquette').text()).toBe(LIBELLE_HANDOFF)
    expect(wrapper.find('.lecture-source').element.compareDocumentPosition(rangee.element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )

    const ancres = rangee.findAll('a.passarelle-exploration')
    expect(ancres).toHaveLength(7)
    expect(ancres.map((a) => a.attributes('href'))).toEqual([
      '/indicateurs/mobilite/tot_loss_t?territoire=22001&niveau=commune',
      '/indicateurs/mobilite/tot_loss_b?territoire=22001&niveau=commune',
      '/indicateurs/mobilite/iso_alimentation?territoire=22001&niveau=commune',
      '/indicateurs/mobilite/iso_sante?territoire=22001&niveau=commune',
      '/indicateurs/mobilite/iso_administration?territoire=22001&niveau=commune',
      '/indicateurs/mobilite/iso_ecole?territoire=22001&niveau=commune',
      '/indicateurs/mobilite/iso_banque?territoire=22001&niveau=commune',
    ])
    // des intitulés UNIQUES (accessibilité) — le libellé publié de CHAQUE indicateur
    const intitules = ancres.map((a) => a.text())
    expect(new Set(intitules).size).toBe(7)
    expect(intitules).toContain(LABELS_PERTES_TOTALES.tot_loss_t)
    expect(intitules).toContain(LABELS_PERTES_TOTALES.tot_loss_b)
    for (const ancre of ancres) {
      expect(ancre.attributes('target')).toBe('_blank')
      const rel = (ancre.attributes('rel') ?? '').split(' ')
      expect(rel).toContain('noopener')
      expect(rel).toContain('noreferrer')
    }
  })

  it('la saillance vélo (ce-que-le-velo-preserve) offre les MÊMES constituants', async () => {
    const wrapper = await monter('mobilite', payloadPour('mobilite', mobiliteAvecPagesAcces()), '22002')

    const ancres = wrapper.findAll('.lecture-passarelles a.passarelle-exploration')
    expect(ancres).toHaveLength(7)
    expect(ancres.map((a) => a.attributes('href'))).toContain(
      '/indicateurs/mobilite/tot_loss_b?territoire=22002&niveau=commune',
    )
  })
})

describe('la passarelle unique du quadrant Milieux (#473)', () => {
  it('offre la page « Intensité état » — les deux états M2/M3 que l’axe y confronte', async () => {
    const wrapper = await monter('milieux', payloadPour('milieux', milieuxAvecPageEtat()), '22001')

    const rangee = wrapper.find('.lecture-passarelles')
    expect(rangee.exists()).toBe(true)
    const ancres = rangee.findAll('a.passarelle-exploration')
    expect(ancres).toHaveLength(1)
    expect(ancres[0]!.attributes('href')).toBe(
      '/indicateurs/milieux/artif_par_habitant?territoire=22001&niveau=commune',
    )
    expect(ancres[0]!.text()).toBe('Intensité état')
    expect(ancres[0]!.attributes('target')).toBe('_blank')
  })
})

describe('l’honnêteté des lectures sans constituant publié (#473)', () => {
  it('GraphiqueSoldes : les taux de solde n’ont pas de page — AUCUNE rangée dans la carte de lecture', async () => {
    const wrapper = await monter('demographie', payloadPour('demographie', structuredClone(metadonneesThemesFixtures.demographie)), '22001')

    expect(wrapper.find('.lecture-texte').exists()).toBe(true) // la lecture rend
    expect(wrapper.find('.lecture-passarelles').exists()).toBe(false)
    // la grille garde SES passarelles (#468) — densite seule page publiée ici
    expect(wrapper.findAll('a.passarelle-exploration')).toHaveLength(1)
    expect(wrapper.findAll('a.passarelle-exploration')[0]!.attributes('href')).toContain('/indicateurs/demographie/densite')
  })

  it('FigureListeLQ : le top-N LQ est un calcul de lecture — AUCUNE rangée, jamais une page inventée', async () => {
    const wrapper = await monter('economie', payloadPour('economie', structuredClone(metadonneesThemesFixtures.economie)), '22001')

    expect(wrapper.find('.liste-lq').exists() || wrapper.find('.sous-groupe-lecture').exists()).toBe(true)
    expect(wrapper.find('.lecture-passarelles').exists()).toBe(false)
    expect(wrapper.findAll('a.passarelle-exploration')).toHaveLength(0)
  })
})

describe('passarellesLecture — le seam pur (#473)', () => {
  it('laisse tomber un constituant SANS page publiée — jamais un lien mort', () => {
    const metadata = mobiliteAvecPagesAcces()
    delete (metadata.indicator_pages as Record<string, unknown>).iso_sante

    const commune = territoiresFixture.find((t) => t.territoire === '22001')!
    const passarelles = passarellesLecture(metadata, 'vingt-minutes-sans-voiture', commune)
    expect(passarelles.map((p) => p.clef)).toEqual([
      'tot_loss_t',
      'tot_loss_b',
      'iso_alimentation',
      'iso_administration',
      'iso_ecole',
      'iso_banque',
    ])
    expect(passarellesLecture(structuredClone(metadonneesThemesFixtures.milieux), 'se-densifier-setaler-ou-sen-aller', commune)).toEqual([])
    expect(passarellesLecture(metadonneesThemesFixtures.demographie, 'trajectoire-demographique', commune)).toEqual([])
  })
})
