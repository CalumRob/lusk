import { mount } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import BlocProgrammes from '../components/fiche/BlocProgrammes.vue'
import {
  indicateursProgrammesFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
} from '../payload/fixtures'
import type { Payload } from '../payload/types'

/**
 * BlocProgrammes — le bloc du SIXIÈME thème (#408), l'onglet premier et par
 * défaut de la fiche. Ce que les tests verrouillent :
 *   - la présentation migrée : les badges à leurs voix honnêtes (lauréate /
 *     couverte / porte / compte / ort), la ventilation communale pliée
 *     top-5 + révélation, la part de contexte, la provenance, le lien
 *     portail Région ;
 *   - le vocabulaire payload-owned : l'overline et les titres/cadrages des
 *     sous-groupes viennent de theme_programmes.json ;
 *   - les faits d'action publique JAMAIS des résultats : aucune formulation
 *     ne présente une adhésion ou une subvention comme un effet mesuré ;
 *   - les états d'absence honnêtes : « Aucun programme référencé. » quand le
 *     territoire ne porte aucun fait, silence sur la figure de subventions.
 */

const metadata = metadonneesThemesFixtures.programmes

function payloadAvec(faits: typeof indicateursProgrammesFixture): Payload {
  return {
    territoires: territoiresFixture,
    indicateurs: faits,
    histoires: [],
    apercu: null,
    runReport: null,
    vintages: null,
    programmes: null,
    themeMetadata: { programmes: JSON.parse(JSON.stringify(metadata)) },
  }
}

const payloadPlein = payloadAvec(indicateursProgrammesFixture)
const payloadVide = payloadAvec([])

function montage(payload: Payload, territoire: string) {
  return mount(BlocProgrammes, {
    props: { payload, territoire },
    global: {
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
        AppIcon: { template: '<span />' },
      },
    },
  })
}

describe('BlocProgrammes — le premier thème de la fiche (#408)', () => {
  it('porte l\u2019overline publiée et les sous-groupes du canon (jamais un vocabulaire app-side)', () => {
    const wrapper = montage(payloadPlein, '22001')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Programmes et subventions')
    const titres = wrapper.findAll('.sous-groupe-titre').map((t) => t.text())
    expect(titres).toEqual(['Programmes et contrats', 'Subventions attribuées'])
    expect(wrapper.find('[data-groupe="couverture"]').exists()).toBe(true)
    expect(wrapper.find('[data-groupe="subventions"]').exists()).toBe(true)
  })

  it('rend les badges avec leurs voix honnêtes — lauréate, couverte, portage nommé', () => {
    // 22001 : lauréate ACV (rider convention valant ORT) ; son EPCI X porte CRTE
    const wrapper = montage(payloadPlein, '22001')

    const badges = wrapper.findAll('.programme-badge')
    expect(badges).toHaveLength(2)
    expect(badges[0].text()).toContain('ACV')
    expect(badges[0].text()).toContain('Commune lauréate du programme')
    expect(badges[0].text()).toContain('convention valant ORT')
    expect(badges[1].text()).toContain('CRTE')
    expect(badges[1].text()).toContain('Territoire couvert par le contrat')
    expect(badges[1].text()).toContain('EPCI X')
    // chaque badge porte l'estampille de SA source
    expect(badges[0].text()).toContain('Action cœur de ville')
  })

  it('rend la figure de subventions — le total annuel poolé par le pipeline, la ventilation triée, l\u2019estampille', () => {
    const wrapper = montage(payloadPlein, '22001')

    const total = wrapper.find('.subvention-total')
    expect(total.text()).toContain('45\u202F000 €')
    expect(total.text()).toContain('en 2025')
    const axes = wrapper.findAll('.subvention-axe').map((a) => a.text())
    expect(axes).toHaveLength(2)
    expect(axes[0]).toContain('Développement économique')
    expect(axes[1]).toContain('Agriculture')
    expect(wrapper.find('.subvention-vintage').text()).toContain('SCDL')
  })

  it('plie la ventilation au-delà de cinq domaines derrière une révélation accessible (#305)', async () => {
    // sept domaines pour la commune 22001 : les deux du fixture + cinq
    // supplémentaires — le head en liste cinq, le bouton nomme les deux autres
    const faits = [
      ...indicateursProgrammesFixture.filter(
        (i) => !(i.key === 'subventions_par_domaine' && i.territoire === '22001'),
      ),
      ...['Culture', 'Environnement', 'Sport', 'Tourisme', 'Enseignement', 'Insertion', 'Voirie'].map(
        (detail, i) => ({
          territoire: '22001',
          type: 'commune',
          theme: 'programmes',
          key: 'subventions_par_domaine',
          detail,
          dimension: '2025',
          value: 1000 - i,
          unit: '€',
          rang_epci: null,
          rang_epci_n: null,
          rang_dep: null,
          rang_dep_n: null,
          rang_reg: null,
          rang_reg_n: null,
          vintage_source: 'Région Bretagne — subventions attribuées (SCDL)',
          vintage_version: '2026-08-05',
          vintage_date_reference: '2026-08-05',
          vintage_date_publication: '2026-08-05',
        }),
      ),
    ] as unknown as typeof indicateursProgrammesFixture

    const wrapper = montage(payloadAvec(faits), '22001')

    // cinq domaines visibles + le bouton qui nomme le reste
    expect(wrapper.findAll('.subvention-axes:not(.subvention-axes--reste) .subvention-axe')).toHaveLength(5)
    const bouton = wrapper.find('.subvention-reveler')
    expect(bouton.text()).toBe('Voir les 2 autres domaines')
    expect(bouton.attributes('aria-expanded')).toBe('false')

    // la révélation ouvre la liste restante (le tri décroissant continue)
    await bouton.trigger('click')
    expect(bouton.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.subvention-axes--reste').findAll('.subvention-axe')).toHaveLength(2)
  })

  it('affiche le lien portail Région (la drill-down de l\u2019élément)', () => {
    const wrapper = montage(payloadPlein, '22001')

    const lien = wrapper.find('.programmes-lien')
    expect(lien.attributes('href')).toBe('https://www.bretagne.bzh/aides/')
    expect(lien.text()).toContain('Subventions de la Région Bretagne')
  })
})

describe('BlocProgrammes — les faits d\u2019action publique, jamais des résultats (#408)', () => {
  it('ne présente aucune adhésion ni subvention comme un effet mesuré', () => {
    const wrapper = montage(payloadPlein, '22001')
    const texte = wrapper.text()

    // le vocabulaire de l'action publique est là…
    expect(texte).toMatch(/attribu/)
    // …et celui des résultats ne l'est jamais
    expect(texte).not.toMatch(/résultats? mesur|impact|perf|efficacité|bénéficiaire a créé|a permis/)
    // les verbes honnêtes des voix, jamais une promesse
    expect(texte).toContain('Commune lauréate du programme')
    expect(texte).not.toMatch(/grâce à|permis de|améliore/)
  })

  it('garde la part de contexte silencieuse sans parent — jamais une part inventée', () => {
    // la région n'a pas de parent : pas de ligne de contexte
    const wrapper = montage(payloadPlein, '53')

    expect(wrapper.find('.subvention-contexte').exists()).toBe(false)
    // la provenance, elle, existe (la somme des communes)
    expect(wrapper.find('.subvention-provenance').text()).toContain(
      'communes de Bretagne',
    )
  })
})

describe('BlocProgrammes — l\u2019absence honnête', () => {
  it('rend l\u2019état vide du thème quand le territoire ne porte AUCUN fait — jamais une figure inventée', () => {
    // 29002 : aucune adhésion, aucune subvention dans les faits du fixture
    const wrapper = montage(payloadPlein, '29002')

    expect(wrapper.text()).toContain('Aucun programme référencé.')
    expect(wrapper.findAll('.programme-badge')).toHaveLength(0)
    expect(wrapper.find('.programme-subventions').exists()).toBe(false)
  })

  it('reste silencieux sur la couverture quand seuls les faits de subventions existent', () => {
    const faitsSubventionsSeules = indicateursProgrammesFixture.filter(
      (i) => i.key !== 'couverture_programmes',
    )
    // le département 22 porte un total poolé mais aucune adhésion
    const wrapper = montage(payloadAvec(faitsSubventionsSeules), '22')

    // pas de badges → pas de section couverture (le sous-groupe reste muet)
    expect(wrapper.findAll('.programme-badge')).toHaveLength(0)
    // mais la figure de subventions rend
    expect(wrapper.find('.subvention-total').exists()).toBe(true)
  })

  it('un thème sans AUCUN fait rend l\u2019état vide complet — jamais un bloc fantôme', () => {
    const wrapper = montage(payloadVide, '22001')

    expect(wrapper.text()).toContain('Aucun programme référencé.')
    expect(wrapper.findAll('.sous-groupe-titre').map((t) => t.text())).toEqual([
      'Programmes et contrats',
    ])
  })
})
