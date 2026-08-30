import { describe, expect, it } from 'vitest'
import type { LocationQuery } from 'vue-router'
import { fusionnerFacette, queryCanonique, resoudreEtatUrl } from '../indicateurs/etatUrl'
import type { Territoire } from '../payload/types'

// La machine à états URL pure de la Page d'indicateur (#508) — LA table de
// vérité qui vivait en watchers mutuellement réactifs dans IndicateurPage
// (validScope + normalizedQuery + la cascade explicite → mémorisé → repli).
// Zéro routeur monté : ces specs courent en microsecondes, sans payload
// multi-Mo ni plafond de timeout relevé (la famille de flake #185).
//
// Le vocabulaire est exclusivement celui du contrat d'exploration (#505) :
// PARAM_NIVEAU, NIVEAUX_COMPARABLES, estNiveauComparable, lireTerritoirePorte.
// La Région est exclue de la comparaison data-first (ADR-0024) : elle ne porte
// JAMAIS un niveau, son handoff porte le territoire sans niveau et la page
// résout son repli honnête.

const TERRITOIRES: Territoire[] = [
  { territoire: 'a', type: 'commune', nom: 'Alpha', departement: '22', epci: 'e' },
  { territoire: 'b', type: 'commune', nom: 'Beta', departement: '22', epci: 'e' },
  { territoire: 'c', type: 'commune', nom: 'Gamma', departement: '29', epci: 'f' },
  // Un EPCI existant auquel AUCUNE commune publiée n'appartient : la
  // validation du périmètre lit les COMMUNES publiées, pas l'annuaire.
  { territoire: 'z', type: 'epci', nom: 'EPCI orphelin', departement: null, epci: null },
  { territoire: 'e', type: 'epci', nom: 'EPCI E', departement: null, epci: null },
  { territoire: 'f', type: 'epci', nom: 'EPCI F', departement: null, epci: null },
  { territoire: '22', type: 'departement', nom: 'Côtes-d’Armor', departement: null, epci: null },
]

const NIVEAUX_TOUS = ['commune', 'epci', 'departement'] as const

/** La sérialisation canonique d'une query — l'ordre d'insertion des clés EST l'URL écrite. */
function serialise(query: Record<string, unknown>): string {
  return Object.entries(query)
    .filter(([, valeur]) => valeur !== undefined && valeur !== null)
    .map(([cle, valeur]) => `${cle}=${Array.isArray(valeur) ? valeur.join(',') : String(valeur)}`)
    .join('&')
}

describe('résolution de l’état — la cascade de niveaux (#508)', () => {
  it.each([
    {
      nom: 'niveau explicite comparable ET publié par la page — l’URL explicite gagne',
      query: { niveau: 'epci' },
      memoire: 'commune',
      niveauxPublies: NIVEAUX_TOUS,
      attendu: 'epci',
    },
    {
      nom: 'niveau explicite HORS contrat (la Région) jamais porté — le mémorisé prend le relais',
      query: { niveau: 'region' },
      memoire: 'departement',
      niveauxPublies: NIVEAUX_TOUS,
      attendu: 'departement',
    },
    {
      nom: 'niveau explicite répété (tableau du paramètre doublé) traité comme absent',
      query: { niveau: ['epci', 'commune'] },
      memoire: 'commune',
      niveauxPublies: NIVEAUX_TOUS,
      attendu: 'commune',
    },
    {
      nom: 'niveau explicite comparable mais NON publié par la page — repli honnête, jamais inventé',
      query: { niveau: 'departement' },
      memoire: undefined,
      niveauxPublies: ['commune'] as const,
      attendu: 'commune',
    },
    {
      nom: 'niveau mémorisé du visiteur APPLICABLE — il porte la page sans explicite',
      query: {},
      memoire: 'departement',
      niveauxPublies: NIVEAUX_TOUS,
      attendu: 'departement',
    },
    {
      nom: 'niveau mémorisé NON applicable à cette page — repli au plus fin publié',
      query: {},
      memoire: 'epci',
      niveauxPublies: ['commune'] as const,
      attendu: 'commune',
    },
    {
      nom: 'niveau mémorisé hors contrat ignoré — le repli décide',
      query: {},
      memoire: 'region',
      niveauxPublies: NIVEAUX_TOUS,
      attendu: 'commune',
    },
    {
      nom: 'repli au niveau le plus FIN publié — premier comparable déclaré, dans l’ordre du contrat',
      query: {},
      memoire: undefined,
      niveauxPublies: ['departement', 'epci'] as const,
      attendu: 'epci',
    },
    {
      nom: 'handoff de la Région : territoire porté SANS niveau — le repli résout, jamais « region »',
      query: { territoire: 'bretagne' },
      memoire: 'epci',
      niveauxPublies: NIVEAUX_TOUS,
      attendu: 'epci',
    },
  ])('$nom', ({ query, memoire, niveauxPublies, attendu }) => {
    const etat = resoudreEtatUrl({ query: query as LocationQuery, territoires: TERRITOIRES, niveauxPublies: [...niveauxPublies], niveauMemorise: memoire })
    expect(etat.niveau).toBe(attendu)
  })
})

describe('résolution de l’état — le périmètre département/EPCI face aux territoires publiés (#508)', () => {
  it('LE scénario #474 : territoires chargés, métadonnées pas encore — un scope VALIDE n’est PAS strippé', () => {
    // La fenêtre de chargement : la référence territoires est là, les
    // métadonnées du thème pas encore (les niveaux publiés sont inconnus).
    // Le périmètre demandé est validé CONTRE les communes publiées — gardé ;
    // aucun niveau n'est résolu ni écrit (la page ne peut pas encore décider).
    const etat = resoudreEtatUrl({ query: { niveau: 'commune', departement: '22', territoire: 'a' } as LocationQuery, territoires: TERRITOIRES })
    expect(etat.niveau).toBeNull()
    expect(etat.scopeValide).toEqual({ departement: '22', epci: undefined })
  })

  it('#474 phase 1 : un périmètre DEVENU invalide EST purgé dès que les territoires sont là, même sans métadonnées', () => {
    const etat = resoudreEtatUrl({ query: { niveau: 'commune', departement: '99', epci: 'zz' } as LocationQuery, territoires: TERRITOIRES })
    expect(etat.scopeValide).toEqual({ departement: undefined, epci: undefined })
  })

  it('paire département + EPCI impossible : le département lâché, l’EPCI gardé', () => {
    // Aucune commune publiée n'appartient AUSSI BIEN au 22 qu'à l'EPCI f.
    const etat = resoudreEtatUrl({ query: { departement: '22', epci: 'f' } as LocationQuery, territoires: TERRITOIRES })
    expect(etat.scopeValide).toEqual({ departement: undefined, epci: 'f' })
  })

  it('paire département + EPCI cohérente : les deux sont portés', () => {
    const etat = resoudreEtatUrl({ query: { departement: '22', epci: 'e' } as LocationQuery, territoires: TERRITOIRES })
    expect(etat.scopeValide).toEqual({ departement: '22', epci: 'e' })
  })

  it('la validation lit les COMMUNES publiées — un EPCI existant sans commune ne passe pas', () => {
    const etat = resoudreEtatUrl({ query: { epci: 'z' } as LocationQuery, territoires: TERRITOIRES })
    expect(etat.scopeValide).toEqual({ departement: undefined, epci: undefined })
  })

  it('le périmètre se valide quel que soit le niveau demandé — la purge est l’affaire de la query canonique', () => {
    const etat = resoudreEtatUrl({ query: { niveau: 'epci', departement: '22' } as LocationQuery, territoires: TERRITOIRES, niveauxPublies: [...NIVEAUX_TOUS] })
    expect(etat.scopeValide).toEqual({ departement: '22', epci: undefined })
    expect(etat.niveau).toBe('epci')
  })

  it('fenêtre vide : territoires pas encore publiés — RIEN ne se valide, le brut de l’URL est reflété', () => {
    const etat = resoudreEtatUrl({ query: { niveau: 'commune', departement: '22' } as LocationQuery, territoires: [], niveauxPublies: [...NIVEAUX_TOUS], niveauMemorise: 'commune' })
    expect(etat.scopeValide).toBeNull()
  })
})

describe('query canonique depuis un état — ce qui s’écrit, ce qui se supprime (#508)', () => {
  const SCOPE_VALIDE = { departement: '22', epci: undefined }

  it('écrit le niveau résolu EN DERNIER quand la query n’en porte pas — l’ordre d’insertion est la sérialisation', () => {
    const next = queryCanonique({ vue: 'carte', territoire: '29002' } as LocationQuery, { scopeValide: { ...SCOPE_VALIDE }, niveau: 'commune' })
    expect(serialise(next)).toBe('vue=carte&territoire=29002&niveau=commune')
  })

  it('surcharge un niveau explicite devenu non résoluble SANS bouger l’ordre des clés', () => {
    const next = queryCanonique({ tri: 'nom', niveau: 'epci' } as LocationQuery, { scopeValide: { departement: undefined, epci: undefined }, niveau: 'commune' })
    expect(Object.keys(next)).toEqual(['tri', 'niveau'])
    expect(serialise(next)).toBe('tri=nom&niveau=commune')
  })

  it('ne touche pas au paramètre de niveau quand l’état ne peut pas encore le résoudre', () => {
    const next = queryCanonique({ niveau: 'epci' } as LocationQuery, { scopeValide: null, niveau: null })
    expect(serialise(next)).toBe('niveau=epci')
  })

  it.each([
    {
      nom: 'niveau absent : un scope valide reste porté jusqu’à la résolution des métadonnées',
      query: { departement: '22' },
      niveau: null,
      attendu: 'departement=22',
    },
    {
      nom: 'niveau brut inconnu : un scope valide reste porté jusqu’à la résolution',
      query: { niveau: 'inconnu', departement: '22' },
      niveau: null,
      attendu: 'niveau=inconnu&departement=22',
    },
  ])('$nom', ({ query, niveau, attendu }) => {
    const next = queryCanonique(query as LocationQuery, { scopeValide: { ...SCOPE_VALIDE }, niveau })
    expect(serialise(next)).toBe(attendu)
  })

  it('le périmètre ne vit QU’au niveau commune — une fois le niveau résolu, il part dès que le niveau quitte communal', () => {
    const next = queryCanonique({ niveau: 'epci', departement: '22' } as LocationQuery, { scopeValide: { ...SCOPE_VALIDE }, niveau: 'epci' })
    expect(next.departement).toBeUndefined()
    expect(serialise(next)).toBe('niveau=epci')
  })

  it('purge le périmètre devenu invalide dès que les territoires sont publiés', () => {
    const next = queryCanonique({ niveau: 'commune', departement: '99' } as LocationQuery, { scopeValide: { departement: undefined, epci: undefined }, niveau: null })
    expect(serialise(next)).toBe('niveau=commune')
  })

  it('garde le périmètre valide', () => {
    const next = queryCanonique({ niveau: 'commune', departement: '22', epci: 'e' } as LocationQuery, { scopeValide: { departement: '22', epci: 'e' }, niveau: 'commune' })
    expect(serialise(next)).toBe('niveau=commune&departement=22&epci=e')
  })

  it('#474 : sans territoires publiés (scope non validable) RIEN ne se purge', () => {
    const next = queryCanonique({ niveau: 'commune', departement: '99' } as LocationQuery, { scopeValide: null, niveau: null })
    expect(serialise(next)).toBe('niveau=commune&departement=99')
  })

  it('les extras passent D’ABORD, les règles de canonisation ENSUITE (le tri, l’ordre, la recherche)', () => {
    const next = queryCanonique({ niveau: 'commune', departement: '22' } as LocationQuery, { scopeValide: { ...SCOPE_VALIDE }, niveau: null }, { tri: 'valeur', ordre: 'desc' })
    expect(serialise(next)).toBe('niveau=commune&departement=22&tri=valeur&ordre=desc')
  })

  it('un extra qui vide un paramètre (valeur falsy) suit la même règle de purge', () => {
    const next = queryCanonique({ niveau: 'commune', departement: '22', recherche: 'alpha' } as LocationQuery, { scopeValide: { ...SCOPE_VALIDE }, niveau: null }, { recherche: undefined })
    expect(serialise(next)).toBe('niveau=commune&departement=22')
  })

  it('est PUR : la query d’entrée n’est jamais mutée et le résultat est reproductible', () => {
    const entree = { niveau: 'commune', departement: '99', recherche: 'a' }
    const copie = { ...entree }
    const etat = { scopeValide: { departement: undefined as string | undefined, epci: undefined as string | undefined }, niveau: 'commune' as const }
    const premier = queryCanonique(entree as LocationQuery, etat)
    const second = queryCanonique(entree as LocationQuery, etat)
    expect(entree).toEqual(copie)
    expect(premier).not.toBe(entree)
    expect(premier).toEqual(second)
  })
})

describe('fusion de la facette résolue dans la query (#508, le watcher #474/#438)', () => {
  it('remplace detail/sex/dimension SUR PLACE, sans bouger l’ordre des clés existants', () => {
    const next = fusionnerFacette({ detail: 'stale', sex: 'X', dimension: 'stale' } as LocationQuery, '?detail=total&sex=F&dimension=menages')
    expect(Object.keys(next)).toEqual(['detail', 'sex', 'dimension'])
    expect(serialise(next)).toBe('detail=total&sex=F&dimension=menages')
  })

  it('ajoute EN DERNIER ce qui manque et préserve le reste de la query', () => {
    const next = fusionnerFacette({ vue: 'carte' } as LocationQuery, '?detail=2025')
    expect(Object.keys(next)).toEqual(['vue', 'detail'])
    expect(serialise(next)).toBe('vue=carte&detail=2025')
  })

  it('supprime le paramètre facet divergent ; une clé supprimée puis réécrite part EN DERNIER (l’historique octet pour octet)', () => {
    // Le comportement historique du watcher (#438/#474) : {...query} →
    // suppression des clés de facette → réassignation. En JavaScript, une clé
    // supprimée puis réassignée se replace à la FIN de l'ordre d'insertion —
    // l'URL écrite a toujours reflété ce déplacement, on le verrouille tel quel.
    const next = fusionnerFacette({ facet: 'autre', detail: 'stale', tri: 'nom' } as LocationQuery, '?detail=t')
    expect(next.facet).toBeUndefined()
    expect(serialise(next)).toBe('tri=nom&detail=t')
  })

  it('est PUR : la query d’entrée n’est jamais mutée', () => {
    const entree = { detail: 'stale', vue: 'indicateur' }
    const copie = { ...entree }
    fusionnerFacette(entree as LocationQuery, '?detail=t')
    expect(entree).toEqual(copie)
  })
})
