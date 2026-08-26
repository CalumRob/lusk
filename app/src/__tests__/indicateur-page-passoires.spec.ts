import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Les montures ROUTÉES ci-dessous lisent le VRAI payload habitat (~9 000
// lignes validées au premier chargement) : sous charge parallèle le premier
// monture dépasse parfois le timeout par défaut — le même flake #185 que
// payload-contract. On relève le plafond du fichier, jamais les verrous.
vi.setConfig({ testTimeout: 30_000 })

import IndicateurView from '../views/IndicateurView.vue'
import { chargerFichier } from '../payload/loader'
import type { ChargerOptions, Fichier, ReponseFetch } from '../payload/loader'
import type { Territoire } from '../payload/types'
import { routes } from '../router'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { normalizeComparisonFacet } from '../indicateurs/familySeam'
import { formaterValeur } from '../payload/selectors'

/**
 * #474 — séparer DPE et passoires : DEUX Pages d'indicateur indépendantes.
 *
 *  - `part_passoires` devient SA propre page scalaire (descripteur déclaré par
 *    la convention, facette = elle-même) — verrouillé contre les DEUX miroirs
 *    du canon (épinglé pipeline + snapshot public) ;
 *  - `distribution_dpe` ne présente PLUS de héros médian scalaire : Repères
 *    montre la signature A–G du territoire face à l'ENSEMBLE DE COMPARAISON —
 *    le profil agrégé de tous les territoires du périmètre actif, étiqueté
 *    comme une vue d'ensemble, JAMAIS comme un autre territoire ;
 *  - la facette résumée déclarée (part_passoires) pilote TOUJOURS la carte,
 *    les extrêmes et le tableau via le résolveur partagé.
 *
 * Tests ROUTÉS contre le VRAI payload committé (public/data/, lu par le
 * chargeur réel et ses validateurs) ; les profils agrégés attendus sont
 * recalculés ici depuis le JSON brut (double saisie).
 */

const racinePublic = join(process.cwd(), '..', 'public', 'data')
const canonEpingle = join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata', 'theme_habitat.json')

interface PageHabitatBrute {
  indicator: string
  label: string
  definition: string
  unit: string
  calculation: string
  direction: string
  caveats: string
  levels: string[]
  sources: string[]
  family?: string
  comparison?: { indicator?: string; label?: string; unit?: string; direction?: string }
}

const canonHabitat = JSON.parse(readFileSync(canonEpingle, 'utf8')) as { indicator_pages: Record<string, PageHabitatBrute> }
const publicHabitat = JSON.parse(readFileSync(join(racinePublic, 'theme_habitat.json'), 'utf8')) as { indicator_pages: Record<string, PageHabitatBrute> }
const faitsHabitat = JSON.parse(readFileSync(join(racinePublic, 'indicateurs_habitat.json'), 'utf8')) as Array<{ territoire: string; type: string; key: string; detail: string | null; value: number | null; unit: string }>
const territoiresRef = JSON.parse(readFileSync(join(racinePublic, 'territoires.json'), 'utf8')) as Array<{ territoire: string; nom: string; departement: string | null }>

/** La moyenne des parts publiées d'un détail DPE dans un périmètre de communes. */
function moyenneDetail(detail: string, communes?: ReadonlySet<string>): { moyenne: number | null; n: number } {
  const lignes = faitsHabitat.filter((f) => f.key === 'distribution_dpe' && f.detail === detail && f.type === 'commune' && f.value !== null && (!communes || communes.has(f.territoire)))
  if (lignes.length === 0) return { moyenne: null, n: 0 }
  return { moyenne: lignes.reduce((s, f) => s + (f.value as number), 0) / lignes.length, n: lignes.length }
}

const DETAILS_DPE = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const

describe('descripteur part_passoires — miroir épinglé × snapshot public (#474)', () => {
  it('déclare la page scalaire dans le canon ÉPINGLÉ et le snapshot PUBLIC, identiques', () => {
    for (const [origine, meta] of [['canon épinglé', canonHabitat], ['snapshot public', publicHabitat]] as const) {
      const page = meta.indicator_pages.part_passoires
      expect(page, origine).toBeDefined()
      expect(page!.family, origine).toBe('scalar')
      expect(page!.label, origine).toBe('Part de passoires thermiques')
      expect(page!.unit, origine).toBe('%')
      expect(page!.direction, origine).toBe('low')
      expect(page!.definition.length, origine).toBeGreaterThan(0)
      expect(page!.calculation.length, origine).toBeGreaterThan(0)
      expect(page!.caveats.length, origine).toBeGreaterThan(0)
      expect(page!.levels, origine).toEqual(['commune', 'epci', 'departement'])
      expect(page!.sources, origine).toContain('dpe_22')
      // La facette = ELLE-MÊME : déclarée explicitement (jamais une autre clé).
      expect(page!.comparison, origine).toMatchObject({ indicator: 'part_passoires', label: 'Part de passoires thermiques', unit: '%', direction: 'low' })
    }
    expect(canonHabitat.indicator_pages.part_passoires).toEqual(publicHabitat.indicator_pages.part_passoires)
  })

  it('verrouille l’énumération habitat : SEPT pages publiées, chacune une fois (#474 — le changement de compte)', () => {
    const attendues = ['age_du_bati', 'distribution_dpe', 'mix_logements', 'part_passoires', 'prix_m2', 'statut', 'type']
    expect(Object.keys(publicHabitat.indicator_pages).sort()).toEqual(attendues)
  })

  it('résout la facette de la page scalaire sur ELLE-MÊME via le résolveur partagé', () => {
    // Le même objet que le loader valide (la forme discriminée après normalisation).
    const page = { ...publicHabitat.indicator_pages.part_passoires!, family: 'scalar' } as Parameters<typeof normalizeComparisonFacet>[0]
    const facette = normalizeComparisonFacet(page, {}, 'habitat')
    expect(facette.indicator).toBe('part_passoires')
    expect(facette.label).toBe('Part de passoires thermiques')
    expect(facette.unit).toBe('%')
    expect(facette.direction).toBe('low')
    expect(facette.valid).toBe(true)
  })
})

// ---------------------------------------------------------------------
// Le harnais ROUTÉ : le chargeur PAR FICHIER réel lit le payload COMMITTÉ.
// ---------------------------------------------------------------------

const fetchReel = async (url: string): Promise<ReponseFetch> => {
  try {
    const corps = readFileSync(join(racinePublic, url.replace(/^\/data\//, '')), 'utf8')
    return { ok: true, status: 200, json: async () => JSON.parse(corps) }
  } catch {
    return { ok: false, status: 404, json: async () => null }
  }
}

const chargerElargi = chargerFichier as unknown as (
  nom: Fichier,
  territoiresOuOptions?: Territoire[] | ChargerOptions,
  options?: ChargerOptions,
) => Promise<unknown>

const SANS_REFERENCE = (fichier: Fichier) =>
  fichier === 'territoires' || fichier === 'run-report' || fichier === 'vintages' || fichier.startsWith('theme_')

const cache = new Map<Fichier, Promise<unknown>>()
let territoiresValides: Territoire[] | null = null
function chargerCommis(fichier: Fichier): Promise<unknown> {
  const options = { fetchImpl: fetchReel }
  if (!cache.has(fichier)) {
    const promesse = (
      SANS_REFERENCE(fichier)
        ? chargerElargi(fichier, options)
        : (async () => {
            territoiresValides ??= (await chargerElargi('territoires', options)) as Territoire[]
            return chargerElargi(fichier, territoiresValides, options)
          })()
    ).catch((cause: unknown) => {
      cache.delete(fichier)
      throw cause
    })
    cache.set(fichier, promesse)
  }
  return cache.get(fichier)!
}

async function monter(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(url)
  await router.isReady()
  const empty = { type: 'FeatureCollection' as const, features: [] }
  const wrapper = mount(IndicateurView, {
    global: {
      plugins: [router],
      provide: {
        [PAYLOAD_CHARGER_KEY]: chargerCommis,
        [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
      },
      stubs: {
        MapExplorer: {
          props: ['payload', 'activeIds', 'niveau', 'territoireCible', 'couche'],
          template: '<div data-testid="map" :data-clef="couche?.clef" :data-niveau="niveau" :data-selected="territoireCible?.territoire" :data-values="activeIds.join(\',\')" />',
        },
      },
    },
  })
  await flushPromises()
  return wrapper
}

function ligneDuTableau(wrapper: ReturnType<typeof mount>, territoire: string) {
  const ligne = wrapper.findAll('tbody tr').find((tr) => tr.find(`a[href*="${territoire}"]`).exists())
  expect(ligne, `ligne ${territoire}`).toBeDefined()
  return ligne!
}

beforeEach(() => localStorage.clear())

describe('page scalaire part_passoires — rendu routé (#474)', () => {
  it('rend le héros médian, les extrêmes et le tableau pilotés par sa facette (elle-même)', async () => {
    const wrapper = await monter('/indicateurs/habitat/part_passoires?territoire=22001')
    expect(wrapper.find('h1').text()).toBe('Part de passoires thermiques')
    // La page SCALAIRE garde son héros médian — la médiane communale vaut 15 %.
    expect(wrapper.find('.median').exists()).toBe(true)
    expect(wrapper.find('.median strong').text()).toBe('15 %')
    expect(wrapper.find('.median p').text()).toBe('Bretagne')
    // Extrêmes : Chantepie (min 0,97…→ 1 %) / Hémonstoir (max 56 %).
    const extremes = wrapper.findAll('.extremes article')
    expect(extremes[0]!.text()).toContain('56 %')
    expect(extremes[1]!.text()).toContain('Chantepie')
    expect(extremes[1]!.text()).toContain('· 1 %')
    // Tableau : la ligne 22001 lit sa part en pourcentage.
    expect(ligneDuTableau(wrapper, '22001').findAll('td')[1]!.text()).toBe('13 %')
    // La direction déclarée est low — « moins = mieux », jamais un défaut silencieux.
    expect(wrapper.text()).toContain('moins = mieux')
  })

  it('dit l’absence honnêtement : la page se dit partielle et aucun zéro n’est inventé pour les territoires sans DPE', async () => {
    const wrapper = await monter('/indicateurs/habitat/part_passoires')
    // 65 communes sans donnée DPE → l'état incomplet s'affiche, jamais un zéro inventé.
    expect(wrapper.text()).toContain('Repères partiels : certaines valeurs sont indisponibles.')
    // Île-de-Bréhat (22016) n'est PAS classée sans valeur : ni ligne de tableau,
    // ni extrême — l'absence reste une absence, jamais un 0 % fabriqué.
    expect(wrapper.find('a[href*="territoire/commune/22016"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Île-de-Bréhat')
  })

  it('distribution_dpe : le territoire sans DPE lit une absence déclarée, l’ensemble de comparaison reste rendu', async () => {
    // Berhet (22006) : DPE supprimé sous le seuil — la signature le DIT.
    const wrapper = await monter('/indicateurs/habitat/distribution_dpe?territoire=22006')
    const signature = wrapper.find('[data-testid="signature-distribution"]')
    expect(signature.text()).toContain('Berhet : distribution incomplète ou supprimée à ce niveau.')
    // L'ensemble de comparaison, lui, ne dépend d'aucune sélection : il reste.
    const ensemble = wrapper.find('[data-testid="ensemble-comparaison"]')
    expect(ensemble.exists()).toBe(true)
    expect(ensemble.attributes('data-portee')).toBe('Bretagne')
    for (const detail of DETAILS_DPE) {
      const { moyenne } = moyenneDetail(detail)
      expect(ensemble.find(`[data-detail="${detail}"]`).text()).toContain(formaterValeur({ value: moyenne, unit: '%' }))
    }
  })
})

describe('page distribution_dpe — profil contre ensemble de comparaison (#474)', () => {
  it('ne présente PLUS de héros médian scalaire — note de contexte (#472) et ensemble de comparaison (#474) coexistent', async () => {
    const wrapper = await monter('/indicateurs/habitat/distribution_dpe?territoire=22001')
    expect(wrapper.find('.hero').exists()).toBe(false)
    expect(wrapper.find('.median').exists()).toBe(false)
    // La note de contexte permanente (#472), rendue AUSSI sur la distribution :
    // elle vit au-dessus des vues, indépendante du sort du héros médian.
    const note = wrapper.find('[data-testid="note-contexte"]')
    expect(note.exists()).toBe(true)
    expect(note.text()).toContain('Allineuc')
    // La signature A–G du territoire sélectionné reste rendue ×100, une fois.
    const attendus = { A: '1 %', B: '3 %', C: '46 %', D: '28 %', E: '9 %', F: '6 %', G: '8 %' }
    for (const [detail, libelle] of Object.entries(attendus)) {
      const barre = wrapper.find(`[data-testid="signature-distribution"] [data-detail="${detail}"]`)
      expect(barre.exists(), `étiquette ${detail}`).toBe(true)
      expect(barre.text()).toContain(libelle)
    }
  })

  it('composition (#472) : la préservation d’URL du watcher (#474) garde note et contextualisation au bon périmètre', async () => {
    // Périmètre départemental VALIDE demandé au chargement : le correctif #474
    // du watcher l'empêche d'être strippé pendant la fenêtre de chargement —
    // la note ET l'univers de la contextualisation composition (figcaption)
    // le reflètent alors tous les deux, jamais un repli silencieux sur Bretagne.
    const wrapper = await monter('/indicateurs/habitat/mix_logements?niveau=commune&departement=22&territoire=22001')
    expect(wrapper.find('[data-testid="note-contexte"]').text()).toContain("département Côtes-d'Armor")
    const rendu = wrapper.find('figure.composition-renderer')
    expect(rendu.exists()).toBe(true)
    expect(rendu.find('[data-testid="composition-contextualisee"]').exists()).toBe(true)
    expect(rendu.text()).toContain("Côtes-d'Armor")
    expect(rendu.find('figcaption').text()).not.toContain('Bretagne')
  })

  it('montre l’ensemble de comparaison : la moyenne des parts A–G de TOUS les territoires du périmètre actif', async () => {
    const wrapper = await monter('/indicateurs/habitat/distribution_dpe?territoire=22001')
    const ensemble = wrapper.find('[data-testid="ensemble-comparaison"]')
    expect(ensemble.exists()).toBe(true)
    // Étiqueté honnêtement : une vue d'ensemble du périmètre, jamais un territoire.
    expect(ensemble.text()).toContain('L’ensemble de comparaison')
    expect(ensemble.attributes('data-portee')).toBe('Bretagne')
    expect(ensemble.attributes('data-avec-donnees')).toBe('1137')
    expect(ensemble.attributes('data-sans-donnees')).toBe('65')
    expect(ensemble.text()).not.toContain('22001')
    // Aucun lien-fiche dans l'ensemble : ce N'EST PAS un territoire cliquable.
    expect(ensemble.findAll('a').length).toBe(0)
    // Double saisie : chaque barre porte la moyenne recalculée depuis le JSON brut.
    for (const detail of DETAILS_DPE) {
      const { moyenne } = moyenneDetail(detail)
      const barre = ensemble.find(`[data-detail="${detail}"]`)
      expect(barre.exists(), `barre agrégée ${detail}`).toBe(true)
      expect(barre.text()).toContain(formaterValeur({ value: moyenne, unit: '%' }))
    }
  })

  it('resserre l’ensemble de comparaison au périmètre actif (niveau commune, département 22)', async () => {
    const wrapper = await monter('/indicateurs/habitat/distribution_dpe?niveau=commune&departement=22&territoire=22001')
    const ensemble = wrapper.find('[data-testid="ensemble-comparaison"]')
    expect(ensemble.exists()).toBe(true)
    expect(ensemble.attributes('data-portee')).toBe('Département 22')
    const communes22 = new Set(territoiresRef.filter((t) => t.departement === '22').map((t) => t.territoire))
    expect(ensemble.attributes('data-avec-donnees')).toBe(String(moyenneDetail('A', communes22).n))
    for (const detail of DETAILS_DPE) {
      const { moyenne } = moyenneDetail(detail, communes22)
      expect(ensemble.find(`[data-detail="${detail}"]`).text()).toContain(formaterValeur({ value: moyenne, unit: '%' }))
    }
  })

  it('garde la facette résumée PILOTE : extrêmes, tableau et carte lisent part_passoires', async () => {
    const wrapper = await monter('/indicateurs/habitat/distribution_dpe?territoire=22001')
    // Extrêmes et tableau restent ceux de la part de passoires.
    const extremes = wrapper.findAll('.extremes article')
    expect(extremes[0]!.text()).toContain('56 %')
    expect(extremes[1]!.text()).toContain('Chantepie')
    expect(extremes[1]!.text()).toContain('· 1 %')
    expect(ligneDuTableau(wrapper, '22001').findAll('td')[1]!.text()).toBe('13 %')
    // La carte reçoit EXACTEMENT les faits de la facette résumée.
    await wrapper.findAll('.vues button')[1]!.trigger('click')
    await flushPromises()
    const carte = wrapper.find('[data-testid="map"]')
    expect(carte.attributes('data-clef')).toBe('part_passoires')
    const attendusIds = faitsHabitat.filter((f) => f.key === 'part_passoires' && f.type === 'commune').map((f) => f.territoire).sort().join(',')
    expect(carte.attributes('data-values')!.split(',').sort().join(',')).toBe(attendusIds)
  })
})
