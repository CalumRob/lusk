import { describe, expect, it } from 'vitest'

import {
  developperMembresCommunes,
  libelleMembres,
  libelleSelectionComparaison,
  lireSelectionBrute,
  presetsDisponibles,
  queryTerritoireAvecComparaison,
  resoudreSelectionComparaison,
  serialiserSelection,
  territoireReferencePourComparaison,
} from '@/fiche/comparisonContext'
import type {
  ResolutionSelectionComparaison,
  SelectionComparaison,
} from '@/fiche/comparisonContext'
import type {
  TerritoryComparisonContext,
  TerritoryComparisonMode,
} from '@/fiche/comparisonContext'
import type { Territoire } from '@/payload/types'
import { territoiresFixture } from '@/payload/fixtures'

/**
 * #860 — le contrat URL de la Sélection de comparaison (spec #768) :
 * `?comparaison=` porte un preset (« epci » · « bretagne » · « densite »), une
 * liste de membres tapés même niveau (« commune:22001,commune:22002 »), ou une
 * sélection explicitement VIDE (« ?comparaison= » = aucune comparaison) ; un
 * paramètre ABSENT = le contexte par défaut niveau-natif (ADR-0021). La classe
 * de densité n'est plus le défaut silencieux : c'est un preset explicite.
 */

function contexte(mode: TerritoryComparisonMode, label: string): TerritoryComparisonContext {
  const kinds: Record<TerritoryComparisonMode, TerritoryComparisonContext['scope']['kind']> = {
    densite: 'communes-densite',
    epci: 'communes-epci',
    bretagne: 'communes-bretagne',
  }
  return {
    mode,
    scope: { kind: kinds[mode], label },
    facts: [],
    buildingDistribution: null,
    accessRamp: null,
  }
}

const contextes = {
  densite: contexte('densite', 'grands centres urbains bretons'),
  epci: contexte('epci', 'communes de EPCI X'),
  bretagne: contexte('bretagne', 'communes bretonnes'),
}

const avecDensite = (territoire: Territoire, code = '1'): Territoire => ({
  ...territoire,
  classe_densite_code: code,
  classe_densite_libelle_insee: 'Grands centres urbains',
  classe_densite_libelle_public: 'grands centres urbains bretons',
})

/** Commune A1 (22001, EPCI X) avec une classe de densité publiée. */
const commune = avecDensite(territoiresFixture.find((t) => t.territoire === '22001')!)
const communeSansEpci = avecDensite({ ...territoiresFixture.find((t) => t.territoire === '22001')!, epci: null })
/** Référence où chaque commune porte une classe de densité (comme territoires.json). */
const territoiresAvecDensite: Territoire[] = territoiresFixture.map((t) =>
  t.type === 'commune' ? avecDensite(t, t.territoire === '22001' || t.territoire === '22002' ? '1' : '7') : t)
const epci = territoiresFixture.find((t) => t.type === 'epci')!
const departement = territoiresFixture.find((t) => t.type === 'departement')!
const region = territoiresFixture.find((t) => t.type === 'region')!

const resoudre = (options: {
  territoire: Territoire | null
  demande: unknown
  contextes?: Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>>
  territoires?: readonly Territoire[]
}): ResolutionSelectionComparaison => resoudreSelectionComparaison({
  territoire: options.territoire,
  demande: options.demande,
  contextes: options.contextes ?? contextes,
  territoires: options.territoires ?? territoiresFixture,
})

describe('lecture et sérialisation du paramètre ?comparaison=', () => {
  it('un paramètre absent lit le contexte par défaut', () => {
    expect(lireSelectionBrute(undefined)).toEqual({ etat: 'defaut' })
  })

  it('une chaîne vide lit la sélection explicitement vide', () => {
    expect(lireSelectionBrute('')).toEqual({ etat: 'vide' })
  })

  it.each(['epci', 'bretagne', 'densite'] as const)('lit le preset %s', (preset) => {
    expect(lireSelectionBrute(preset)).toEqual({ etat: 'preset', preset })
  })

  it('lit une liste de membres tapés même niveau', () => {
    expect(lireSelectionBrute('commune:22001,commune:22002')).toEqual({
      etat: 'membres',
      membres: [
        { territory_type: 'commune', territory_id: '22001' },
        { territory_type: 'commune', territory_id: '22002' },
      ],
    })
  })

  it.each([
    ['mystere'],
    ['commune:'],
    [':22001'],
    ['commune:22001:extra'],
    ['villes:22001'],
    [['epci', 'bretagne']],
    [null],
  ])('une valeur illisible (%s) ne lit aucune sélection', (demande) => {
    expect(lireSelectionBrute(demande)).toBeNull()
  })

  it('sérialise chaque forme de sélection en une valeur d’URL partageable', () => {
    expect(serialiserSelection({ etat: 'defaut' })).toBeUndefined()
    expect(serialiserSelection({ etat: 'vide' })).toBe('')
    expect(serialiserSelection({ etat: 'preset', preset: 'densite' })).toBe('densite')
    expect(serialiserSelection({
      etat: 'membres',
      membres: [
        { territory_type: 'commune', territory_id: '22001' },
        { territory_type: 'commune', territory_id: '22002' },
      ],
    })).toBe('commune:22001,commune:22002')
  })

  it('la sérialisation est l’inverse de la lecture (aller-retour URL)', () => {
    const selections: SelectionComparaison[] = [
      { etat: 'defaut' },
      { etat: 'vide' },
      { etat: 'preset', preset: 'epci' },
      { etat: 'membres', membres: [{ territory_type: 'commune', territory_id: '22001' }] },
    ]
    for (const selection of selections) {
      expect(lireSelectionBrute(serialiserSelection(selection))).toEqual(selection)
    }
  })
})

describe('résolution de la sélection — défaut niveau-natif (ADR-0021, #860)', () => {
  it('une commune sans paramètre lit son EPCI (communes de son EPCI), jamais la densité', () => {
    const resolution = resoudre({ territoire: commune, demande: undefined })
    expect(resolution.selection).toEqual({ etat: 'defaut' })
    expect(resolution.preset).toBe('epci')
    expect(resolution.contexte).toBe(contextes.epci)
    expect(resolution.membres).toEqual([{ territory_type: 'epci', territory_id: '200000001' }])
    expect(resolution.canonicaliser).toBe(false)
  })

  it('une commune sans EPCI lit les communes bretonnes par défaut', () => {
    const resolution = resoudre({ territoire: communeSansEpci, demande: undefined })
    expect(resolution.preset).toBe('bretagne')
    expect(resolution.contexte).toBe(contextes.bretagne)
    expect(resolution.membres).toEqual([{ territory_type: 'region', territory_id: '53' }])
  })

  it('un EPCI / un département gardent le même niveau Bretagne comme défaut', () => {
    const contexteFixe: Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>> = {
      bretagne: { ...contextes.bretagne, scope: { kind: 'epcis-bretagne', label: 'EPCI du périmètre de comparaison' } },
    }
    for (const territoire of [epci, departement]) {
      const resolution = resoudre({ territoire, demande: undefined, contextes: contexteFixe })
      expect(resolution.selection).toEqual({ etat: 'defaut' })
      expect(resolution.preset).toBe('bretagne')
      expect(resolution.contexte?.scope.label).toBe('EPCI du périmètre de comparaison')
      expect(resolution.membres).toBeUndefined()
      expect(resolution.canonicaliser).toBe(false)
    }
  })

  it('la Région n’a aucune comparaison et retire tout paramètre', () => {
    for (const demande of [undefined, 'bretagne', 'densite', '']) {
      const resolution = resoudre({ territoire: region, demande })
      expect(resolution.selection).toEqual({ etat: 'defaut' })
      expect(resolution.membres).toBeUndefined()
      expect(resolution.contexte).toBeNull()
      expect(resolution.preset).toBeNull()
      expect(resolution.canonicaliser).toBe(demande !== undefined)
    }
  })
})

describe('résolution de la sélection — presets explicites', () => {
  it.each(['epci', 'bretagne', 'densite'] as const)('le preset %s reste partageable et résout ses membres tapés', (preset) => {
    const resolution = resoudre({ territoire: commune, demande: preset })
    expect(resolution.selection).toEqual({ etat: 'preset', preset })
    expect(resolution.preset).toBe(preset)
    expect(resolution.contexte).toBe(contextes[preset])
    expect(resolution.canonicaliser).toBe(false)
  })

  it('le preset epci résout la référence EPCI ; bretagne la région', () => {
    expect(resoudre({ territoire: commune, demande: 'epci' }).membres)
      .toEqual([{ territory_type: 'epci', territory_id: '200000001' }])
    expect(resoudre({ territoire: commune, demande: 'bretagne' }).membres)
      .toEqual([{ territory_type: 'region', territory_id: '53' }])
  })

  it('le preset densite n’est plus le défaut : il résout la cohorte de la classe de densité', () => {
    const avecClasse = territoiresFixture.map((t) => (t.territoire === '22001' || t.territoire === '22002'
      ? avecDensite(t, '1')
      : t.type === 'commune' ? avecDensite(t, '7') : t))
    const resolution = resoudre({ territoire: commune, demande: 'densite', territoires: avecClasse })
    expect(resolution.membres).toEqual([
      { territory_type: 'commune', territory_id: '22001' },
      { territory_type: 'commune', territory_id: '22002' },
    ])
  })

  it('le preset epci d’une commune sans EPCI ne restaure JAMAIS le défaut : sélection vide explicite + URL canonique', () => {
    // Loi du glossaire (CONTEXT.md « Sélection de comparaison », clarification
    // 2026-10-02) : une sélection explicite non honorable = vide explicite
    // (aucune comparaison), jamais le contexte par défaut.
    const resolution = resoudre({ territoire: communeSansEpci, demande: 'epci' })
    expect(resolution.selection).toEqual({ etat: 'vide' })
    expect(resolution.membres).toEqual([])
    expect(resolution.contexte).toBeNull()
    expect(resolution.preset).toBeNull()
    expect(resolution.canonicaliser).toBe(true)
    expect(serialiserSelection(resolution.selection)).toBe('')
  })

  it('un preset non applicable au niveau (epci/densite sur EPCI/département) devient vide explicite, pas le défaut', () => {
    for (const demande of ['epci', 'densite'] as const) {
      const resolution = resoudre({ territoire: epci, demande })
      expect(resolution.selection).toEqual({ etat: 'vide' })
      expect(resolution.membres).toEqual([])
      expect(resolution.canonicaliser).toBe(true)
      expect(serialiserSelection(resolution.selection)).toBe('')
    }
  })

  it('le preset bretagne sur EPCI/département garde le même niveau (défaut déclaré)', () => {
    const contexteFixe: Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>> = {
      bretagne: { ...contextes.bretagne, scope: { kind: 'epcis-bretagne', label: 'EPCI du périmètre de comparaison' } },
    }
    const resolution = resoudre({ territoire: epci, demande: 'bretagne', contextes: contexteFixe })
    expect(resolution.selection).toEqual({ etat: 'preset', preset: 'bretagne' })
    expect(resolution.membres).toBeUndefined()
    expect(resolution.canonicaliser).toBe(false)
  })

  it('un preset nommé sans identité de référence résoluble échoue fermé (jamais [] ni le défaut)', () => {
    const sansRegion = territoiresFixture.filter((t) => t.type !== 'region')
    const resolution = resoudre({ territoire: commune, demande: 'bretagne', territoires: sansRegion })
    expect(resolution.selection).toEqual({ etat: 'preset', preset: 'bretagne' })
    expect(resolution.membres).toBeNull()
    expect(resolution.canonicaliser).toBe(false)
  })
})

describe('résolution de la sélection — membres tapés et vide explicite', () => {
  it('une sélection vide explicite signifie aucune comparaison (membres [])', () => {
    const resolution = resoudre({ territoire: commune, demande: '' })
    expect(resolution.selection).toEqual({ etat: 'vide' })
    expect(resolution.membres).toEqual([])
    expect(resolution.contexte).toBeNull()
    expect(resolution.canonicaliser).toBe(false)
  })

  it('les membres tapés valides même niveau sont retenus tels quels', () => {
    const resolution = resoudre({ territoire: commune, demande: 'commune:22001,commune:22002' })
    expect(resolution.selection).toEqual({
      etat: 'membres',
      membres: [
        { territory_type: 'commune', territory_id: '22001' },
        { territory_type: 'commune', territory_id: '22002' },
      ],
    })
    expect(resolution.membres).toEqual(resolution.selection.etat === 'membres' ? resolution.selection.membres : null)
    expect(resolution.contexte).toBeNull()
    expect(resolution.preset).toBeNull()
    expect(resolution.canonicaliser).toBe(false)
  })

  it('les doublons et membres hors niveau ou inconnus sont retirés et l’URL canonisée', () => {
    const resolution = resoudre({
      territoire: commune,
      demande: 'commune:22001,commune:22001,epci:200000001,commune:99999',
    })
    expect(resolution.selection).toEqual({
      etat: 'membres',
      membres: [{ territory_type: 'commune', territory_id: '22001' }],
    })
    expect(resolution.canonicaliser).toBe(true)
  })

  it('une liste de membres dont aucun ne survit à la validation devient vide explicite (jamais le défaut) + URL canonique', () => {
    // Même loi du glossaire : l’intention explicite ne peut pas être honorée →
    // aucune comparaison, pas le contexte par défaut.
    const resolution = resoudre({ territoire: commune, demande: 'commune:99999' })
    expect(resolution.selection).toEqual({ etat: 'vide' })
    expect(resolution.membres).toEqual([])
    expect(resolution.contexte).toBeNull()
    expect(resolution.preset).toBeNull()
    expect(resolution.canonicaliser).toBe(true)
    expect(serialiserSelection(resolution.selection)).toBe('')
  })

  it('une valeur illisible (hors contrat) retombe sur le défaut et demande une URL canonique', () => {
    for (const demande of ['mystere', ['epci', 'bretagne'], null] as const) {
      const resolution = resoudre({ territoire: commune, demande })
      expect(resolution.selection).toEqual({ etat: 'defaut' })
      expect(resolution.preset).toBe('epci')
      expect(resolution.canonicaliser).toBe(true)
    }
  })

  it('sans territoire, tout paramètre est canonisé', () => {
    const resolution = resoudre({ territoire: null, demande: 'epci' })
    expect(resolution.selection).toEqual({ etat: 'defaut' })
    expect(resolution.canonicaliser).toBe(true)
  })
})

describe('presets du menu rapide de l’en-tête', () => {
  it('une commune propose EPCI (si elle en a un) · Bretagne · classe de densité, dans cet ordre', () => {
    expect(presetsDisponibles({ territoire: commune, contextes, territoires: territoiresAvecDensite }).map((p) => p.preset))
      .toEqual(['epci', 'bretagne', 'densite'])
    expect(presetsDisponibles({ territoire: commune, contextes, territoires: territoiresAvecDensite })).toEqual([
      { preset: 'epci', label: 'communes de EPCI X', description: null },
      { preset: 'bretagne', label: 'communes bretonnes', description: null },
      {
        preset: 'densite',
        label: 'grands centres urbains bretons',
        description: 'Classe définie par l’Insee selon le nombre d’habitants et leur concentration sur le territoire communal.',
      },
    ])
  })

  it('une commune sans EPCI ne propose pas le preset EPCI', () => {
    expect(presetsDisponibles({ territoire: communeSansEpci, contextes, territoires: territoiresAvecDensite }).map((p) => p.preset))
      .toEqual(['bretagne', 'densite'])
  })

  it('un preset dont la résolution de membres échoue n’est jamais proposé (aucune option en cul-de-sac)', () => {
    // EPCI renseigné mais absent de la référence chargée : pas de preset epci.
    const sansEpciX = territoiresAvecDensite.filter((t) => t.territoire !== '200000001')
    expect(presetsDisponibles({ territoire: commune, contextes, territoires: sansEpciX }).map((p) => p.preset))
      .toEqual(['bretagne', 'densite'])
    // Région absente de la référence : pas de preset bretagne.
    const sansRegion = territoiresAvecDensite.filter((t) => t.type !== 'region')
    expect(presetsDisponibles({ territoire: commune, contextes, territoires: sansRegion }).map((p) => p.preset))
      .toEqual(['epci', 'densite'])
    // Commune sans classe de densité publiée : pas de preset densite.
    const sansClasse = { ...territoiresFixture.find((t) => t.territoire === '22001')!,
      classe_densite_code: null, classe_densite_libelle_public: null, classe_densite_libelle_insee: null }
    const contextesSansDensite = { epci: contextes.epci, bretagne: contextes.bretagne }
    expect(presetsDisponibles({ territoire: sansClasse, contextes: contextesSansDensite, territoires: territoiresAvecDensite })
      .map((p) => p.preset)).toEqual(['epci', 'bretagne'])
  })

  it('un EPCI / un département ne proposent que le même niveau Bretagne', () => {
    const contexteFixe: Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>> = {
      bretagne: { ...contextes.bretagne, scope: { kind: 'epcis-bretagne', label: 'EPCI du périmètre de comparaison' } },
    }
    expect(presetsDisponibles({ territoire: epci, contextes: contexteFixe, territoires: territoiresFixture }))
      .toEqual([{ preset: 'bretagne', label: 'EPCI du périmètre de comparaison', description: null }])
    expect(presetsDisponibles({ territoire: departement, contextes: contexteFixe, territoires: territoiresFixture }).map((p) => p.preset))
      .toEqual(['bretagne'])
  })

  it('la Région ne propose aucun preset (pas de contrôle de comparaison)', () => {
    expect(presetsDisponibles({ territoire: region, contextes, territoires: territoiresFixture })).toEqual([])
    expect(presetsDisponibles({ territoire: null, contextes, territoires: territoiresFixture })).toEqual([])
  })
})

describe('libellés de la puce de sélection', () => {
  it('la portée résolue du défaut/preset ; le compte des membres tapés ; « Aucune comparaison »', () => {
    expect(libelleSelectionComparaison(resoudre({ territoire: commune, demande: undefined })))
      .toBe('communes de EPCI X')
    expect(libelleSelectionComparaison(resoudre({ territoire: commune, demande: 'densite' })))
      .toBe('grands centres urbains bretons')
    expect(libelleSelectionComparaison(resoudre({ territoire: commune, demande: '' })))
      .toBe('Aucune comparaison')
    expect(libelleSelectionComparaison(resoudre({ territoire: commune, demande: 'commune:22001,commune:22002' })))
      .toBe('2 communes')
  })

  it('libelleMembres : singulier/pluriel et niveaux mixtes', () => {
    expect(libelleMembres([{ territory_type: 'commune', territory_id: '22001' }])).toBe('1 commune')
    expect(libelleMembres([
      { territory_type: 'epci', territory_id: '200000001' },
      { territory_type: 'epci', territory_id: '200000002' },
    ])).toBe('2 EPCI')
    expect(libelleMembres([
      { territory_type: 'commune', territory_id: '22001' },
      { territory_type: 'epci', territory_id: '200000001' },
    ])).toBe('2 territoires')
    expect(libelleMembres([])).toBe('Aucune comparaison')
  })
})

describe('développement des membres en cohortes communales (voie Mobilité)', () => {
  it('un membre EPCI se développe en ses communes, triées et dédupliquées', () => {
    expect(developperMembresCommunes(
      [{ territory_type: 'epci', territory_id: '200000001' }],
      territoiresFixture,
    )).toEqual([
      { territory_type: 'commune', territory_id: '22001' },
      { territory_type: 'commune', territory_id: '22002' },
    ])
  })

  it('la région se développe en toutes les communes ; les communes passent telles quelles', () => {
    const toutes = territoiresFixture.filter((t) => t.type === 'commune')
      .map((t) => ({ territory_type: 'commune' as const, territory_id: t.territoire }))
      .sort((a, b) => a.territory_id.localeCompare(b.territory_id))
    expect(developperMembresCommunes([{ territory_type: 'region', territory_id: '53' }], territoiresFixture))
      .toEqual(toutes)
    expect(developperMembresCommunes(
      [{ territory_type: 'commune', territory_id: '22002' }, { territory_type: 'commune', territory_id: '22001' }],
      territoiresFixture,
    )).toEqual([
      { territory_type: 'commune', territory_id: '22001' },
      { territory_type: 'commune', territory_id: '22002' },
    ])
  })
})

describe('les aides conservées du contrat', () => {
  it('conserve la sélection dans les liens vers une autre fiche (chaîne vide comprise)', () => {
    expect(queryTerritoireAvecComparaison({ comparaison: 'epci', variant: 'E' }, 'mobilite'))
      .toEqual({ theme: 'mobilite', comparaison: 'epci' })
    expect(queryTerritoireAvecComparaison({ comparaison: '', variant: 'E' }, 'mobilite'))
      .toEqual({ theme: 'mobilite', comparaison: '' })
    expect(queryTerritoireAvecComparaison({ comparaison: 'commune:22001,commune:22002' }, 'mobilite'))
      .toEqual({ theme: 'mobilite', comparaison: 'commune:22001,commune:22002' })
    expect(queryTerritoireAvecComparaison({ variant: 'E' }, 'mobilite'))
      .toEqual({ theme: 'mobilite' })
  })

  it('résout le territoire de référence AEDAR depuis le preset actif (jamais depuis une sélection tapée)', () => {
    const bretagne = { type: 'region' as const, id: '53', nom: 'Bretagne' }
    expect(territoireReferencePourComparaison({ territoire: commune, mode: 'epci', territoires: territoiresFixture }))
      .toEqual({ type: 'epci', id: '200000001', nom: 'EPCI X' })
    expect(territoireReferencePourComparaison({ territoire: commune, mode: 'bretagne', territoires: territoiresFixture }))
      .toEqual(bretagne)
    expect(territoireReferencePourComparaison({ territoire: commune, mode: 'densite', territoires: territoiresFixture }))
      .toBeNull()
    expect(territoireReferencePourComparaison({ territoire: commune, mode: null, territoires: territoiresFixture }))
      .toBeNull()
    expect(territoireReferencePourComparaison({ territoire: epci, mode: null, territoires: territoiresFixture }))
      .toEqual(bretagne)
    expect(territoireReferencePourComparaison({ territoire: region, mode: null, territoires: territoiresFixture }))
      .toBeNull()
    expect(territoireReferencePourComparaison({
      territoire: { ...commune, epci: null },
      mode: 'epci',
      territoires: territoiresFixture,
    })).toBeNull()
  })
})
