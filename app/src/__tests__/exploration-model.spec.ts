import { describe, expect, it } from 'vitest'
import { estimerDensite, hauteurDensite, mediane, modeleExploration, modeleProfil, modeleSignature, modeleTrajectoire, payloadPourCarte, positionDensite, rangsExAequo } from '../indicateurs/explorationModel'
import { normalizeComparisonFacet } from '../indicateurs/familySeam'
import { metadonneesThemesFixtures } from '../payload/fixtures'
import type { Indicateur, Territoire } from '../payload/types'

const territoires: Territoire[] = [
  { territoire: 'a', type: 'commune', nom: 'Alpha', departement: '22', epci: 'e' }, { territoire: 'b', type: 'commune', nom: 'Beta', departement: '22', epci: 'e' }, { territoire: 'c', type: 'commune', nom: 'Gamma', departement: '29', epci: 'f' }, { territoire: 'd', type: 'commune', nom: 'Delta', departement: '29', epci: 'f' },
  { territoire: 'e', type: 'epci', nom: 'E Bretagne', departement: null, epci: null }, { territoire: 'f', type: 'epci', nom: 'F Bretagne', departement: null, epci: null }, { territoire: '22', type: 'departement', nom: 'Côtes-d’Armor', departement: null, epci: null }, { territoire: '29', type: 'departement', nom: 'Finistère', departement: null, epci: null },
]
const facts = (id: string, value: number | null, type: Indicateur['type'] = 'commune'): Indicateur => ({ territoire: id, type, theme: 'demographie', key: 'densite', detail: null, value, unit: 'hab./km²', rang_epci: null, rang_dep: null, rang_reg: null, rang_epci_n: null, rang_dep_n: null, rang_reg_n: null, vintage_source: 'INSEE', vintage_version: '2023', vintage_date_reference: '2023-01-01', vintage_date_publication: '2024-01-01' })
const facet = (requested: object = {}) => normalizeComparisonFacet(metadonneesThemesFixtures.demographie.indicator_pages!.densite, requested, 'demographie')

describe('modèle pur de Page d’indicateur', () => {
  it('keeps Bretagne EPCI and département scopes populated', () => { expect(modeleExploration([facts('e', 10, 'epci'), facts('f', 20, 'epci')], facet(), territoires, { niveau: 'epci' }).rows).toHaveLength(2); expect(modeleExploration([facts('22', 10, 'departement'), facts('29', 20, 'departement')], facet(), territoires, { niveau: 'departement' }).rows).toHaveLength(2) })
  it('filters communes and removes incompatible scope state at other levels', () => { const factsAll = [facts('a', 10), facts('b', 20), facts('c', 30)]; expect(modeleExploration(factsAll, facet(), territoires, { niveau: 'commune', departement: '22' }).rows).toHaveLength(2); const result = modeleExploration([facts('e', 10, 'epci')], facet(), territoires, { niveau: 'epci', departement: '22', epci: 'e' }); expect(result.state.departement).toBeUndefined(); expect(result.state.epci).toBeUndefined() })
  it('computes median, direction and ranks from the resolved facet', () => { const metadata = structuredClone(metadonneesThemesFixtures.demographie); metadata.indicator_pages!.densite.direction = 'low'; const lowFacet = normalizeComparisonFacet(metadata.indicator_pages!.densite, {}, 'demographie'); const result = modeleExploration([facts('a', 10), facts('b', 10), facts('c', 30), facts('d', 40)], lowFacet, territoires, { niveau: 'commune', tri: 'valeur', ordre: 'desc' }); expect(result.median).toBe(20); expect(result.direction).toBe('low'); expect(result.rows.map((row) => row.rang)).toEqual([4, 3, 1, 1]) })
  it('samples finite density coordinates', () => { const density = estimerDensite([10, 20, 30]); expect(density.every((point) => Number.isFinite(point.x) && Number.isFinite(point.density))).toBe(true); expect(positionDensite(density, 20)).toBeCloseTo(50); expect(hauteurDensite(density, 20)).not.toBeNull() })
  it('uses the same resolved facet for map filtering including dimensions', () => { const resolved = { ...facet(), detail: 'F', sex: 'F' as const, dimension: 'women', labels: { F: 'Femmes' } }; const matching = [{ ...facts('a', 10), detail: 'F', sex: 'F', dimension: 'women' }, { ...facts('b', 20), detail: 'F', sex: 'F', dimension: 'women' }] as unknown as Indicateur[]; const source = { territoires, indicateurs: matching, histoires: [], apercu: null, runReport: null, vintages: null, programmes: null }; const result = payloadPourCarte(source, resolved, { niveau: 'commune', departement: '22' }); expect(result.indicateurs).toEqual(matching.slice(0, 2)) })
  it('presents ties, null values and empty scopes honestly', () => { const tied = modeleExploration([facts('a', 0), facts('b', 0), facts('c', null)], facet(), territoires, { niveau: 'commune', territoire: 'c' }); expect(tied.high.count).toBe(2); expect(tied.median).toBe(0); expect(tied.markerX).toBeNull(); const empty = modeleExploration([], facet(), territoires, { niveau: 'commune' }); expect(empty.rows).toHaveLength(0); expect(empty.median).toBeNull() })
})

// Les helpers partagés du rang et de la médiane (issue #437) — LA seule
// implémentation du codebase : le rang ordinal directionnel ex-aequo
// (ADR-0015 / CONTEXT.md Rang — « 1 = meilleur », les égalités partagent le
// rang, le suivant saute : 1, 1, 3) et la médiane. La grammaire des quatre
// familles Repères (#438/#439/#440/#441) les réutilise, jamais une copie privée.
describe('helpers partagés rang ex-aequo et médiane (#437)', () => {
  it('classe en concurrence avec ex-aequo qui saute (1, 1, 3) — direction high couronne la plus haute valeur', () => {
    expect(rangsExAequo([10, 40, 40, 20], 'high')).toEqual([4, 1, 1, 3])
    expect(rangsExAequo([5], 'high')).toEqual([1])
  })

  it('est directionnel : direction low couronne la plus BASSE valeur « 1ᵉʳ »', () => {
    expect(rangsExAequo([10, 10, 30, 40], 'low')).toEqual([1, 1, 3, 4])
    expect(rangsExAequo([10, 10, 30, 40], 'high')).toEqual([3, 3, 2, 1])
  })

  it('calcule la médiane — série impaire, paire, vide', () => {
    expect(mediane([30, 10, 20])).toBe(20)
    expect(mediane([40, 10, 30, 20])).toBe(25)
    expect(mediane([])).toBeNull()
  })
})

// La grammaire Repères des trajectoires (#438) — le modèle du chemin complet :
// échelles dérivées des valeurs RÉELLES (jamais un bornage brut), une SEULE
// échelle proportionnelle aux années pour les points ET les libellés, les
// états déclarés restent sur l'axe même sans valeur, et l'étalement
// territorial par détail réutilise la médiane partagée (#437).
describe('modèle trajectoire de Page d’indicateur (#438)', () => {
  const pageTrajectoire = (details: string[], detail: string, endpoints: string[]) => normalizeComparisonFacet({
    ...structuredClone(metadonneesThemesFixtures.demographie.indicator_pages!.densite),
    indicator: 'prix',
    family: 'trajectory',
    trajectory: { endpoints },
    comparison: { details, detail, unit: '€/m²', labels: Object.fromEntries(details.map((d) => [d, d])) },
  }, {}, 'demographie')
  const point = (id: string, detail: string | null, value: number | null, type: Indicateur['type'] = 'commune'): Indicateur => ({ ...facts(id, value ?? 0, type), key: 'prix', value, detail })
  const parDetail = (modele: ReturnType<typeof modeleTrajectoire>, detail: string) => modele.etapes.find((etape) => etape.detail === detail)!

  it('dérive le domaine de l’échelle des valeurs réelles — un étalement large reste large (jamais aplati)', () => {
    const facet = pageTrajectoire(['2020', '2024'], '2024', ['2020', '2024'])
    const modele = modeleTrajectoire([point('a', '2020', 300), point('a', '2024', 3200), point('b', '2020', 280), point('b', '2024', 3100)], facet, ['2020', '2024'], territoires, { niveau: 'commune' })
    expect(modele.domaineValeurs).toEqual({ min: 280, max: 3200 })
    expect(parDetail(modele, '2020').mediane).toBe(290)
    expect(parDetail(modele, '2024').mediane).toBe(3150)
    expect(parDetail(modele, '2024').min).toBe(3100)
    expect(parDetail(modele, '2024').max).toBe(3200)
  })

  it('positionne points et libellés sur UNE seule échelle proportionnelle aux années (années non consécutives)', () => {
    const facet = pageTrajectoire(['2019', '2021', '2025'], '2025', ['2019', '2025'])
    const modele = modeleTrajectoire([point('a', '2019', 10), point('a', '2021', 12), point('a', '2025', 16)], facet, ['2019', '2025'], territoires, { niveau: 'commune' })
    // Le domaine temporel couvre 2019 → 2025 (6 ans) : 2021 siège au tiers,
    // pas à la moitié de l'index (le défaut index-pair du PR supplanté).
    const x = (detail: string) => parDetail(modele, detail).x
    expect(x('2019')).toBe(0)
    expect(x('2021')).toBeCloseTo(100 / 3, 6)
    expect(x('2025')).toBe(100)
  })

  it('garde sur l’axe les bornes déclarées sans valeur (états OCS-GE M2/M3) — jamais effacées du chemin', () => {
    const facet = pageTrajectoire(['M2', 'M3', '2020', '2024'], '2024', ['M2', 'M3'])
    const modele = modeleTrajectoire([point('a', '2020', 10), point('a', '2024', 12), point('b', '2020', 14), point('b', 'M2', null)], facet, ['M2', 'M3'], territoires, { niveau: 'commune' })
    const m2 = parDetail(modele, 'M2')
    const m3 = parDetail(modele, 'M3')
    // Les deux états déclarés existent comme étapes, ordonnées hors de la
    // plage des années (état initial avant, état final après).
    expect(modele.etapes.map((etape) => etape.detail)).toEqual(['M2', '2020', '2024', 'M3'])
    expect(m2.x).toBe(0)
    expect(m3.x).toBe(100)
    // M2 ne porte qu'une valeur manquante déclarée : l'étalement reste null.
    expect(m2.nValeurs).toBe(0)
    expect(m2.nManquantes).toBe(1)
    expect(m2.mediane).toBeNull()
    // M3 est déclaré mais sans aucune ligne à ce niveau : présent et vide.
    expect(m3.nValeurs).toBe(0)
    expect(m3.nManquantes).toBe(0)
    expect(m3.mediane).toBeNull()
  })

  it('calcule l’étalement par détail dans le périmètre actif (niveau et resserrage)', () => {
    const facet = pageTrajectoire(['2020', '2024'], '2024', ['2020', '2024'])
    const epci = modeleTrajectoire([point('e', '2020', 100, 'epci'), point('f', '2020', 300, 'epci'), point('a', '2020', 9999)], facet, ['2020', '2024'], territoires, { niveau: 'epci' })
    expect(parDetail(epci, '2020').mediane).toBe(200)
    expect(parDetail(epci, '2020').nValeurs).toBe(2)
    const resserre = modeleTrajectoire([point('a', '2020', 1), point('c', '2020', 5000)], facet, ['2020', '2024'], territoires, { niveau: 'commune', departement: '22' })
    expect(parDetail(resserre, '2020').mediane).toBe(1)
    expect(parDetail(resserre, '2020').max).toBe(1)
  })

  it('expose le chemin du territoire mis en avant, valeurs manquantes comprises', () => {
    const facet = pageTrajectoire(['2020', '2024'], '2024', ['2020', '2024'])
    const modele = modeleTrajectoire([point('a', '2020', 10), point('a', '2024', null), point('b', '2020', 20), point('b', '2024', 22)], facet, ['2020', '2024'], territoires, { niveau: 'commune', territoire: 'a' })
    expect(modele.serieTerritoire!.map((p) => p.value)).toEqual([10, null])
    expect(modele.serieTerritoire!.map((p) => p.detail)).toEqual(['2020', '2024'])
    const horsScope = modeleTrajectoire([point('a', '2020', 10), point('a', '2024', 12)], facet, ['2020', '2024'], territoires, { niveau: 'epci', territoire: 'a' })
    expect(horsScope.serieTerritoire).toBeNull()
  })
})

// La grammaire Repères des profils/listes (#439) — le modèle du profil
// complet du territoire sélectionné, à côté de la comparaison
// inter-territoires que la catégorie comparée pilote (médiane, extrêmes,
// tableau, carte — la matière modeleExploration existante). Quatre états
// HONNÊTES, verrouillés par test — jamais un résumé inventé, jamais une
// réécriture silencieuse de la catégorie demandée :
//  - null : aucun territoire sélectionné — rien n'est affirmé ;
//  - 'absent' : le territoire sélectionné n'existe pas à ce niveau — JAMAIS
//    confondu avec un profil incomplet ;
//  - 'incomplet' : le territoire EST dans le périmètre mais son profil ne
//    porte pas toutes les catégories déclarées ;
//  - 'complet' : les lignes portent les valeurs publiées du territoire,
//    dans l'ordre DÉCLARÉ des catégories (les métadonnées possèdent l'ordre).
describe('modèle profil de Page d’indicateur (#439)', () => {
  const CATEGORIES = ['t_longueur', 't_densite', 'b_longueur', 'b_densite', 'c_longueur', 'c_densite'] as const
  const pageProfil = structuredClone(metadonneesThemesFixtures.mobilite) as typeof metadonneesThemesFixtures.mobilite
  pageProfil.indicator_pages = { reseaux: {
    ...structuredClone(metadonneesThemesFixtures.demographie.indicator_pages!.densite),
    indicator: 'reseaux',
    label: 'Réseaux à pied / vélo / voiture',
    family: 'list',
    list: { categories: [...CATEGORIES] },
    comparison: { details: [...CATEGORIES], detail: 'b_longueur', unit: 'km', direction: 'high' },
  } }
  const facet = normalizeComparisonFacet(pageProfil.indicator_pages!.reseaux, {}, 'mobilite')
  const labels = metadonneesThemesFixtures.mobilite.detail_labels.reseaux
  const faitReseaux = (id: string, detail: string, value: number | null, type: Indicateur['type'] = 'commune'): Indicateur => ({ ...facts(id, value ?? 0, type), theme: 'mobilite', key: 'reseaux', detail, value, unit: detail.endsWith('_longueur') ? 'km' : 'km/km²' })
  const faitsComplets = CATEGORIES.flatMap((detail) => [faitReseaux('a', detail, 1.5), faitReseaux('b', detail, 2.5)])

  it('rend le profil complet dans l’ordre déclaré — libellés canonical et unité PAR catégorie', () => {
    const modele = modeleProfil(faitsComplets, facet, pageProfil.indicator_pages!.reseaux, territoires, labels, { niveau: 'commune', territoire: 'a' })
    expect(modele.etat).toBe('complet')
    expect(modele.message).toBeNull()
    expect(modele.lignes.map((ligne) => ligne.detail)).toEqual([...CATEGORIES])
    expect(modele.lignes.map((ligne) => ligne.label)).toEqual(CATEGORIES.map((detail) => labels[detail]))
    expect(modele.lignes[0]).toMatchObject({ valeur: 1.5, unite: 'km' })
    expect(modele.lignes[1]).toMatchObject({ valeur: 1.5, unite: 'km/km²' })
  })

  it('déclare un profil incomplet quand une catégorie déclarée manque au territoire du périmètre', () => {
    const sansBDensite = faitsComplets.filter((fait) => !(fait.territoire === 'a' && fait.detail === 'b_densite'))
    const modele = modeleProfil(sansBDensite, facet, pageProfil.indicator_pages!.reseaux, territoires, labels, { niveau: 'commune', territoire: 'a' })
    expect(modele.etat).toBe('incomplet')
    expect(modele.message).toMatch(/Alpha : profil incomplet à ce niveau\./)
    expect(modele.lignes.find((ligne) => ligne.detail === 'b_densite')!.valeur).toBeNull()
    // les catégories présentes restent rendues — le profil reste visible entier
    expect(modele.lignes.find((ligne) => ligne.detail === 'b_longueur')!.valeur).toBe(1.5)
  })

  it('distingue honnêtement « absent à ce niveau » et le silence sans territoire sélectionné', () => {
    // Une commune sélectionnée dans une comparaison d'EPCIs : ABSENTE.
    const absent = modeleProfil(faitsComplets, facet, pageProfil.indicator_pages!.reseaux, territoires, labels, { niveau: 'epci', territoire: 'a' })
    expect(absent.etat).toBe('absent')
    expect(absent.message).toMatch(/absent à ce niveau/)
    expect(absent.message).not.toMatch(/incomplet/)
    // Aucun territoire sélectionné : rien n'est affirmé.
    const silence = modeleProfil(faitsComplets, facet, pageProfil.indicator_pages!.reseaux, territoires, labels, { niveau: 'commune' })
    expect(silence.etat).toBeNull()
    expect(silence.message).toBeNull()
  })
})

// La grammaire Repères des distributions (#440) — la signature intra-territoire
// à côté de la comparaison inter-territoires : la facette résumée (une AUTRE
// clé publiée) pilote médiane, extrêmes, tableau et carte avec SON unité ; les
// quatre états de la signature sont honnêtes — jamais un résumé inventé, et
// « absent à ce niveau » n'est JAMAIS confondu avec « incomplète ou supprimée »
// (le défaut du PR supplanté).
describe('modèle distribution de Page d’indicateur (#440)', () => {
  const ETIQUETTES = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  const pageDistribution = structuredClone(metadonneesThemesFixtures.demographie.indicator_pages!.densite) as any
  pageDistribution.indicator = 'distribution_dpe'
  pageDistribution.family = 'distribution'
  pageDistribution.distribution = { signature: ETIQUETTES }
  pageDistribution.comparison = { indicator: 'part_passoires', label: 'Part de passoires thermiques', unit: '%', direction: 'low' }
  const facet = normalizeComparisonFacet(pageDistribution, {}, 'habitat')
  const faitPart = (id: string, value: number | null, type: Indicateur['type'] = 'commune'): Indicateur => ({ ...facts(id, value ?? 0, type), theme: 'habitat', key: 'part_passoires', unit: '%' })
  const etiquette = (id: string, detail: string, value: number | null): Indicateur => ({ ...facts(id, value ?? 0), theme: 'habitat', key: 'distribution_dpe', detail, value, unit: '%' })
  const faitsComplets = [...ETIQUETTES.map((detail, i) => etiquette('a', detail, [0.05, 0.1, 0.15, 0.2, 0.2, 0.15, 0.15][i]!)), faitPart('a', 0.3)]

  it('rend la signature complète du territoire sélectionné — l’unité vient des faits de la signature, pas de la facette', () => {
    const modele = modeleSignature(faitsComplets, facet, pageDistribution, territoires, { A: 'A' }, { niveau: 'commune', territoire: 'a' })
    expect(modele.etat).toBe('complet')
    expect(modele.message).toBeNull()
    expect(modele.barres.map((barre) => barre.detail)).toEqual(ETIQUETTES)
    expect(modele.barres[0]).toMatchObject({ label: 'A', valeur: 0.05 })
    expect(modele.unite).toBe('%')
  })

  it('comparaison inter-territoriale : la facette résumée pilote rangs et extrêmes sur SA clé, jamais les bins', () => {
    const rows = [faitPart('a', 0.3), faitPart('b', 0.1), faitPart('c', 0.5)]
    const modele = modeleExploration(rows, facet, territoires, { niveau: 'commune' })
    // direction low : la part la plus BASSE est la meilleure (rang 1) ;
    // l'ordre des lignes reste le tri par nom par défaut.
    expect(modele.rows.map((row) => [row.territoire.territoire, row.rang])).toEqual([['a', 2], ['b', 1], ['c', 3]])
    expect(modele.high.count).toBe(1)
    expect(modele.median).toBeCloseTo(0.3, 10)
  })

  it('déclare une distribution incomplète ou supprimée quand le périmètre porte le territoire mais pas sa signature', () => {
    const sansG = faitsComplets.filter((fact) => fact.detail !== 'G')
    const modele = modeleSignature(sansG, facet, pageDistribution, territoires, {}, { niveau: 'commune', territoire: 'a' })
    expect(modele.etat).toBe('incomplet')
    expect(modele.message).toMatch(/distribution incomplète ou supprimée/)
  })

  it('distingue honnêtement « absent à ce niveau » — jamais un motif de suppression inventé', () => {
    // Une commune sélectionnée dans une comparaison d'EPCIs : ABSENTE, pas supprimée.
    const absent = modeleSignature(faitsComplets, facet, pageDistribution, territoires, {}, { niveau: 'epci', territoire: 'a' })
    expect(absent.etat).toBe('absent')
    expect(absent.message).toMatch(/absent à ce niveau/)
    expect(absent.message).not.toMatch(/supprimée|incomplète/)
    // Aucun territoire sélectionné : rien n'est affirmé.
    const silence = modeleSignature(faitsComplets, facet, pageDistribution, territoires, {}, { niveau: 'commune' })
    expect(silence.etat).toBeNull()
    expect(silence.message).toBeNull()
  })
})
