import { describe, expect, it } from 'vitest'
import { dispatchIndicatorFamily, normalizeComparisonFacet } from '../indicateurs/familySeam'
import { modeleExploration } from '../indicateurs/explorationModel'
import { correspondFait, CORRESPONDANCE_CARTE, CORRESPONDANCE_STRICTE } from '../indicateurs/correspondFait'
import type { CriteresFait, OptionsCorrespondance } from '../indicateurs/correspondFait'
import { metadonneesThemesFixtures } from '../payload/fixtures'
import type { Indicateur, Territoire } from '../payload/types'

// Le verrou de PARITÉ DE POPULATION (#507) : le dispatch de famille (le statut
// « ready / unavailable / incomplete » de Repères) et les modèles Repères
// (les lignes du tableau, la médiane, les extrêmes) doivent filtrer les faits
// par LE MÊME prédicat configuré — thème × clé × détail × sexe × dimension.
//
// Aujourd'hui deux copies inline cohabitent et DIVERGENT sur la sémantique
// null du sexe : la seam de famille matche STRICTEMENT ((fact.sex ?? null) ===
// facet.sex) quand les modèles matchent TOLÉRAMMENT (facet.sex === null ||
// …). Sur une clé portant à la fois des lignes sexées et non-sexées — forme
// que les fixtures réelles n'ont jamais produite, mais que rien
// n'interdit au pipeline — le statut et les lignes se calculent donc sur des
// populations DIFFÉRENTES, sans que rien ne le détecte. Ce spec échoue sur
// l'état pré-#507 précisément à cause de cette divergence ; il verrouille
// l'unique prédicat partagé après migration.
describe('parité de population : dispatch de famille × modèles Repères (#507)', () => {
  const territoires: Territoire[] = [
    { territoire: 'a', type: 'commune', nom: 'Alpha', departement: '22', epci: 'e' },
    { territoire: 'b', type: 'commune', nom: 'Beta', departement: '22', epci: 'e' },
    { territoire: 'c', type: 'commune', nom: 'Gamma', departement: '29', epci: 'f' },
    { territoire: 'e', type: 'epci', nom: 'E Bretagne', departement: null, epci: null },
    { territoire: 'f', type: 'epci', nom: 'F Bretagne', departement: null, epci: null },
    { territoire: '22', type: 'departement', nom: 'Côtes-d’Armor', departement: null, epci: null },
    { territoire: '29', type: 'departement', nom: 'Finistère', departement: null, epci: null },
  ]
  const fait = (id: string, value: number | null, extra: Partial<Indicateur> = {}): Indicateur => ({
    territoire: id,
    type: 'commune',
    theme: 'demographie',
    key: 'densite',
    detail: null,
    value,
    unit: 'hab./km²',
    rang_epci: null,
    rang_dep: null,
    rang_reg: null,
    rang_epci_n: null,
    rang_dep_n: null,
    rang_reg_n: null,
    vintage_source: 'INSEE',
    vintage_version: '2023',
    vintage_date_reference: '2023-01-01',
    vintage_date_publication: '2024-01-01',
    ...extra,
  })

  // Une MÊME clé (demographie × densite, sans détail) portant des lignes
  // non-sexées ET sexées : la forme mixte qu'aucune fixture ne produit encore
  // et contre laquelle les deux copies inline divergent aujourd'hui.
  const faitsMixtes = [fait('a', 10), fait('b', 20, { sex: 'F' }), fait('b', 30, { sex: 'M' }), fait('c', 40)]

  // La sémantique choisie et documentée (#507) : la facette sans sexe déclaré
  // lit les lignes NON-SEXÉES — la publication sans découpage F/M — jamais un
  // mélange où une valeur « F » ou « M » tiendrait lieu de total.
  const PEUPLE_ATTENDU = ['a', 'c']
  const VALEURS_ATTENDUES: Record<string, number> = { a: 10, c: 40 }

  it('statut de famille et lignes du modèle lisent la MÊME population de faits sur une clé mêlant lignes sexées et non-sexées', () => {
    const page = metadonneesThemesFixtures.demographie.indicator_pages!.densite
    const facet = normalizeComparisonFacet(page, {}, 'demographie')

    const dispatch = dispatchIndicatorFamily(page, { facts: faitsMixtes })
    expect(dispatch.family).toBe('scalar')
    const peupleDispatch = [...dispatch.representation.rows].map((row) => row.territoire).sort()
    expect(peupleDispatch).toEqual(PEUPLE_ATTENDU)

    const modele = modeleExploration(faitsMixtes, facet, territoires, { niveau: 'commune' })
    const peupleModele = modele.rows.map((row) => row.territoire.territoire).sort()
    expect(peupleModele).toEqual(peupleDispatch)

    const valeursDispatch = Object.fromEntries(dispatch.representation.rows.map((row) => [row.territoire, row.value]))
    const valeursModele = Object.fromEntries(modele.rows.map((row) => [row.territoire.territoire, row.value]))
    expect(valeursModele).toEqual(VALEURS_ATTENDUES)
    expect(valeursDispatch).toEqual(VALEURS_ATTENDUES)
  })

  it('le statut « incomplet » et la médiane du modèle se calculent sur la même assiette stricte', () => {
    const page = metadonneesThemesFixtures.demographie.indicator_pages!.densite
    const facet = normalizeComparisonFacet(page, {}, 'demographie')
    // Gamma porte un fait non-sexé SANS valeur : sous la jointure stricte la
    // population du dispatch est {a, c(null)} → « incomplet », et la médiane
    // du modèle lit la même assiette (les valeurs non-nulles de CE peuple),
    // pas les lignes sexées de Beta.
    const faitsTroues = [fait('a', 10), fait('b', 20, { sex: 'F' }), fait('b', 30, { sex: 'M' }), fait('c', null)]
    const dispatch = dispatchIndicatorFamily(page, { facts: faitsTroues })
    expect(dispatch.status).toBe('incomplete')

    const modele = modeleExploration(faitsTroues, facet, territoires, { niveau: 'commune' })
    expect(modele.rows.map((row) => row.territoire.territoire).sort()).toEqual(['a'])
    expect(modele.median).toBe(10)
    expect(modele.high.count).toBe(1)
  })
})

// Les units du prédicat unique (#507) : la sémantique de chaque composante de
// la clé thème × clé × détail × sexe × dimension, et les choix explicites
// (sexe strict vs tolérant, l'exception carte `ignorerSexe`) documentés à
// l'interface de correspondFait.
describe('correspondFait — le prédicat unique de jointure des faits Repères (#507)', () => {
  const faitBase = {
    territoire: 'a', type: 'commune' as const, theme: 'demographie' as const, key: 'densite',
    detail: null as string | null, value: 10, unit: 'hab./km²', vintage_source: 'INSEE',
    vintage_version: '2023', vintage_date_reference: '2023-01-01', vintage_date_publication: '2024-01-01',
    rang_epci: null, rang_dep: null, rang_reg: null, rang_epci_n: null, rang_dep_n: null, rang_reg_n: null,
  }
  const crit = (extra: Partial<CriteresFait> = {}): CriteresFait => ({ theme: 'demographie', cle: 'densite', ...extra })
  const ok = (fait: Indicateur, criteres: Parameters<typeof correspondFait>[1], options: OptionsCorrespondance = CORRESPONDANCE_STRICTE) => correspondFait(fait, criteres, options)

  it('joint par THÈME × CLÉ — les clés ne sont pas uniques entre thèmes (#383/#438)', () => {
    expect(ok({ ...faitBase }, { theme: 'demographie', cle: 'densite' })).toBe(true)
    // même clé, autre thème : jamais lu
    expect(ok({ ...faitBase, theme: 'habitat' }, { theme: 'demographie', cle: 'densite' })).toBe(false)
    // même thème, autre clé : jamais lu
    expect(ok({ ...faitBase, key: 'part_65_plus' }, { theme: 'demographie', cle: 'densite' })).toBe(false)
  })

  it('sexe STRICT : un critère null n’accepte que les lignes non-sexées — jamais un total inventé', () => {
    const criteres = crit({ sexe: null })
    expect(ok({ ...faitBase }, criteres)).toBe(true)
    expect(ok({ ...faitBase, sex: undefined }, criteres)).toBe(true) // absent ≡ non-sexé
    expect(ok({ ...faitBase, sex: 'F' }, criteres)).toBe(false)
    expect(ok({ ...faitBase, sex: 'M' }, criteres)).toBe(false)
    const femmes = crit({ sexe: 'F' })
    expect(ok({ ...faitBase, sex: 'F' }, femmes)).toBe(true)
    expect(ok({ ...faitBase }, femmes)).toBe(false)
    expect(ok({ ...faitBase, sex: 'M' }, femmes)).toBe(false)
  })

  it('sexe TOLÉRANT : un critère null accepte toute ligne ; un critère nommé reste exact', () => {
    const options: OptionsCorrespondance = { sexe: 'tolerante', dimension: 'stricte' }
    const criteres = crit({ sexe: null })
    expect(correspondFait({ ...faitBase }, criteres, options)).toBe(true)
    expect(correspondFait({ ...faitBase, sex: 'F' }, criteres, options)).toBe(true)
    expect(correspondFait({ ...faitBase, sex: 'M' }, criteres, options)).toBe(true)
    const femmes = crit({ sexe: 'F' })
    expect(correspondFait({ ...faitBase, sex: 'F' }, femmes, options)).toBe(true)
    expect(correspondFait({ ...faitBase }, femmes, options)).toBe(false)
  })

  it('ignorerSexe — l’exception DÉCLARÉE de la Carte (#483) : la clause sexe sort du filtre', () => {
    const criteres = crit({ detail: '<15', sexe: 'F', niveau: 'commune' })
    // la facette pyramide déclare « F » mais la carte doit porter F ET M
    expect(correspondFait({ ...faitBase, detail: '<15', sex: 'F' }, criteres, CORRESPONDANCE_CARTE)).toBe(true)
    expect(correspondFait({ ...faitBase, detail: '<15', sex: 'M' }, criteres, CORRESPONDANCE_CARTE)).toBe(true)
    // … alors que la configuration stricte ne lit que F
    expect(correspondFait({ ...faitBase, detail: '<15', sex: 'M' }, criteres, CORRESPONDANCE_STRICTE)).toBe(false)
  })

  it('détail absent : un critère null matche les faits sans détail (null ≡ absent)', () => {
    const criteres = crit({ detail: null })
    expect(ok({ ...faitBase, detail: null }, criteres)).toBe(true)
    expect(ok({ ...faitBase }, criteres)).toBe(true)
    expect(ok({ ...faitBase, detail: '<15' }, criteres)).toBe(false)
    const tranche = crit({ detail: '<15' })
    expect(ok({ ...faitBase, detail: '<15' }, tranche)).toBe(true)
    expect(ok({ ...faitBase }, tranche)).toBe(false)
  })

  it('multi-détail : l’appartenance aux détails DÉCLARÉS — un fait sans détail n’y appartient jamais', () => {
    const criteres = crit({ details: ['2020', '2024'] })
    expect(ok({ ...faitBase, detail: '2020' }, criteres)).toBe(true)
    expect(ok({ ...faitBase, detail: '2024' }, criteres)).toBe(true)
    expect(ok({ ...faitBase, detail: '2019' }, criteres)).toBe(false)
    expect(ok({ ...faitBase, detail: null }, criteres)).toBe(false)
  })

  it('dimension suit le même mode que le sexe ; niveau, territoire et avecValeur resserrent la lecture', () => {
    const criteres = crit({ dimension: null, niveau: 'commune', territoire: 'a', avecValeur: true })
    expect(ok({ ...faitBase }, criteres)).toBe(true)
    expect(ok({ ...faitBase, dimension: 'women' }, criteres)).toBe(false)
    expect(ok({ ...faitBase, type: 'epci' }, criteres)).toBe(false)
    expect(ok({ ...faitBase, territoire: 'b' }, criteres)).toBe(false)
    expect(ok({ ...faitBase, value: null }, criteres)).toBe(false)
    // dimension tolérante : critère null, toute dimension passe
    const tolerant: OptionsCorrespondance = { sexe: 'stricte', dimension: 'tolerante' }
    expect(correspondFait({ ...faitBase, dimension: 'women' }, crit(), tolerant)).toBe(true)
  })

  it('la configuration partagée est figée — les sites appelants ne peuvent pas la faire dériver', () => {
    expect(Object.isFrozen(CORRESPONDANCE_STRICTE)).toBe(true)
    expect(Object.isFrozen(CORRESPONDANCE_CARTE)).toBe(true)
    expect(CORRESPONDANCE_STRICTE).toMatchObject({ sexe: 'stricte', dimension: 'stricte' })
    expect(CORRESPONDANCE_CARTE).toMatchObject({ sexe: 'stricte', dimension: 'stricte', ignorerSexe: true })
  })
})
