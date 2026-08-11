import { flushPromises, mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { afterEach, describe, expect, it } from 'vitest'

import CarteView from '../views/CarteView.vue'
import { COULEUR_CONTOUR, COULEUR_NEUTRE } from '../carte/couleurs'
import { echelleValeurs } from '../carte/seuils'
import { maplibreMock } from './setup'
import type { ChargerGeometrie } from '../geo/useGeometrie'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import type { Masques } from '../geo/types'
import {
  apercuFixture,
  chargerAvec,
  histoiresDemographieFixture,
  histoiresHabitatFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  membresProgrammesFixture,
  programmesLadderFixture,
  subventionsProgrammesFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { ChargerFichier } from '../payload/usePayload'
import type { Histoire, HistoireDemographie, Payload } from '../payload/types'
import { PayloadError } from '../payload/validate'
import { routes } from '../router'

/**
 * La carte interactive (/carte — layouts.md §3): the ThemeTabs subheader
 * (reused, ?theme= in the URL), the full-bleed MapExplorer + MapSidebar, and
 * the shell's states — skeleton, typed error with Retry, and the honest
 * « Fonds de carte indisponible. » when no mask file is published. ADR-0019:
 * ?theme= selects the theme's DEFAULT (story) layer — coucheParDefaut — and
 * the sidebar's layer clicks switch the map + legend (in-memory state).
 */

function feature(territoire: string, nom: string) {
  return {
    type: 'Feature' as const,
    properties: { territoire, nom, type: 'commune' as const },
    geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [0, 0]]] },
  }
}

const masquesCommunes: Masques = {
  communes: { type: 'FeatureCollection', features: [feature('22001', 'Commune A1')] },
  epcis: null,
  departements: null,
}

const masquesAbsents: Masques = { communes: null, epcis: null, departements: null }

/** Les trois niveaux de masque — pour exercer le level-native des couches
 *  programmes (adhésion commune vs EPCI, aucune au département). */
const masquesTroisNiveaux: Masques = {
  communes: {
    type: 'FeatureCollection',
    features: [feature('22001', 'Commune A1'), feature('22002', 'Commune D')],
  },
  epcis: { type: 'FeatureCollection', features: [feature('200000001', 'EPCI X')] },
  departements: { type: 'FeatureCollection', features: [feature('22', 'Département 22')] },
}

/** Les trois niveaux COMPLETS — les 4 communes, les 2 EPCIs et les 2
 *  départements du fixture : la couche par défaut de la Démographie
 *  (taux_solde_naturel) porte assez de valeurs à chaque niveau pour que les
 *  échelles commune / EPCI / toutes-lignes DIFFÈRENT (le test #294). */
const masquesNiveauxComplets: Masques = {
  communes: {
    type: 'FeatureCollection',
    features: [
      feature('22001', 'Commune A1'),
      feature('22002', 'Commune D'),
      feature('29001', 'Commune B'),
      feature('29002', 'Commune C'),
    ],
  },
  epcis: {
    type: 'FeatureCollection',
    features: [feature('200000001', 'EPCI X'), feature('200000002', 'EPCI Y')],
  },
  departements: {
    type: 'FeatureCollection',
    features: [feature('22', 'Département 22'), feature('29', 'Département 29')],
  },
}

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuFixture,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
}

/** Le payload avec l'onglet programmes — les lignes partagées + une ligne de
 *  subvention communale supplémentaire (22002) pour une légende lisible. */
const payloadProgrammes: Payload = {
  ...payload,
  programmes: {
    membres: membresProgrammesFixture,
    subventions: [
      ...subventionsProgrammesFixture,
      {
        territoire: '22002',
        type: 'commune',
        annee: 2025,
        programme_libl: null,
        montant: 12000,
        vintage_source: 'Région Bretagne — subventions attribuées (SCDL)',
        vintage_version: '2026-08-05',
        vintage_date_reference: '2026-08-05',
        vintage_date_publication: '2026-08-05',
      },
    ],
  },
}

function chargerPayloadAvec(p: Payload): ChargerFichier {
  return chargerAvec(p)
}

async function monter(overrides: {
  chargerPayload?: ChargerFichier
  chargerGeometrie?: ChargerGeometrie
  chemin?: string
} = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(overrides.chemin ?? '/carte')
  await router.isReady()
  const wrapper = mount(CarteView, {
    global: {
      plugins: [router],
      provide: {
        [PAYLOAD_CHARGER_KEY]: overrides.chargerPayload ?? chargerPayloadAvec(payload),
        [GEOMETRIE_CHARGER_KEY]: overrides.chargerGeometrie ?? (async () => masquesCommunes),
      },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

/** Monte la carte sur le payload programmes, sur les trois niveaux de masque
 *  (le level-native des couches d'adhésion s'exerce au changement de niveau). */
async function monterProgrammes(chemin: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(CarteView, {
    global: {
      plugins: [router],
      provide: {
        [PAYLOAD_CHARGER_KEY]: chargerPayloadAvec(payloadProgrammes),
        [GEOMETRIE_CHARGER_KEY]: async () => masquesTroisNiveaux,
      },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

describe('CarteView — les états (chargement / erreur / fond indisponible)', () => {
  it('shows a skeleton while the payload loads (chargement-gated)', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const { wrapper } = await monter({ chargerPayload: () => enAttente })

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.find('.squelette').exists()).toBe(true)
  })

  it('shows the typed error state with a Retry button for the payload', async () => {
    let appels = 0
    const charger: ChargerFichier = async (fichier) => {
      appels += 1
      if (appels === 1) throw new Error('Impossible de charger /data/territoires.json')
      return chargerAvec(payload)(fichier)
    }
    const { wrapper } = await monter({ chargerPayload: charger })

    expect(wrapper.find('.carte-etat--erreur').text()).toContain('Impossible de charger les données de la carte.')
    await wrapper.find('.carte-etat-bouton').trigger('click')
    await flushPromises()
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
  })

  it('shows the typed error state with a Retry button for the geometry', async () => {
    let appels = 0
    const charger: ChargerGeometrie = async () => {
      appels += 1
      if (appels === 1) throw new Error('ECONNREFUSED')
      return masquesCommunes
    }
    const { wrapper } = await monter({ chargerGeometrie: charger })

    expect(wrapper.find('.carte-etat--erreur').text()).toContain('Impossible de charger le fond de carte.')
    await wrapper.find('.carte-etat-bouton').trigger('click')
    await flushPromises()
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
  })

  it('shows the honest « Fonds de carte indisponible. » state when no mask is published', async () => {
    const { wrapper } = await monter({ chargerGeometrie: async () => masquesAbsents })

    expect(wrapper.text()).toContain('Fonds de carte indisponible.')
    expect(wrapper.find('.carte-etat-detail').text()).toContain('pas encore publiée')
  })
})

describe('CarteView — la carte avec fond publié', () => {
  it('renders the map + sidebar and the payload-driven ThemeTabs', async () => {
    const { wrapper } = await monter()

    expect(wrapper.findComponent({ name: 'MapExplorer' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MapSidebar' }).exists()).toBe(true)
    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets[0]).toBe('Programmes & financements')
    expect(onglets).toContain('Démographie')
  })

  it('the Aperçu tab (default) runs on the brand ramp and shows the mask-level legend', async () => {
    const { wrapper } = await monter()

    expect(wrapper.find('.carte--theme-apercu').exists()).toBe(true)
    expect(wrapper.find('.carte-legendes-masques').text()).toContain('Communes')
  })

  it('selecting a theme writes ?theme= and drives the legend with its default (story) layer', async () => {
    const { router, wrapper } = await monter()

    const demographie = wrapper.findAll('[role="tab"]').find((o) => o.text().includes('Démographie'))
    await demographie?.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.theme).toBe('demographie')
    // la couche par défaut du thème — le premier scalaire de Story (ADR-0019 α)
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Solde naturel (‰/an)')
    expect(wrapper.find('.carte--theme-demographie').exists()).toBe(true)
  })

  it('an absent ?theme= in the URL selects the theme when it is in the payload', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie' })

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Solde naturel (‰/an)')
  })

  it('the sidebar lists the theme’s layers — the default story layer active', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie' })

    const couches = wrapper.findAll('.carte-sidebar-couche').map((b) => b.text().trim())
    expect(couches[0]).toBe('Solde naturel (‰/an)')
    expect(couches).toContain('Densité de population')
    expect(couches).toContain('Moins de 15 ans')
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Solde naturel (‰/an)')
  })

  it('clicking a layer in the sidebar switches the map + legend (in-memory state)', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie' })

    const densite = wrapper
      .findAll('.carte-sidebar-couche')
      .find((b) => b.text().includes('Densité'))
    await densite?.trigger('click')
    await flushPromises()

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Densité de population')
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Densité de population')
  })

  it('first load (no ?theme=) is the neutral state — no layer, masks only', async () => {
    const { wrapper } = await monter()

    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(0)
    expect(wrapper.find('.carte-legendes-masques').text()).toContain("sans couche d'indicateurs")
    expect(wrapper.findComponent({ name: 'MapLegend' }).props('couche')).toBeNull()
  })

  it('an unknown ?theme= falls back to Aperçu', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=inconnu' })

    expect(wrapper.find('.carte--theme-apercu').exists()).toBe(true)
  })

  it('the layer controls only offer the published mask levels', async () => {
    const { wrapper } = await monter({ chargerGeometrie: async () => masquesCommunes })

    const boutons = wrapper.findAll('[role="radio"]').map((b) => b.text())
    expect(boutons).toEqual(['Communes'])
    expect(wrapper.find('.carte-sidebar-note').text()).toContain('sans géométrie sont indisponibles')
  })

  it('feeds the legend the map neutral rendering — map and legend share one source (issue #68)', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie' })

    const legende = wrapper.findComponent({ name: 'MapLegend' })
    expect(legende.props('couleurVide')).toBe(COULEUR_NEUTRE)
    expect(legende.props('couleurContour')).toBe(COULEUR_CONTOUR)
  })
})

describe('CarteView — l’onglet « Programmes & financements » (ADR-0019 #282)', () => {
  it('le premier onglet de la carte lit « Programmes & financements » (l’Aperçu de la fiche reste intact)', async () => {
    const { wrapper } = await monter()

    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets[0]).toBe('Programmes & financements')
    expect(onglets).toContain('Démographie')
  })

  it('?onglet=programmes active la couche subventions par défaut — légende € et couches programmes dans la sidebar', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes')

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
    expect(wrapper.find('.carte-legendes-unite').text()).toContain('€')
    const couches = wrapper.findAll('.carte-sidebar-couche').map((b) => b.text().trim())
    expect(couches).toEqual(['ACV', 'PVD', 'ORT', 'Subventions totales'])
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Subventions totales')
  })

  it('?onglet=programmes&programme=ACV rend la légende catégorielle d’adhésion et marque ACV active', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes&programme=ACV')

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('ACV')
    expect(wrapper.find('.carte-legendes-gamme').text()).toContain('Membre du programme')
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('ACV')
  })

  it('cliquer le premier onglet écrit ?onglet=programmes (l’état de la carte, pas un Aperçu vide)', async () => {
    const { router, wrapper } = await monterProgrammes('/carte')

    await wrapper.findAll('[role="tab"]')[0].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.onglet).toBe('programmes')
    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
  })

  it('sélectionner un thème efface ?onglet=programmes (l’exclusion mutuelle de l’ADR-0019)', async () => {
    const { router, wrapper } = await monterProgrammes('/carte?onglet=programmes')

    const demographie = wrapper.findAll('[role="tab"]').find((o) => o.text().includes('Démographie'))
    await demographie?.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.theme).toBe('demographie')
    expect(router.currentRoute.value.query.onglet).toBeUndefined()
  })

  it('?theme= ET ?onglet=programmes ensemble → l’onglet gagne, le thème est nettoyé', async () => {
    const { router, wrapper } = await monterProgrammes('/carte?theme=demographie&onglet=programmes')

    expect(router.currentRoute.value.query.onglet).toBe('programmes')
    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
  })

  it('?onglet=programmes&programme=INCONNU → la couche par défaut et le sigle inconnu nettoyé', async () => {
    const { router, wrapper } = await monterProgrammes('/carte?onglet=programmes&programme=INCONNU')

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
    expect(router.currentRoute.value.query.programme).toBeUndefined()
  })

  it('?onglet=inconnu → l’état neutre (aucune couche, la note des masques)', async () => {
    const { router, wrapper } = await monterProgrammes('/carte?onglet=inconnu')

    expect(router.currentRoute.value.query.onglet).toBeUndefined()
    expect(wrapper.find('.carte-legendes-masques').text()).toContain("sans couche d'indicateurs")
  })

  it('?programme=ACV sans ?onglet= → l’état neutre (un sigle hors onglet n’est pas un état)', async () => {
    const { router, wrapper } = await monterProgrammes('/carte?programme=ACV')

    expect(router.currentRoute.value.query.programme).toBeUndefined()
    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(0)
  })

  it('?onglet=programmes sans payload programmes (404 = élément absent) → l’état vide honnête', async () => {
    const { wrapper } = await monter({ chemin: '/carte?onglet=programmes' })

    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(0)
    expect(wrapper.find('.carte-legendes-masques').exists()).toBe(true)
  })

  it('au niveau EPCI, les couches d’adhésion EPCI (CRTE · Territoires d’industrie · ORT)', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes')

    const boutons = wrapper.findAll('[role="radio"]')
    await boutons[1].trigger('click')
    await flushPromises()

    const couches = wrapper.findAll('.carte-sidebar-couche').map((b) => b.text().trim())
    expect(couches).toEqual(['CRTE', "Territoires d'industrie", 'ORT', 'Subventions totales'])
  })

  it('au niveau département, AUCUNE couche d’adhésion — l’absence honnête, les subventions seules', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes')

    const boutons = wrapper.findAll('[role="radio"]')
    await boutons[2].trigger('click')
    await flushPromises()

    const couches = wrapper.findAll('.carte-sidebar-couche').map((b) => b.text().trim())
    expect(couches).toEqual(['Subventions totales'])
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
  })

  it('la légende des subventions reste niveau-scopée au passage à l’EPCI (#294) — les valeurs EPCI seules', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes')

    const boutons = wrapper.findAll('[role="radio"]')
    await boutons[1].trigger('click')
    await flushPromises()

    const valeursEpci = subventionsProgrammesFixture
      .filter((s) => s.type === 'epci')
      .map((s) => s.montant)
    expect(wrapper.findComponent({ name: 'MapLegend' }).props('seuils')).toEqual(
      echelleValeurs(valeursEpci).seuils,
    )
  })

  it('ORT se re-joint au changement de niveau (ADR-0019) — ?programme=ORT reste actif de la commune à l’EPCI', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes&programme=ORT')

    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('ORT')

    const boutons = wrapper.findAll('[role="radio"]')
    await boutons[1].trigger('click')
    await flushPromises()

    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('ORT')
  })

  it('?programme=ACV au passage vers l’EPCI retombe sur les subventions (aucune ligne ACV EPCI — jamais inventée)', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes&programme=ACV')

    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('ACV')

    const boutons = wrapper.findAll('[role="radio"]')
    await boutons[1].trigger('click')
    await flushPromises()

    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Subventions totales')
  })

  it('cliquer une couche d’adhésion dans la sidebar écrit ?onglet=programmes&programme=<sigle> (partageable)', async () => {
    const { router, wrapper } = await monterProgrammes('/carte?onglet=programmes')

    const pvd = wrapper.findAll('.carte-sidebar-couche').find((b) => b.text().trim() === 'PVD')
    await pvd?.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ onglet: 'programmes', programme: 'PVD' })
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('PVD')
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('PVD')
  })

  it('?onglet=programmes&programme=ACV survit au rechargement (l’état est l’URL)', async () => {
    const premier = await monterProgrammes('/carte?onglet=programmes&programme=ACV')
    expect(premier.wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('ACV')
    premier.wrapper.unmount()

    const second = await monterProgrammes('/carte?onglet=programmes&programme=ACV')
    expect(second.wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('ACV')
    expect(second.wrapper.find('.carte-legendes-titre').text()).toBe('ACV')
  })
})

describe('CarteView — la légende suit l’échelle du niveau actif (ADR-0019, #294)', () => {
  it('au niveau EPCI, les seuils de la légende viennent des valeurs EPCI — pas de toutes les lignes mélangées', async () => {
    const { wrapper } = await monter({
      chemin: '/carte?theme=demographie',
      chargerGeometrie: async () => masquesNiveauxComplets,
    })

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Solde naturel (‰/an)')

    const estDemographie = (h: Histoire): h is HistoireDemographie => h.theme === 'demographie'
    const valeursDuNiveau = (type: string) =>
      histoiresDemographieFixture
        .filter((h): h is HistoireDemographie => h.type === type && estDemographie(h))
        .map((h) => h.taux_solde_naturel)
    const toutesLignes = histoiresDemographieFixture.filter(estDemographie).map((h) => h.taux_solde_naturel)

    expect(wrapper.findComponent({ name: 'MapLegend' }).props('seuils')).toEqual(
      echelleValeurs(valeursDuNiveau('commune')).seuils,
    )

    const boutons = wrapper.findAll('[role="radio"]')
    await boutons[1].trigger('click')
    await flushPromises()

    const legende = wrapper.findComponent({ name: 'MapLegend' })
    expect(legende.props('seuils')).toEqual(echelleValeurs(valeursDuNiveau('epci')).seuils)
    expect(legende.props('seuils')).not.toEqual(echelleValeurs(toutesLignes).seuils)
  })
})

describe('CarteView — la recherche zoome sur l’entité (ADR-0019, #283)', () => {
  it('la recherche de la sidebar est sans navigation et son sélect remonte jusqu’à la carte', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie' })

    const sidebar = wrapper.findComponent({ name: 'MapSidebar' })
    const recherche = sidebar.findComponent({ name: 'GlobalSearchBar' })
    expect(recherche.props('sansNavigation')).toBe(true)

    const epciX = territoiresFixture.find((t) => t.territoire === '200000001')
    recherche.vm.$emit('select', epciX)
    await flushPromises()

    const explorateur = wrapper.findComponent({ name: 'MapExplorer' })
    expect(explorateur.props('territoireCible')).toEqual(epciX)
    expect(explorateur.props('requeteZoom')).toBe(1)
  })

  it('bascule le niveau sur celui de l’entité cherchée (un EPCI cherché depuis les communes)', async () => {
    const { wrapper } = await monter({
      chemin: '/carte?theme=demographie',
      chargerGeometrie: async () => masquesTroisNiveaux,
    })

    const sidebar = wrapper.findComponent({ name: 'MapSidebar' })
    expect(sidebar.props('niveau')).toBe('communes')

    const epciX = territoiresFixture.find((t) => t.territoire === '200000001')
    sidebar.findComponent({ name: 'GlobalSearchBar' }).vm.$emit('select', epciX)
    await flushPromises()

    expect(sidebar.props('niveau')).toBe('epcis')
    expect(wrapper.findComponent({ name: 'MapExplorer' }).props('territoireCible')).toEqual(epciX)
  })

  it('une entité au niveau affiché ne change pas de niveau et la carte ouvre son popup', async () => {
    const { wrapper } = await monter({
      chemin: '/carte?theme=demographie',
      chargerGeometrie: async () => masquesTroisNiveaux,
    })

    const sidebar = wrapper.findComponent({ name: 'MapSidebar' })
    const communeA1 = territoiresFixture.find((t) => t.territoire === '22001')
    sidebar.findComponent({ name: 'GlobalSearchBar' }).vm.$emit('select', communeA1)
    await flushPromises()

    expect(sidebar.props('niveau')).toBe('communes')
    const popup = maplibreMock.instancesPopups.at(-1)
    expect(popup?.contenu).toContain('Commune A1')
    expect(popup?.contenu).toContain('Voir la fiche')
  })
})

describe('CarteView — la carte neutre d’abord (T7, #303 — le wait-set de la carte)', () => {
  /** Le payload avec l’habitat en plus — la paire d’arrière-plan en échec
   *  devient observable (son onglet aurait rendu sinon). */
  const payloadDeuxThemes: Payload = {
    ...payload,
    indicateurs: [...indicateursDemographieFixture, ...indicateursHabitatFixture],
    histoires: [...histoiresDemographieFixture, ...histoiresHabitatFixture],
  }

  it('rend la carte neutre dès que territoires + run-report se règlent, toutes les paires de thèmes encore pendantes', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const charger: ChargerFichier = async (fichier) => {
      if (fichier.startsWith('indicateurs_') || fichier.startsWith('histoires_')) return enAttente
      return chargerAvec(payload)(fichier)
    }
    const { wrapper } = await monter({ chargerPayload: charger })

    // Le wait-set de la carte est réglé → pas de squelette, la carte vit.
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MapExplorer' }).exists()).toBe(true)
    // Aucun onglet de thème (les paires pendent) — le premier onglet seul.
    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual(['Programmes & financements'])
    // L'état neutre honnête : masques seuls, aucune couche d'indicateurs.
    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(0)
    expect(wrapper.find('.carte-legendes-masques').text()).toContain("sans couche d'indicateurs")
  })

  it('le changement de niveau fonctionne dans l’état neutre (communes/epcis/departements)', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const charger: ChargerFichier = async (fichier) => {
      if (fichier.startsWith('indicateurs_') || fichier.startsWith('histoires_')) return enAttente
      return chargerAvec(payload)(fichier)
    }
    const { wrapper } = await monter({
      chargerPayload: charger,
      chargerGeometrie: async () => masquesTroisNiveaux,
    })

    const boutons = wrapper.findAll('[role="radio"]')
    expect(boutons.map((b) => b.text())).toEqual(['Communes', 'EPCI', 'Départements'])
    await boutons[1].trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'MapSidebar' }).props('niveau')).toBe('epcis')
    expect(wrapper.findComponent({ name: 'MapExplorer' }).props('niveau')).toBe('epcis')
  })

  it('la popup de l’état neutre donne le nom et le lien « Voir la fiche »', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const charger: ChargerFichier = async (fichier) => {
      if (fichier.startsWith('indicateurs_') || fichier.startsWith('histoires_')) return enAttente
      return chargerAvec(payload)(fichier)
    }
    await monter({ chargerPayload: charger })

    const carte = maplibreMock.instancesCarteMaple.at(-1)
    carte?.fire('load')
    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [{ properties: { territoire: '22001' } }] as never
    carte?.fire('click', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })

    const popup = maplibreMock.instancesPopups.at(-1)
    expect(popup?.contenu).toContain('Commune A1')
    expect(popup?.contenu).toContain('Voir la fiche')
  })

  it('la liste de couches se remplit progressivement — une couche n’est rendue que quand SA paire atterrit, l’URL ?theme= conservée', async () => {
    let resoudreIndicateurs: (v: unknown) => void = () => {}
    let resoudreHistoires: (v: unknown) => void = () => {}
    const indicateursEnAttente = new Promise<unknown>((resoudre) => {
      resoudreIndicateurs = resoudre
    })
    const histoiresEnAttente = new Promise<unknown>((resoudre) => {
      resoudreHistoires = resoudre
    })
    const charger: ChargerFichier = async (fichier) => {
      if (fichier === 'indicateurs_demographie') return indicateursEnAttente
      if (fichier === 'histoires_demographie') return histoiresEnAttente
      return chargerAvec(payload)(fichier)
    }
    const { router, wrapper } = await monter({
      chemin: '/carte?theme=demographie',
      chargerPayload: charger,
    })

    // Le thème demandé pend encore → l'état neutre honnête, l'URL CONSERVÉE
    // (la normalisation ne réécrit pas un thème valide en vol).
    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(0)
    expect(wrapper.find('.carte-legendes-masques').text()).toContain("sans couche d'indicateurs")
    expect(router.currentRoute.value.query.theme).toBe('demographie')

    // La paire atterrit → la couche par défaut du thème (le premier scalaire
    // de Story) rend, sans rechargement de la page.
    resoudreIndicateurs(indicateursDemographieFixture)
    resoudreHistoires(histoiresDemographieFixture)
    await flushPromises()

    expect(router.currentRoute.value.query.theme).toBe('demographie')
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Solde naturel (‰/an)')
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Solde naturel (‰/an)')
  })

  it('le groupe de couches « Programmes & financements » apparaît quand programmes atterrit (arrière-plan)', async () => {
    let resoudreProgrammes: (v: unknown) => void = () => {}
    const programmesEnAttente = new Promise<unknown>((resoudre) => {
      resoudreProgrammes = resoudre
    })
    const charger: ChargerFichier = async (fichier) => {
      if (fichier === 'programmes') return programmesEnAttente
      return chargerAvec(payload)(fichier)
    }
    const { wrapper } = await monter({
      chemin: '/carte?onglet=programmes',
      chargerPayload: charger,
    })

    // programmes pend → l'état vide honnête, la carte vivante.
    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(0)
    expect(wrapper.find('.carte-legendes-masques').exists()).toBe(true)

    resoudreProgrammes(programmesLadderFixture)
    await flushPromises()

    // Le groupe apparaît — les subventions par défaut, les adhésions du niveau.
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(4)
  })

  it('une paire de thème d’arrière-plan en échec → ses couches absentes, la carte vivante, aucune erreur de page', async () => {
    const charger: ChargerFichier = async (fichier) => {
      if (fichier === 'indicateurs_habitat' || fichier === 'histoires_habitat') {
        throw new PayloadError('fetch', `${fichier}.json`, 'réseau')
      }
      return chargerAvec(payloadDeuxThemes)(fichier)
    }
    const { wrapper } = await monter({ chargerPayload: charger })

    // Aucune erreur de page — la carte vit, l'onglet habitat simplement absent
    // (l'absence honnête, jamais une erreur).
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MapExplorer' }).exists()).toBe(true)
    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual(['Programmes & financements', 'Démographie'])
  })

  it('garde l’URL ?theme= demandée quand le wait-set échoue — Retry la remet debout sans normalisation prématurée', async () => {
    let territoiresEchoue = true
    const charger: ChargerFichier = async (fichier) => {
      if (fichier === 'territoires' && territoiresEchoue) {
        territoiresEchoue = false
        throw new PayloadError('fetch', 'territoires.json', 'réseau')
      }
      return chargerAvec(payload)(fichier)
    }
    const { router, wrapper } = await monter({
      chemin: '/carte?theme=demographie',
      chargerPayload: charger,
    })

    // Le wait-set a échoué → l'erreur typée + Retry, l'URL demandée conservée
    // (un échec n'est pas une absence — Retry a son mot à dire).
    expect(wrapper.find('.carte-etat--erreur').text()).toContain(
      'Impossible de charger les données de la carte.',
    )
    expect(router.currentRoute.value.query.theme).toBe('demographie')

    await wrapper.find('.carte-etat-bouton').trigger('click')
    await flushPromises()

    // Retry ne refetch que l'échoué → la carte remonte, le thème demandé rend.
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
    expect(router.currentRoute.value.query.theme).toBe('demographie')
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Solde naturel (‰/an)')
  })

  it('un thème non canonique demandé est nettoyé de l’URL (la normalisation d’avant, toujours en vie)', async () => {
    const { router, wrapper } = await monter({ chemin: '/carte?theme=bidule' })

    await flushPromises()
    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.find('.carte--theme-apercu').exists()).toBe(true)
  })
})

afterEach(() => {
  maplibreMock.instancesCarteMaple.length = 0
  maplibreMock.instancesPopups.length = 0
})
