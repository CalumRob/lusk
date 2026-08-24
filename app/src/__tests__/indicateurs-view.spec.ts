import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import IndicateursView from '../views/IndicateursView.vue'
import { routes } from '../router'
import {
  chargerAvec,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  indicateursProgrammesFixture,
  metadonneesThemesFixtures,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import type { Fichier } from '../payload/loader'

/**
 * La vue du catalogue /indicateurs (#409) : les thèmes canoniques et leurs
 * sous-groupes de fiche sont des RASSEMBLEMENTS (des titres — jamais des
 * liens ni des pages), les entrées sont les seules Pages d'indicateur
 * publiées, libellées par leur descripteur canon. Le seam est celui des vues
 * routées : le charger injecté (PAYLOAD_CHARGER_KEY) + un routeur mémoire.
 */

// Le fixture habitat ne publie aucune page (seul le payload réel en porte) —
// la vue est exercée sur un clone enrichi de DEUX descripteurs publiés, la
// couverture « every and only » complète vivant dans catalogue.spec × payload réel.
const habitatAvecPages = structuredClone(metadonneesThemesFixtures.habitat)
habitatAvecPages.indicator_pages = {
  distribution_dpe: {
    indicator: 'distribution_dpe',
    detail: null,
    label: 'Distribution des étiquettes DPE (A à G)',
    definition: 'Répartition des diagnostics par étiquette.',
    unit: '%',
    calculation: 'Part de chaque étiquette.',
    direction: 'low',
    caveats: 'Comparaison par la part de passoires.',
    levels: ['commune', 'epci', 'departement'],
    sources: ['dpe_22'],
    family: 'distribution',
    distribution: { signature: ['A', 'G'] },
  },
  prix_m2: {
    indicator: 'prix_m2',
    detail: null,
    label: 'Médiane prix au m²',
    definition: 'Prix médian déclaré au m².',
    unit: '€/m²',
    calculation: 'Médiane des ventes.',
    direction: 'high',
    caveats: 'Supprimée pour petites n.',
    levels: ['commune', 'epci', 'departement'],
    sources: ['dvf_2025_dep22'],
    family: 'scalar',
  },
}

const payload: Payload = {
  territoires: [],
  indicateurs: [
    ...indicateursDemographieFixture,
    ...indicateursHabitatFixture,
    ...indicateursProgrammesFixture,
  ],
  histoires: [],
  apercu: null,
  runReport: null,
  vintages: null,
  programmes: null,
  themeMetadata: {
    demographie: metadonneesThemesFixtures.demographie,
    habitat: habitatAvecPages,
    programmes: metadonneesThemesFixtures.programmes,
  },
}

async function monter(url = '/indicateurs') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(IndicateursView, {
    global: {
      plugins: [router],
      provide: {
        [PAYLOAD_CHARGER_KEY]: async (fichier: Fichier) => {
          void url
          return chargerAvec(payload)(fichier)
        },
      },
    },
  })
  await flushPromises()
  return { wrapper, router }
}

describe('IndicateursView — le catalogue groupé', () => {
  it('titre chaque thème présent dans l’ordre canonique avec son label payload-owned', async () => {
    const { wrapper } = await monter()
    const themesRendus = wrapper.findAll('[data-groupe-theme]').map((n) => n.attributes('data-groupe-theme'))
    // L'ordre CANONIQUE (mobilite → … → programmes), filtré aux thèmes publiés ;
    // Économie n'a aucune page → aucun groupe fantôme.
    expect(themesRendus).toEqual(['demographie', 'habitat', 'programmes'])
    expect(wrapper.text()).toContain('Démographie')
    expect(wrapper.text()).toContain('Programmes et subventions')
  })

  it('titre chaque sous-groupe de fiche sous son thème — un rassemblement, jamais un lien', async () => {
    const { wrapper } = await monter()
    // Les titres de rassemblement ne sont PAS des liens.
    for (const titre of wrapper.findAll('[data-groupe-sous-groupe]')) {
      expect(titre.element.tagName).not.toBe('A')
      expect(titre.find('a').exists()).toBe(false)
    }
    for (const titre of wrapper.findAll('[data-groupe-theme] h2')) {
      expect(titre.find('a').exists()).toBe(false)
    }
    // Le sous-groupe « couverture » (aucune page publiée) ne rend jamais un
    // titre vide ; ses faits sans page n'apparaissent pas.
    expect(wrapper.find('[data-groupe-sous-groupe="couverture"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Couverture programmatique')
  })

  it('liste chaque page publiée par son libellé canon, liée à sa route /indicateurs/:theme/:indicateur', async () => {
    const { wrapper, router } = await monter('/indicateurs/demographie/densite')
    void router
    const liens = wrapper.findAll('a[href^="/indicateurs/"]')
    const hrefs = liens.map((lien) => lien.attributes('href'))
    expect(hrefs).toContain('/indicateurs/demographie/densite')
    expect(hrefs).toContain('/indicateurs/habitat/distribution_dpe')
    expect(hrefs).toContain('/indicateurs/habitat/prix_m2')
    expect(hrefs).toContain('/indicateurs/programmes/subventions_annuelles')
    // Aucune entrée pour un fait sans page — la garde only-published à travers la vue.
    expect(hrefs.some((href) => href?.includes('couverture_programmes'))).toBe(false)
    expect(hrefs.some((href) => href?.includes('subventions_par_domaine'))).toBe(false)
    // Le libellé affiché est celui du descripteur, jamais la clé brute.
    const textes = liens.map((lien) => lien.text())
    expect(textes).toContain('Distribution des étiquettes DPE (A à G)')
    expect(textes.every((texte) => !/^[a-z_]+$/.test(texte.trim()))).toBe(true)
  })

  it('reste honnête pendant le chargement — l’état attend son wait-set', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(IndicateursView, {
      global: {
        plugins: [router],
        provide: {
          [PAYLOAD_CHARGER_KEY]: () => new Promise(() => {}),
        },
      },
    })
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
  })
})
