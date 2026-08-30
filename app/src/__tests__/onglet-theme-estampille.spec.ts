import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import OngletTheme from '../components/fiche/OngletTheme.vue'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  histoiresEconomieFixture,
  histoiresHabitatFixture,
  histoiresMobiliteFixture,
  histoiresMilieuxFixture,
  indicateursDemographieFixture,
  indicateursEconomieFixture,
  indicateursHabitatFixture,
  indicateursMobiliteFixture,
  indicateursMilieuxFixture,
  indicateursProgrammesFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload, Theme } from '../payload/types'

/**
 * L'estampille snapshot reste PROPRE À LA MOBILITÉ (issue #504, ADR-0012) —
 * le verrou transversal qui manquait. Le magasin de payload charge TOUS les
 * thèmes d'un coup : le fixture porte donc les SIX thèmes et chaque onglet
 * est monté sur LE MÊME payload multi-thèmes. Les specs mono-thème existants
 * ne pouvaient pas débusquer le défaut — leur payload ne contenait jamais un
 * autre thème à côté des faits du flagship (« Analyse calculée le … »),
 * si bien que chaque bloc de thème revendiquait l'horloge lente de Mobilité.
 */

/** Le payload EAGER du magasin réel : les six thèmes chargés ensemble. */
const payloadSixThemes: Payload = {
  territoires: territoiresFixture,
  indicateurs: [
    ...indicateursProgrammesFixture,
    ...indicateursDemographieFixture,
    ...indicateursHabitatFixture,
    ...indicateursEconomieFixture,
    ...indicateursMilieuxFixture,
    ...indicateursMobiliteFixture,
  ],
  histoires: [
    ...histoiresMobiliteFixture,
    ...histoiresDemographieFixture,
    ...histoiresHabitatFixture,
    ...histoiresEconomieFixture,
    ...histoiresMilieuxFixture,
  ],
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture, // porte la ligne mobilite_snapshot — le fait que chaque onglet s'appropriait
  programmes: null,
  themeMetadata: metadonneesThemesFixtures,
}

const LIBELLES_PAR_THEME: Array<[Theme, string]> = [
  ['demographie', 'Démographie'],
  ['habitat', 'Habitat'],
  ['economie', 'Économie/Emploi'],
  ['milieux', 'Milieux'],
  ['programmes', 'Programmes et subventions'],
]

async function monter(theme: Theme) {
  const wrapper = mount(OngletTheme, {
    props: { theme, payload: payloadSixThemes, territoire: '22001' },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  await flushPromises()
  return wrapper
}

describe("OngletTheme — l'estampille snapshot reste propre à la Mobilité (#504)", () => {
  it('se rend sur l’onglet Mobilité — même quand les six thèmes sont chargés', async () => {
    const wrapper = await monter('mobilite')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Mobilité')
    const estampille = wrapper.find('.estampille-snapshot')
    expect(estampille.exists()).toBe(true)
    expect(estampille.text()).toBe(
      'Analyse calculée le 6 août 2026 — se rafraîchit sur un rythme lent',
    )
  })

  it.each(LIBELLES_PAR_THEME)(
    'ne se rend PAS sur l’onglet %s — le bloc se rend, sans revendiquer l’horloge lente du flagship',
    async (theme, libelle) => {
      const wrapper = await monter(theme)

      // le bloc de thème se rend VRAIMENT — l'absence de l'estampille n'est
      // jamais vaine (l'overline publiée et au moins une figure de grille)
      expect(wrapper.find('.onglet-theme-overline').text()).toBe(libelle)
      expect(wrapper.findAll('.figure-indicateur').length).toBeGreaterThan(0)

      expect(wrapper.find('.estampille-snapshot').exists()).toBe(false)
    },
  )
})
