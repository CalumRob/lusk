import { mount } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import FigureCompacte from '../components/fiche/FigureCompacte.vue'
import { COULEURS_DPE } from '../fiche/couleursDpe'
import {
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  indicateursMilieuxFixture,
  indicateursMobiliteFixture,
  metadonneesThemesFixtures,
} from '../payload/fixtures'
import type { FamilleFigure, Indicateur, Theme } from '../payload/types'

/**
 * Le renderer partagé de la grammaire des figures (issue #371) — UN sélecteur
 * de corps par famille, sans branche par thème. Ce test exerce le seam
 * FigureCompacte : sélection observable de la famille, couleurs officielles
 * DPE, pyramide des âges, trajectoire, et la régression de la puce de rang
 * directionnelle (#371 — le glyphe ▲/▼ hérité du seam de #367).
 */

function lignes(theme: Theme, clef: string, territoire = '22001'): Indicateur[] {
  const fixtures: Record<Theme, Indicateur[]> = {
    demographie: indicateursDemographieFixture,
    habitat: indicateursHabitatFixture,
    milieux: indicateursMilieuxFixture,
    mobilite: indicateursMobiliteFixture,
    economie: [],
  }
  return fixtures[theme].filter((l) => l.territoire === territoire && l.key === clef)
}

function monter(famille: FamilleFigure, clef: string, theme: Theme, territoire = '22001', extra: Partial<{ reseaux: Indicateur[] }> = {}) {
  const detail = (metadonneesThemesFixtures[theme]?.detail_labels[clef]) ?? undefined
  return mount(FigureCompacte, {
    props: {
      famille,
      clef,
      lignes: lignes(theme, clef, territoire),
      libelle: clef,
      labelsDetail: detail,
      theme,
      ...extra,
    },
  })
}

describe('FigureCompacte — sélection observable de la famille', () => {
  it('route composition/distribution_dpe vers le corps DPE officiel', () => {
    const wrapper = monter('composition', 'distribution_dpe', 'habitat')
    expect(wrapper.find('.figure-composition-dpe').exists()).toBe(true)
    expect(wrapper.find('.figure-indicateur').attributes('data-clef')).toBe('distribution_dpe')
  })

  it('route composition/structure_age vers le corps pyramide', () => {
    const wrapper = monter('composition', 'structure_age', 'demographie')
    expect(wrapper.find('.figure-pyramide-age').exists()).toBe(true)
    expect(wrapper.find('.figure-indicateur').attributes('data-clef')).toBe('structure_age')
  })

  it('route trajectory/artif_par_habitant vers le corps ligne', () => {
    const wrapper = monter('trajectory', 'artif_par_habitant', 'milieux')
    expect(wrapper.find('.figure-trajectoire').exists()).toBe(true)
    expect(wrapper.find('.figure-indicateur').attributes('data-clef')).toBe('artif_par_habitant')
  })

  it('route scalar/offre_cyclable vers le corps spécialisé (FigureOffreCyclable)', () => {
    const wrapper = monter('scalar', 'offre_cyclable', 'mobilite', '22001', {
      reseaux: lignes('mobilite', 'reseaux', '22001'),
    })
    expect(wrapper.find('.figure-indicateur[data-clef="offre_cyclable"]').exists()).toBe(true)
    expect(wrapper.find('.valeur-numerique').text()).toBe('0 %')
  })

  it('route scalar/densite vers le corps hérité (IndicatorFigure)', () => {
    const wrapper = monter('scalar', 'densite', 'demographie')
    expect(wrapper.find('.figure-indicateur[data-clef="densite"]').exists()).toBe(true)
    expect(wrapper.find('.valeur-numerique').text()).toBe('200')
  })
})

describe('FigureCompacte — composition DPE dans les couleurs officielles A→G', () => {
  it('rend les sept étiquettes A→G dans l’ordre, colorées officiellement', () => {
    const wrapper = monter('composition', 'distribution_dpe', 'habitat')
    const segments = wrapper.findAll('.barre-segment')
    expect(segments).toHaveLength(7)
    const etiquettes = segments.map((s) => s.attributes('data-etiquette'))
    expect(etiquettes).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
    segments.forEach((segment) => {
      const etiquette = segment.attributes('data-etiquette')!
      // la couleur officielle est posée telle quelle (hex) — jamais la palette du thème
      expect(segment.attributes('style')!.replace(/\s/g, '').toLowerCase()).toContain(
        COULEURS_DPE[etiquette as 'A'].toLowerCase(),
      )
    })
  })

  it('porte la lecture accessible de la répartition (A 5% · B 10% · …)', () => {
    const wrapper = monter('composition', 'distribution_dpe', 'habitat')
    const aria = wrapper.find('.barre-dpe').attributes('aria-label') ?? ''
    expect(aria).toContain('A 5%')
    expect(aria).toContain('G 15%')
  })
})

describe('FigureCompacte — composition pyramide des âges (structure_age)', () => {
  it('rend sept bandes d’âge empilées (jeune en bas), libellés + valeurs', () => {
    const wrapper = monter('composition', 'structure_age', 'demographie')
    const bandes = wrapper.findAll('.bande-age')
    expect(bandes).toHaveLength(7)
    expect(wrapper.find('.figure-pyramide-age').exists()).toBe(true)
    const libelles = wrapper.findAll('.bande-age-libelle').map((l) => l.text())
    expect(libelles[0]).toBe('Moins de 15 ans')
    expect(libelles[6]).toBe('80 ans et plus')
    const valeurs = wrapper.findAll('.bande-age-valeur').map((v) => v.text())
    expect(valeurs[0]).toBe('30')
    expect(valeurs[6]).toBe('5')
  })

  it('n’a PAS de puce de rang (composition multi-détail, comportement hérité)', () => {
    const wrapper = monter('composition', 'structure_age', 'demographie')
    expect(wrapper.find('.puce-rang').exists()).toBe(false)
  })
})

describe('FigureCompacte — trajectoire (artif_par_habitant)', () => {
  it('trace une ligne SVG sur les millésimes et liste les points accessibles', () => {
    const wrapper = monter('trajectory', 'artif_par_habitant', 'milieux')
    const svg = wrapper.find('.trajectoire-ligne')
    expect(svg.exists()).toBe(true)
    expect(svg.find('path').attributes('d')).toMatch(/^M/)
    // texte visible — le test de l’onglet Milieux dépend de ces chaînes
    expect(wrapper.text()).toContain('2021')
    expect(wrapper.text()).toContain('2 250')
    expect(wrapper.text()).toContain('2025')
    expect(wrapper.text()).toContain('2 550')
    expect(wrapper.text()).toContain('m²/hab')
  })

  it('souligne la valeur courante (dernier millésime) sans couleur de statut', () => {
    const wrapper = monter('trajectory', 'artif_par_habitant', 'milieux')
    const points = wrapper.findAll('.point')
    expect(points.length).toBeGreaterThan(1)
    expect(points[points.length - 1].classes()).toContain('point--courant')
  })
})

describe('FigureCompacte — régression de la puce de rang directionnelle (#367)', () => {
  it('scalar/densite (plus = mieux) porte le glyphe ▲ dans la phrase accessible', () => {
    const wrapper = monter('scalar', 'densite', 'demographie')
    const puce = wrapper.find('.puce-rang')
    expect(puce.exists()).toBe(true)
    // le glyphe ▲ (plus = mieux) accompagne le rang, jamais sans texte accessible
    expect(puce.text()).toBe("▲ 1er/2 de l'EPCI")
    expect(puce.attributes('title')).toBe("1er/2 de l'EPCI — plus = mieux")
    expect(puce.attributes('aria-label')).toBe("1er/2 de l'EPCI — plus = mieux")
  })

  it('scalar/iso_alimentation (moins = mieux) porte le glyphe ▼ (sens dérivé du registre Méthodes)', () => {
    const wrapper = monter('scalar', 'iso_alimentation', 'mobilite')
    const puce = wrapper.find('.puce-rang')
    expect(puce.exists()).toBe(true)
    expect(puce.text()).toContain('▼')
    // la phrase complète « moins = mieux » porte dans le title + aria-label, jamais le glyphe seul
    expect(puce.attributes('aria-label')).toContain('moins = mieux')
    expect(puce.attributes('title')).toContain('moins = mieux')
  })
})
