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
    // #408 : le sixième thème ne passe PAS par la grammaire des figures
    // (sa présentation propre lit ses faits via BlocProgrammes).
    programmes: [],
  }
  return fixtures[theme].filter((l) => l.territoire === territoire && l.key === clef)
}

/**
 * Le payload legacy : sept lignes totales, une par tranche, SANS dimension
 * sexe. Synthétisé indépendamment du fixture (qui, après #390, est sexué pour
 * 22001) pour tester le repli honnête vers le corps hérité segmenté.
 */
const TRANCHES_LEGACY: ReadonlyArray<readonly [string, number]> = [
  ['<15', 0.3],
  ['15-24', 0.15],
  ['25-39', 0.2],
  ['40-54', 0.15],
  ['55-64', 0.05],
  ['65-79', 0.1],
  ['80+', 0.05],
]

function lignesLegacy(territoire = '22001'): Indicateur[] {
  const modele = indicateursDemographieFixture.find(
    (l) => l.territoire === territoire && l.key === 'structure_age' && l.detail === '<15',
  )!
  return TRANCHES_LEGACY.map(([detail, value]) => ({ ...modele, detail, value, sex: undefined }))
}

/**
 * Le payload sexué complet (#390) : les sept tranches legacy dupliquées en F et
 * M (14 lignes), chaque ligne portant un `sex` explicite. Sert à exercer le
 * vrai pyramid à deux côtés — dérivé du payload legacy synthétique, jamais du
 * fixture sexué.
 */
function lignesSexuees(territoire = '22001'): Indicateur[] {
  const base = lignesLegacy(territoire)
  const couples: Indicateur[] = []
  for (const sex of ['F', 'M'] as const) {
    for (const l of base) couples.push({ ...l, sex } as Indicateur)
  }
  return couples
}

function monter(
  famille: FamilleFigure,
  clef: string,
  theme: Theme,
  territoire = '22001',
  extra: Partial<{ reseaux: Indicateur[]; lignes: Indicateur[] }> = {},
) {
  const detail = (metadonneesThemesFixtures[theme]?.detail_labels[clef]) ?? undefined
  return mount(FigureCompacte, {
    props: {
      famille,
      clef,
      lignes: extra.lignes ?? lignes(theme, clef, territoire),
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

  it('route composition/structure_age (payload legacy 7 lignes, sans sexe) vers le corps hérité segmenté, jamais une pyramide à un côté (#390)', () => {
    const wrapper = monter('composition', 'structure_age', 'demographie', '22001', {
      lignes: lignesLegacy(),
    })
    expect(wrapper.find('.figure-pyramide-age').exists()).toBe(false)
    expect(wrapper.find('.barre-segmentee').exists()).toBe(true)
    expect(wrapper.find('.figure-indicateur').attributes('data-clef')).toBe('structure_age')
  })

  it('route composition/structure_age (payload sexué #390) vers le corps pyramide deux côtés', () => {
    const wrapper = monter('composition', 'structure_age', 'demographie', '22001', {
      lignes: lignesSexuees(),
    })
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

  it('rend un libellé vide (jamais la clé brute) si labelsDetail est absent', () => {
    const wrapper = mount(FigureCompacte, {
      props: {
        famille: 'composition',
        clef: 'distribution_dpe',
        lignes: lignes('habitat', 'distribution_dpe', '22001'),
        libelle: 'distribution_dpe',
        labelsDetail: undefined,
        theme: 'habitat',
      },
    })
    const libelles = wrapper.findAll('.dpe-libelle').map((l) => l.text())
    expect(libelles).toHaveLength(7)
    // la lettre A–G est rendue à part ; le libellé doit être vide, pas la clé brute
    for (const texte of libelles) expect(texte).toBe('')
  })

  it('clé la couleur de texte de la lettre (C/D sombres), jamais sur la position CSS — un jeu partiel rend correctement', () => {
    const wrapper = monter('composition', 'distribution_dpe', 'habitat')
    const lettres = wrapper.findAll('.dpe-lettre')
    expect(lettres).toHaveLength(7)
    // C et D (jaune/orange) portent un texte sombre inline, appliqué depuis la lettre
    const styleC = lettres.find((l) => l.attributes('data-etiquette') === 'C')!.attributes('style') ?? ''
    const styleD = lettres.find((l) => l.attributes('data-etiquette') === 'D')!.attributes('style') ?? ''
    expect(styleC.toLowerCase()).toContain('#1a1a1a')
    expect(styleD.toLowerCase()).toContain('#1a1a1a')
    // A (vert) garde un texte blanc
    const styleA = lettres.find((l) => l.attributes('data-etiquette') === 'A')!.attributes('style') ?? ''
    expect(styleA.toLowerCase()).toContain('#ffffff')
  })
})

describe('FigureCompacte — composition pyramide des âges sexuée (structure_age, #390)', () => {
  it('rend sept bandes d’âge à deux côtés (hommes + femmes), empilées jeune-en-bas', () => {
    const wrapper = monter('composition', 'structure_age', 'demographie', '22001', {
      lignes: lignesSexuees(),
    })
    expect(wrapper.find('.figure-pyramide-age').exists()).toBe(true)
    const bandes = wrapper.findAll('.bande-age')
    expect(bandes).toHaveLength(7)
    // une barre hommes ET une barre femmes par tranche
    expect(wrapper.findAll('.bande-age-barre--hommes')).toHaveLength(7)
    expect(wrapper.findAll('.bande-age-barre--femmes')).toHaveLength(7)
    const libelles = wrapper.findAll('.bande-age-libelle').map((l) => l.text())
    expect(libelles[0]).toBe('Moins de 15 ans')
    expect(libelles[6]).toBe('80 ans et plus')
  })

  it('porte une lecture accessible hommes / femmes par tranche', () => {
    const wrapper = monter('composition', 'structure_age', 'demographie', '22001', {
      lignes: lignesSexuees(),
    })
    const aria = wrapper.find('.pyramide-age').attributes('aria-label') ?? ''
    expect(aria).toContain('Hommes')
    expect(aria).toContain('Femmes')
    expect(aria).toContain('Moins de 15 ans')
  })

  it('n’a PAS de puce de rang (composition multi-détail, comportement hérité)', () => {
    const wrapper = monter('composition', 'structure_age', 'demographie', '22001', {
      lignes: lignesSexuees(),
    })
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

  it('rend une année vide (jamais la clé brute) si labelsDetail est absent', () => {
    const wrapper = mount(FigureCompacte, {
      props: {
        famille: 'trajectory',
        clef: 'artif_par_habitant',
        lignes: lignes('milieux', 'artif_par_habitant', '22001'),
        libelle: 'artif_par_habitant',
        labelsDetail: undefined,
        theme: 'milieux',
      },
    })
    const annees = wrapper.findAll('.point-annee').map((a) => a.text())
    expect(annees.length).toBeGreaterThan(0)
    // sans métadonnée, l'année ne rend pas la clé brute (« 2021 » / « M2 »)
    for (const annee of annees) expect(annee).toBe('')
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
