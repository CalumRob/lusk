import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import SourcesView from '../views/SourcesView.vue'
import { chargerAvec, histoiresHabitatFixture, histoiresMobiliteFixture, indicateursHabitatFixture, indicateursMobiliteFixture, metadonneesMobiliteRaccordementFixture, metadonneesThemesFixtures } from '../payload/fixtures'
import type { ChargerFichier } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { apercuAvecNAFixture, histoiresDemographieFixture, indicateursDemographieFixture, territoiresFixture, vintagesFixture } from '../payload/fixtures'
import { routes } from '../router'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'

const payload: Payload = { territoires: territoiresFixture, indicateurs: indicateursDemographieFixture, histoires: histoiresDemographieFixture, apercu: apercuAvecNAFixture, runReport: null, vintages: vintagesFixture, programmes: null }

function payloadAvecFichesSources(): Payload {
  const demographie = structuredClone(metadonneesThemesFixtures.demographie)
  demographie.source_records = {
    serie_historique: {
      dataset: 'Série historique', publisher: 'INSEE', url: null as unknown as string,
      licence: 'Licence ouverte', vintage: 'RP 2023', freshness: 'Publication annuelle',
      vintages: [{ id: 'serie_historique', label: 'Recensement', version: null, licence: null, dateReference: null, datePublication: null }],
      clocks: [{ name: 'Recensement', frequency: 'quinquennale', reference: 'INSEE' }],
    },
  }
  return { ...payload, themeMetadata: { ...metadonneesThemesFixtures, demographie } }
}

/**
 * #872 — le payload de la réconciliation navigation : la déclaration
 * raccordement (pages courantes + référence nommée sans page), les
 * déclarations d'accessibilité retirées du snapshot, la couverture
 * programmatique du sixième thème et le référentiel territorial.
 */
function payloadSourcesNavigation(): Payload {
  return {
    ...payloadAvecFichesSources(),
    themeMetadata: { ...metadonneesThemesFixtures, mobilite: metadonneesMobiliteRaccordementFixture },
    territoryMetadata: {
      schema_version: '1',
      territory_reference_label: 'Référentiel territorial — classes de densité communale',
      source_records: {
        classe_densite_communale: {
          dataset: 'Grille de densité 2025 — maille communale',
          publisher: 'INSEE',
          url: 'https://www.insee.fr/fr/statistiques/fichier/8571524/fichier_diffusion_2026.xlsx',
          licence: 'Licence Ouverte 2.0',
          vintage: 'Classification 2025 · géographie communale au 01/01/2026 · RP 2021',
          freshness: 'Publication INSEE du 15 mai 2026',
          vintages: [{
            id: 'classe_densite_communale',
            label: 'Grille de densité communale 2025',
            version: 'Classification 2025',
            licence: 'Licence Ouverte 2.0',
            dateReference: '2021-01-01',
            datePublication: '2026-05-15',
          }],
        },
      },
      density_classes: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), {
        code: String(index + 1),
        libelle_insee: `Classe INSEE ${index + 1}`,
        libelle_public: `Classe publique ${index + 1}`,
      }])),
    } as unknown as Payload['territoryMetadata'],
  }
}

async function monter(charger: ChargerFichier) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/sources')
  await router.isReady()
  const wrapper = mount(SourcesView, { global: { plugins: [router], provide: { [PAYLOAD_CHARGER_KEY]: charger } } })
  await flushPromises()
  return wrapper
}

describe('SourcesView — route dataset-centric', () => {
  it('charge seulement les références, les vintages et les fiches source, jamais les tables numériques', async () => {
    const requested: string[] = []
    const wrapper = await monter(async (fichier) => {
      requested.push(fichier)
      return chargerAvec(payloadAvecFichesSources())(fichier)
    })

    expect(wrapper.find('article.source-record').exists()).toBe(true)
    expect(wrapper.find('a[href="/indicateurs/demographie/densite"]').exists()).toBe(true)
    expect(requested).toContain('vintages')
    expect(requested).toContain('territoires-metadata')
    expect(requested).toContain('theme_demographie')
    expect(requested).not.toContain('territoires')
    expect(requested.some((fichier) => fichier.startsWith('indicateurs_'))).toBe(false)
    expect(requested.some((fichier) => fichier.startsWith('histoires_'))).toBe(false)
    expect(requested).not.toContain('apercu')
    expect(requested).not.toContain('programmes')
  })

  it('rend une fiche accessible, ses millésimes et les consommateurs canoniques', async () => {
    const wrapper = await monter(chargerAvec(payloadAvecFichesSources()))
    expect(wrapper.find('h1#sources-title').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Horloges de mise à jour"]').exists()).toBe(true)
    expect(wrapper.findAll('article.source-record').length).toBeGreaterThan(0)
    expect(wrapper.find('a[href^="https://"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/indicateurs/demographie/densite"]').exists()).toBe(true)
  })

  it('garde un état de chargement honnête', async () => {
    const wrapper = await monter(() => new Promise<Payload>(() => {}))
    expect(wrapper.find('[role="status"]').text()).toContain('Chargement')
  })

  it('applique le repli ADR-0022 aux jeux à fraîcheur partagée, mais garde les lignes OCS-GE', async () => {
    const habitatMetadata = JSON.parse(readFileSync(join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata', 'theme_habitat.json'), 'utf8'))
    const habitatPayload: Payload = {
      ...payload,
      indicateurs: [...payload.indicateurs, ...indicateursHabitatFixture],
      histoires: [...payload.histoires, ...histoiresHabitatFixture],
      themeMetadata: { ...metadonneesThemesFixtures, habitat: habitatMetadata },
    }
    const wrapper = await monter(chargerAvec(habitatPayload))
    const dvf = wrapper.find('#source-dvf')
    expect(dvf.exists()).toBe(true)
    expect(dvf.findAll('.source-record__vintages li')).toHaveLength(0)
    expect(dvf.text()).toContain('2021–2025')
  })

  it('rend la méthodologie portée par la fiche source', async () => {
    const mobiliteMetadata = structuredClone(metadonneesThemesFixtures.mobilite)
    mobiliteMetadata.source_records = {
      ...(mobiliteMetadata.source_records ?? {}),
      osm_reseaux: {
        dataset: 'OpenStreetMap',
        publisher: 'OpenStreetMap',
        url: 'https://www.openstreetmap.org',
        licence: 'ODbL',
        vintage: '2026-08',
        freshness: 'snapshot',
        methodology: {
          title: 'Estimation des places',
          summary: 'Une méthode portée par la source.',
          factors: [{ key: 'surface', label: 'Parking de surface', value: 26.70208, unit: 'm²/place' }],
          notes: ['Les places sont estimées.'],
        },
      },
    }
    const wrapper = await monter(chargerAvec({
      ...payload,
      indicateurs: [...payload.indicateurs, ...indicateursMobiliteFixture],
      histoires: [...payload.histoires, ...histoiresMobiliteFixture],
      themeMetadata: { ...metadonneesThemesFixtures, mobilite: mobiliteMetadata },
    }))

    const method = wrapper.find('.source-record__methodology')
    expect(method.exists()).toBe(true)
    expect(method.text()).toContain('Estimation des places')
    expect(method.text()).toContain('26,70208 m²/place')
  })

  it('ne lie que les pages courantes — une déclaration sans page ne fabrique jamais d’URL (#872)', async () => {
    const wrapper = await monter(chargerAvec(payloadSourcesNavigation()))

    // Les Pages d'indicateur courantes du catalogue partagé restent liées,
    // vers la route canonique de leur thème ressource.
    expect(wrapper.find('a[href="/indicateurs/mobilite/raccordement_tc"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/indicateurs/mobilite/raccordement_courbe"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/indicateurs/programmes/subventions_annuelles"]').exists()).toBe(true)

    // Les déclarations d'accessibilité retirées ne deviennent pas des liens.
    expect(wrapper.find('a[href="/indicateurs/mobilite/iso_alimentation"]').exists()).toBe(false)
    expect(wrapper.find('a[href="/indicateurs/mobilite/share_food_t"]').exists()).toBe(false)
    expect(wrapper.find('a[href="/indicateurs/mobilite/nb_buildings"]').exists()).toBe(false)

    // La référence nommée sans page et la couverture programmatique du
    // sixième thème restent des déclarations, pas des pages.
    expect(wrapper.find('a[href="/indicateurs/mobilite/raccordement_reference"]').exists()).toBe(false)
    expect(wrapper.find('a[href="/indicateurs/programmes/couverture_programmes"]').exists()).toBe(false)

    // Les déclarations restent représentées en texte, avec leur libellé producteur.
    const matrice = wrapper.find('#source-matrice-temps-mairies')
    expect(matrice.exists()).toBe(true)
    expect(matrice.text()).toContain('Référence médiane — commune bretonne')
    const snapshot = wrapper.find('#source-mobilite-snapshot')
    expect(snapshot.exists()).toBe(true)
    expect(snapshot.text()).toContain('Part des bâtiments sans accès à l’alimentation (à pied ou en transports en commun)')
    expect(wrapper.text()).toContain('Couverture programmatique')

    // Le référentiel territorial reste un consommateur non-indicateur sans lien.
    const referentiel = wrapper.find('#source-classe-densite-communale')
    expect(referentiel.exists()).toBe(true)
    expect(referentiel.text()).toContain('Référentiel territorial')
    expect(referentiel.find('a[href^="/indicateurs/"]').exists()).toBe(false)
  })

  it('garde les ancres, l’identité de jeu et les horloges indépendantes des sources liées (#872)', async () => {
    const wrapper = await monter(chargerAvec(payloadSourcesNavigation()))

    // L'ancre de la fiche, l'identité de jeu, l'éditeur, le millésime et les
    // horloges demeurent — la réconciliation ne retire que le lien mensonger.
    const matrice = wrapper.find('#source-matrice-temps-mairies')
    expect(matrice.text()).toContain('Lusk — matrice temps mairie à mairie du raccordement (routage r5r figé)')
    expect(matrice.text()).toContain('Éditeur : Lusk')
    expect(matrice.text()).toContain('2026-08')
    expect(matrice.text()).toContain('Le meilleur départ de la journée')

    const referentiel = wrapper.find('#source-classe-densite-communale')
    expect(referentiel.text()).toContain('Grille de densité 2025 — maille communale')
    expect(referentiel.text()).toContain('15 mai 2026')

    // La liste des consommateurs distingue la page courante (lien) de la
    // déclaration (texte) dans la même fiche.
    const liens = matrice.findAll('a[href^="/indicateurs/"]')
    expect(liens.map((lien) => lien.attributes('href'))).toEqual([
      '/indicateurs/mobilite/raccordement_tc',
      '/indicateurs/mobilite/raccordement_courbe',
    ])
  })

  it('marque visiblement les déclarations sans page courante, distinctes des pages liées (#872)', async () => {
    const wrapper = await monter(chargerAvec(payloadSourcesNavigation()))
    const matrice = wrapper.find('#source-matrice-temps-mairies')
    const consommateurs = matrice.findAll('.source-record__consumers li')
    expect(consommateurs).toHaveLength(3)

    // La référence nommée sans page : aucun lien, mais un cue VISIBLE qui la
    // reconnaît comme déclaration de source sans page d'indicateur courante —
    // jamais du texte nu indiscernable d'un consommateur de page.
    const reference = consommateurs.find((item) => item.text().includes('Référence médiane — commune bretonne'))!
    expect(reference.find('a').exists()).toBe(false)
    expect(reference.text()).toContain('Déclaration sans page d’indicateur courante')

    // Une page courante : le lien canonique, jamais le cue de déclaration.
    const page = consommateurs.find((item) => item.text().includes('Population bretonne joignable en 90 minutes en TC'))!
    expect(page.find('a[href="/indicateurs/mobilite/raccordement_tc"]').exists()).toBe(true)
    expect(page.text()).not.toContain('Déclaration sans page')

    // Les déclarations d'accessibilité retirées portent le MÊME cue générique,
    // dans la même liste — sans statut « retiré » inventé ni classification
    // gardée/historique : le wording couvre les deux sans présumer de la
    // disponibilité factuelle.
    const snapshot = wrapper.find('#source-mobilite-snapshot')
    const itemsSnapshot = snapshot.findAll('.source-record__consumers li')
    expect(itemsSnapshot.length).toBeGreaterThan(0)
    for (const item of itemsSnapshot) {
      expect(item.find('a').exists()).toBe(false)
      expect(item.text()).toContain('Déclaration sans page d’indicateur courante')
    }

    // La couverture programmatique du sixième thème : même cue générique.
    const acv = wrapper.findAll('article.source-record').find((fiche) => fiche.text().includes('Couverture programmatique'))
    expect(acv).toBeDefined()
    const couverture = acv!.findAll('.source-record__consumers li').find((item) => item.text().includes('Couverture programmatique'))!
    expect(couverture.find('a').exists()).toBe(false)
    expect(couverture.text()).toContain('Déclaration sans page d’indicateur courante')

    // Le référentiel territorial garde SON cue propre, jamais le cue de
    // déclaration — il n'est ni page ni déclaration d'indicateur.
    const referentiel = wrapper.find('#source-classe-densite-communale')
    const itemReferentiel = referentiel.findAll('.source-record__consumers li')
    expect(itemReferentiel).toHaveLength(1)
    expect(itemReferentiel[0]!.text()).toContain('Référentiel territorial')
    expect(itemReferentiel[0]!.text()).not.toContain('Déclaration sans page')
  })
})
