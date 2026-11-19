import { describe, expect, it } from 'vitest'

import {
  histoiresDemographieFixture,
  histoiresEconomieFixture,
  histoiresMilieuxFixture,
  histoiresMobiliteFixture,
  indicateursDemographieFixture,
  indicateursEconomieFixture,
  indicateursMilieuxFixture,
  indicateursMobiliteFixture,
  indicateursProgrammesFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PayloadError, parsePayload, validerTerritoires, validerTerritoiresMetadata, validerCatalogueNavigateur, validerThemeMetadata, verifierClassesDensite, verifierClassificationLittorale } from '../payload/validate'
import type { HistoireDemographie, HistoireMilieux, Payload } from '../payload/types'

type DocumentsBruts = Parameters<typeof parsePayload>[0]

describe('contrat des classes de densité communale', () => {
  const classes = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), {
    code: String(index + 1),
    libelle_insee: `Libellé INSEE ${index + 1}`,
    libelle_public: `Libellé public ${index + 1}`,
  }]))
  const metadata = {
    schema_version: '1',
    territory_reference_label: 'Référentiel territorial — classes de densité communale',
    density_classes: classes,
    source_records: {
      classe_densite_communale: {
        dataset: 'Grille de densité 2025 — maille communale',
        publisher: 'INSEE',
        url: 'https://www.insee.fr/fr/statistiques/fichier/8571524/fichier_diffusion_2026.xlsx',
        licence: 'Licence Ouverte 2.0',
        sha256: '8ebf3011743db45ab94c4ffb74d1bcb06929f0076ecd5b8247011bca861ca978',
        vintage: 'Classification 2025 · géographie communale au 01/01/2026 · RP 2021',
        freshness: 'Publication INSEE du 15 mai 2026',
      },
    },
  }

  it('valide les sept classes via le registre publié, sans mapping app-side', () => {
    const territoires = validerTerritoires([
      { territoire: '22001', type: 'commune', nom: 'A', departement: '22', epci: null, classe_densite_code: classes['1'].code, classe_densite_libelle_insee: classes['1'].libelle_insee, classe_densite_libelle_public: classes['1'].libelle_public },
      { territoire: '200000001', type: 'epci', nom: 'EPCI', departement: '22', epci: null, classe_densite_code: null, classe_densite_libelle_insee: null, classe_densite_libelle_public: null },
    ], 'territoires.json')
    const parsed = validerTerritoiresMetadata(metadata, 'territoires-metadata.json')
    expect(parsed.density_classes).toHaveProperty('7')
    verifierClassesDensite(territoires, parsed)
  })

  it('refuse une commune avec une classe non publiée par le registre', () => {
    const territoires = validerTerritoires([
      { territoire: '22001', type: 'commune', nom: 'A', departement: '22', epci: null, classe_densite_code: '8', classe_densite_libelle_insee: 'Classe inconnue', classe_densite_libelle_public: 'Classe inconnue' },
    ], 'territoires.json')
    const parsed = validerTerritoiresMetadata(metadata, 'territoires-metadata.json')
    expect(() => verifierClassesDensite(territoires, parsed)).toThrow('classe de densité inconnue')
  })

  it('refuse un registre de sept entrées qui ne correspond pas aux codes 1 à 7', () => {
    const classesDecalees = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 8), {
      code: String(index + 8),
      libelle_insee: `Libellé INSEE ${index + 8}`,
      libelle_public: `Libellé public ${index + 8}`,
    }]))
    expect(() => validerTerritoiresMetadata({ ...metadata, density_classes: classesDecalees }, 'territoires-metadata.json'))
      .toThrow('codes 1 à 7')
  })
})

describe('contrat de la classification littorale (#1041)', () => {
  const classes = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), {
    code: String(index + 1),
    libelle_insee: `Libellé INSEE ${index + 1}`,
    libelle_public: `Libellé public ${index + 1}`,
  }]))
  const metadata = {
    schema_version: '1',
    territory_reference_label: 'Référentiel territorial — classifications communales',
    density_classes: classes,
    source_records: {
      classe_densite_communale: {
        dataset: 'Grille de densité 2025 — maille communale',
        publisher: 'INSEE',
        url: 'https://www.insee.fr/fr/statistiques/fichier/8571524/fichier_diffusion_2026.xlsx',
        licence: 'Licence Ouverte 2.0',
        sha256: '8ebf3011743db45ab94c4ffb74d1bcb06929f0076ecd5b8247011bca861ca978',
        vintage: 'Classification 2025 · géographie communale au 01/01/2026 · RP 2021',
        freshness: 'Publication INSEE du 15 mai 2026',
      },
      classe_littorale_communale: {
        dataset: 'Communes littorales en Bretagne au titre de la loi',
        publisher: 'DREAL Bretagne',
        url: 'https://www.data.gouv.fr/datasets/communes-littorales-en-bretagne-au-titre-de-la-loi',
        acquisition_url: 'https://geobretagne.fr/geoserver/dreal_b/l_communes_littorales/wfs',
        licence: 'Licence Ouverte 2.0 (lov2)',
        sha256: 'd68f20e7ea2928ac36e104201fdd81327b610a384c1a3a6d6c33521fe61153cc',
        vintage: 'Liste positive DREAL Bretagne — métadonnées de diffusion du 2023-04-21',
        freshness: 'Dernière modification déclarée par data.gouv.fr le 21 avril 2023',
        definition: 'Communes définies par la loi Littoral de 1986, complétées par le décret 2004-311.',
        coverage: 'Liste positive exhaustive pour les quatre départements bretons.',
        classements: ['Mer', 'Estuaire'],
        vintages: [{
          id: 'classe_littorale_communale',
          label: 'Communes littorales en Bretagne au titre de la loi',
          version: 'Liste positive DREAL Bretagne — diffusion 2023-04-21',
          licence: 'Licence Ouverte 2.0 (lov2)',
          dateReference: null,
          datePublication: '2023-04-21',
        }],
      },
    },
  }

  const commune = (territoire: string, littoral_code: string | null, classement: string | null = null) => ({
    territoire, type: 'commune' as const, nom: territoire, departement: '22', epci: null,
    littoral_code, littoral_classement_source: classement,
  })

  it('accepte une référence de transition qui ne porte pas le littoral', () => {
    const territoires = validerTerritoires([
      { territoire: '22001', type: 'commune', nom: 'A', departement: '22', epci: null },
    ], 'territoires.json')
    expect(territoires[0]!.littoral_code).toBeUndefined()
    expect(() => verifierClassificationLittorale(territoires, null)).not.toThrow()
  })

  it('accepte C/NC complets, îles comprises, et exige la provenance', () => {
    const territoires = validerTerritoires([
      commune('29083', 'C', 'Mer'),
      commune('29084', 'C', 'Mer'),
      commune('29209', 'NC'),
      { territoire: '22', type: 'departement', nom: 'Côtes-d’Armor', departement: '22', epci: null, littoral_code: null, littoral_classement_source: null },
    ], 'territoires.json')
    const parsed = validerTerritoiresMetadata(metadata, 'territoires-metadata.json')
    expect(parsed.source_records['classe_littorale_communale']?.publisher).toBe('DREAL Bretagne')
    expect(() => verifierClassificationLittorale(territoires, parsed)).not.toThrow()
  })

  it('honore le registre de classements SERVI, sans dupliquer le domaine source', () => {
    const avecLac = structuredClone(metadata)
    avecLac.source_records.classe_littorale_communale.classements = ['Mer', 'Estuaire', 'Lac']
    const territoires = validerTerritoires([commune('29083', 'C', 'Lac')], 'territoires.json')
    const parsed = validerTerritoiresMetadata(avecLac, 'territoires-metadata.json')
    expect(() => verifierClassificationLittorale(territoires, parsed)).not.toThrow()

    const seulementMer = structuredClone(metadata)
    seulementMer.source_records.classe_littorale_communale.classements = ['Mer']
    const estuaire = validerTerritoires([commune('56086', 'C', 'Estuaire')], 'territoires.json')
    const registreMer = validerTerritoiresMetadata(seulementMer, 'territoires-metadata.json')
    expect(() => verifierClassificationLittorale(estuaire, registreMer))
      .toThrow('classement littoral source incohérent')

    const doublon = structuredClone(metadata)
    doublon.source_records.classe_littorale_communale.classements = ['Mer', 'Mer']
    expect(() => validerTerritoiresMetadata(doublon, 'territoires-metadata.json'))
      .toThrow('classements')
  })

  it('accepte une dateReference absente et conserve la date de diffusion', () => {
    const parsed = validerTerritoiresMetadata(metadata, 'territoires-metadata.json')
    const vintages = parsed.source_records['classe_littorale_communale']?.vintages
    expect(vintages?.[0]?.dateReference).toBeNull()
    expect(vintages?.[0]?.datePublication).toBe('2023-04-21')
  })

  it('refuse une classification partielle, inconnue ou portée par un non-commune', () => {
    expect(() => validerTerritoires([
      commune('29083', 'C', 'Mer'),
      { territoire: '29209', type: 'commune', nom: 'Plouvien', departement: '29', epci: null, littoral_code: null, littoral_classement_source: null },
    ], 'territoires.json')).toThrow('littoral_code')

    // Un classement source non vide est structurellement valide ; c'est le
    // registre SERVI qui décide s'il est admis (test suivant).
    expect(() => validerTerritoires([
      commune('29083', 'C', 'Lac'),
    ], 'territoires.json')).not.toThrow()

    // Les deux colonnes présentes mais vides : même refus que côté R.
    expect(() => validerTerritoires([
      { territoire: '29083', type: 'commune', nom: 'Île-de-Sein', departement: '29', epci: null, littoral_code: null, littoral_classement_source: null },
    ], 'territoires.json')).toThrow('littoral_code')

    expect(() => validerTerritoires([
      commune('29209', 'NC', 'Mer'),
    ], 'territoires.json')).toThrow('classement source')

    expect(() => validerTerritoires([
      { territoire: '22', type: 'departement', nom: 'Côtes-d’Armor', departement: '22', epci: null, littoral_code: 'C', littoral_classement_source: 'Mer' },
    ], 'territoires.json')).toThrow('classification littorale')
  })

  it('valide la référence réellement servie par R (contrat R -> référence -> app)', async () => {
    const fs = await import('node:fs')
    const document = JSON.parse(fs.readFileSync(
      'src/__tests__/fixtures/littoral-reference-served.json', 'utf8'))
    const territoires = validerTerritoires(document.territoires, 'territoires.json')
    const parsed = validerTerritoiresMetadata(document.metadata, 'territoires-metadata.json')
    expect(() => verifierClassificationLittorale(territoires, parsed)).not.toThrow()
    expect(territoires.find((t) => t.territoire === '29083')?.littoral_code).toBe('C')
    expect(territoires.find((t) => t.territoire === '29084')?.littoral_code).toBe('C')
    expect(territoires.find((t) => t.territoire === '29209')?.littoral_code).toBe('NC')
    expect(territoires.find((t) => t.territoire === '22')?.littoral_code).toBeNull()
  })

  it('exige la source littorale dans les métadonnées et valide son empreinte', () => {
    const sansSource = structuredClone(metadata)
    delete (sansSource.source_records as Record<string, unknown>).classe_littorale_communale
    const territoires = validerTerritoires([commune('29083', 'C', 'Mer')], 'territoires.json')
    const parsed = validerTerritoiresMetadata(sansSource, 'territoires-metadata.json')
    expect(() => verifierClassificationLittorale(territoires, parsed))
      .toThrow('classe_littorale_communale')

    const empreinteInvalide = structuredClone(metadata)
    empreinteInvalide.source_records.classe_littorale_communale.sha256 = 'pas-une-empreinte'
    expect(() => validerTerritoiresMetadata(empreinteInvalide, 'territoires-metadata.json'))
      .toThrow('sha256')
  })
})

describe('metadata de trajectoire raccordement', () => {
  it('accepts either the historical producer grid or the declared complete national grid without owning its points', async () => {
    const fs = await import('node:fs')
    const metadata = JSON.parse(fs.readFileSync('../pipeline/inst/extdata/theme-metadata/theme_mobilite.json', 'utf8'))
    const parsed = validerThemeMetadata(metadata, 'theme_mobilite.json')
    expect(parsed.indicator_pages?.raccordement_courbe?.family).toBe('trajectory')
    const historic = JSON.parse(fs.readFileSync('../public/data/theme_mobilite.json', 'utf8'))
    expect(validerCatalogueNavigateur(historic, 'theme_mobilite.json').indicator_pages?.raccordement_courbe?.family).toBe('trajectory')
    const malformed = structuredClone(metadata)
    malformed.indicator_pages.raccordement_courbe.comparison.details[2] = malformed.indicator_pages.raccordement_courbe.comparison.details[1]
    expect(() => validerThemeMetadata(malformed, 'theme_mobilite.json')).toThrow('comparison.details')
  })

  it('preserves the optional native tick numeric coordinate and rejects a non-finite one', async () => {
    const fs = await import('node:fs')
    const metadata = JSON.parse(fs.readFileSync('../pipeline/inst/extdata/theme-metadata/theme_mobilite.json', 'utf8'))
    const ticks = metadata.indicator_pages.raccordement_courbe.trajectory.ticks
    ticks[0].numericValue = 0
    ticks[1].numericValue = 15
    const parsed = validerThemeMetadata(metadata, 'theme_mobilite.json')
    const page = parsed.indicator_pages?.raccordement_courbe
    expect(page?.family).toBe('trajectory')
    if (page?.family === 'trajectory') {
      expect(page.trajectory?.ticks?.slice(0, 2)).toEqual([
        expect.objectContaining({ detail: 't0000', numericValue: 0 }),
        expect.objectContaining({ detail: 't0015', numericValue: 15 }),
      ])
    }

    const invalid = structuredClone(metadata)
    invalid.indicator_pages.raccordement_courbe.trajectory.ticks[0].numericValue = 'bad'
    expect(() => validerThemeMetadata(invalid, 'theme_mobilite.json')).toThrow('numericValue')
  })
})
/**
 * The app's half of validate_payload() (docs/architecture.md §The fiche
 * payload): drift on the pipeline side must surface here as a loud,
 * typed error — never as silent wrong figures. The validators are pure:
 * raw JSON shapes in, typed structures out (or PayloadError).
 */

function documentsBruts(overrides: Partial<DocumentsBruts> = {}): DocumentsBruts {
  return {
    territoires: territoiresFixture,
    indicateurs: indicateursDemographieFixture,
    histoires: histoiresDemographieFixture,
    runReport: runReportFraisFixture,
    vintages: vintagesFixture,
    ...overrides,
  }
}

/** The Économie documents — the same fixture payload, theme swapped. */
function documentsEconomie(overrides: Partial<DocumentsBruts> = {}): DocumentsBruts {
  return documentsBruts({
    indicateurs: indicateursEconomieFixture,
    histoires: histoiresEconomieFixture,
    ...overrides,
  })
}

/** Les documents Mobilité — les faits retenus, sans lecture de snapshot (#1048). */
function documentsMobilite(overrides: Partial<DocumentsBruts> = {}): DocumentsBruts {
  return documentsBruts({
    indicateurs: indicateursMobiliteFixture,
    histoires: histoiresMobiliteFixture,
    ...overrides,
  })
}

/** The Milieux documents (issue #171→#174) — the fixture payload, theme swapped. */
function documentsMilieux(overrides: Partial<DocumentsBruts> = {}): DocumentsBruts {
  return documentsBruts({
    indicateurs: indicateursMilieuxFixture,
    histoires: histoiresMilieuxFixture,
    ...overrides,
  })
}

function attendErreurValidation(documents: DocumentsBruts): PayloadError {
  let erreur: unknown
  try {
    parsePayload(documents)
  } catch (e) {
    erreur = e
  }
  expect(erreur).toBeInstanceOf(PayloadError)
  const payloadError = erreur as PayloadError
  expect(payloadError.kind).toBe('validation')
  return payloadError
}

describe('parsePayload — accepts the contract shape', () => {
  it('parses the fixture documents into a typed payload', () => {
    const payload = parsePayload(documentsBruts())

    expect(payload.territoires).toHaveLength(9)
    expect(payload.indicateurs).toHaveLength(indicateursDemographieFixture.length)
    expect(payload.histoires).toHaveLength(9)
    expect(payload.runReport?.mode).toBe('full')
    expect(payload).toSatisfy((p: Payload) => p.territoires.every((t) => t.nom.length > 0))
  })

  it('accepts a null run-report (absent — the static-rhythm fallback)', () => {
    const payload = parsePayload(documentsBruts({ runReport: null }))

    expect(payload.runReport).toBeNull()
  })

  it('accepts null ranks (NA = no comparison group at that level)', () => {
    const payload = parsePayload(documentsBruts())

    const epci = payload.indicateurs.find((i) => i.territoire === '200000001')
    expect(epci?.rang_epci).toBeNull()
  })





  it('rejects a fractional rank (the legacy percentile form — ADR-0015 retires Pxx)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].rang_epci = 0.25

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/rang/i)
  })

  it('rejects a rank exceeding its group size (competition ranking — rang ≤ rang_*_n)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    // la densité de 22001 est classée 1er/2 dans son EPCI — un rang 25 dépasse
    // la taille du groupe (le « / Y » du rendu), jamais silencieux
    indicateurs[0].rang_epci = 25

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/rang/i)
  })

  it('rejects a group size without its rank (les deux vont ensemble — ADR-0015)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].rang_epci = null

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/rang/i)
  })

  it('rejects a negative rank', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].rang_dep = -0.5

    attendErreurValidation(documentsBruts({ indicateurs }))
  })

  it('accepts a FUTURE projection without the six rank columns (#892) — all six absent, read as null', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    const colonnes = ['rang_epci', 'rang_epci_n', 'rang_dep', 'rang_dep_n', 'rang_reg', 'rang_reg_n'] as const
    for (const ligne of indicateurs) {
      for (const colonne of colonnes) {
        delete (ligne as Partial<(typeof indicateursDemographieFixture)[number]>)[colonne]
      }
    }

    const payload = parsePayload(documentsBruts({ indicateurs }))

    expect(payload.indicateurs.length).toBeGreaterThan(0)
    for (const ligne of payload.indicateurs) {
      for (const colonne of colonnes) {
        expect(ligne[colonne]).toBeNull()
      }
    }
  })

  it('still accepts the already-committed JSON that carries the legacy rank columns (#892)', () => {
    const payload = parsePayload(documentsBruts())

    const densite = payload.indicateurs.find((i) => i.territoire === '22001' && i.key === 'densite')
    expect(densite?.rang_epci).toBe(1)
    expect(densite?.rang_epci_n).toBe(2)
  })

  it('accepts the six columns all present with valid null pairs (#892 — the old form, NA included)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    const colonnes = ['rang_epci', 'rang_epci_n', 'rang_dep', 'rang_dep_n', 'rang_reg', 'rang_reg_n'] as const
    for (const ligne of indicateurs) {
      for (const colonne of colonnes) {
        (ligne as unknown as Record<string, unknown>)[colonne] = null
      }
    }

    const payload = parsePayload(documentsBruts({ indicateurs }))

    for (const ligne of payload.indicateurs) {
      for (const colonne of colonnes) {
        expect(ligne[colonne]).toBeNull()
      }
    }
  })

  it('rejects a PARTIAL omission of the six columns (#892 — the block is all-or-nothing, never normalized)', () => {
    // une seule colonne manquante (5 présentes sur 6) : forme malformée
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    delete (indicateurs[0] as Partial<(typeof indicateursDemographieFixture)[number]>).rang_epci

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/rang/i)
  })

  it('rejects the missing member of a null-valued pair (#892 — « rang_epci: null » present, « rang_epci_n » absent)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].rang_epci = null // clé présente, valeur null
    delete (indicateurs[0] as Partial<(typeof indicateursDemographieFixture)[number]>).rang_epci_n // membre absent

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/rang/i)
  })

  it('rejects other partial shapes: a whole pair absent (#892) or a single size column absent', () => {
    // paire rang_reg/rang_reg_n entièrement absente (4 présentes sur 6)
    const sansPaireReg = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    delete (sansPaireReg[0] as Partial<(typeof sansPaireReg)[number]>).rang_reg
    delete (sansPaireReg[0] as Partial<(typeof sansPaireReg)[number]>).rang_reg_n
    expect(attendErreurValidation(documentsBruts({ indicateurs: sansPaireReg })).message).toMatch(/rang/i)

    // une seule taille absente (5 présentes sur 6) — même refus, même sans rang porté
    const sansTaille = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    delete (sansTaille[0] as Partial<(typeof sansTaille)[number]>).rang_dep_n
    expect(attendErreurValidation(documentsBruts({ indicateurs: sansTaille })).message).toMatch(/rang/i)
  })

  it('still rejects a PRESENT rank whose group size value is null (#892 — malformed present pair fails)', () => {
    // les six colonnes sont présentes, mais le rang est porté sans sa taille
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].rang_epci_n = null

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/rang/i)
  })

  it('rejects a MIXED document — some rows with all six columns, others with none (#892 homogeneous block per array)', () => {
    // ligne 0 : forme commise (six présentes) ; ligne 1 : forme future (six absentes).
    // Chaque ligne passe seule le contrôle par ligne, mais le document est hétérogène.
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    const colonnes = ['rang_epci', 'rang_epci_n', 'rang_dep', 'rang_dep_n', 'rang_reg', 'rang_reg_n'] as const
    for (const colonne of colonnes) {
      delete (indicateurs[1] as Partial<(typeof indicateursDemographieFixture)[number]>)[colonne]
    }

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/rang/i)
  })

  it('accepts an empty indicateurs array (#892 — no rows, no rank shape to homogenize)', () => {
    const payload = parsePayload(documentsBruts({ indicateurs: [] }))
    expect(payload.indicateurs).toEqual([])
  })

  it('rejects a missing required column (unit)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    delete (indicateurs[0] as Partial<(typeof indicateursDemographieFixture)[number]>).unit

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/unit/i)
  })

  it('rejects a value of the wrong type (string instead of number)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].value = '200' as unknown as number

    attendErreurValidation(documentsBruts({ indicateurs }))
  })

  it('rejects a malformed vintage date', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].vintage_date_reference = '2023/01/01'

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/vintage/i)
  })

  it('rejects a theme outside the canonical set', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].theme = 'energie' as unknown as 'demographie'

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/theme/i)
  })

  it('rejects duplicate territoires in the reference table', () => {
    const territoires = JSON.parse(JSON.stringify(territoiresFixture)) as typeof territoiresFixture
    territoires.push({ ...territoires[0] })

    const erreur = attendErreurValidation(documentsBruts({ territoires }))
    expect(erreur.message).toMatch(/territoire/i)
  })

  it('accepts a commune without an EPCI in the reference table (the three islands, fix #131)', () => {
    // Les trois îles (22016, 29083, 29155) n'ont pas d'EPCI — « Sans objet » —
    // la commune sans EPCI est désormais légitime dans la référence (issue #120).
    const territoires = JSON.parse(JSON.stringify(territoiresFixture)) as typeof territoiresFixture
    territoires[0].epci = null

    const payload = parsePayload(documentsBruts({ territoires }))
    expect(payload.territoires.find((t) => t.territoire === '22001')?.epci).toBeNull()
  })

  it('rejects a commune whose EPCI is unknown to the reference (ladder integrity kept)', () => {
    // L'intégrité référentielle de l'échelle reste verrouillée : un SIREN
    // inconnu casse le contexte switcher (commune → EPCI → département → région).
    const territoires = JSON.parse(JSON.stringify(territoiresFixture)) as typeof territoiresFixture
    territoires[0].epci = '999999999'

    const erreur = attendErreurValidation(documentsBruts({ territoires }))
    expect(erreur.message).toMatch(/EPCI/i)
  })

  it('rejects a non-commune carrying an EPCI', () => {
    const territoires = JSON.parse(JSON.stringify(territoiresFixture)) as typeof territoiresFixture
    territoires[5].epci = '200000001'

    attendErreurValidation(documentsBruts({ territoires }))
  })

  it('rejects facts that cite an unknown territory', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].territoire = '99999'

    attendErreurValidation(documentsBruts({ indicateurs }))
  })

  it('rejects duplicate indicateur rows (territoire × key × detail)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs.push({ ...indicateurs[0] })

    attendErreurValidation(documentsBruts({ indicateurs }))
  })

  it('rejects a Démographie histoire missing the annualized rates (ADR-0011)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresDemographieFixture)) as typeof histoiresDemographieFixture
    delete (histoires[0] as Partial<HistoireDemographie>).taux_solde_naturel
    delete (histoires[0] as Partial<HistoireDemographie>).taux_solde_migratoire

    attendErreurValidation(documentsBruts({ histoires }))
  })

  it('rejects a run-report missing its timestamp', () => {
    const runReport = JSON.parse(JSON.stringify(runReportFraisFixture)) as typeof runReportFraisFixture
    delete (runReport as Partial<typeof runReportFraisFixture>).timestamp

    attendErreurValidation(documentsBruts({ runReport }))
  })

  it('rejects a run-report with an unknown source status', () => {
    const runReport = JSON.parse(JSON.stringify(runReportFraisFixture)) as typeof runReportFraisFixture
    runReport.statuts[0].status = 'mystere' as unknown as 'frais'

    attendErreurValidation(documentsBruts({ runReport }))
  })

  it('rejects a non-array facts document (shape drift, not a content drift)', () => {
    attendErreurValidation(documentsBruts({ indicateurs: { not: 'an array' } }))
  })

  it('rejects a non-array vintages document (shape drift)', () => {
    attendErreurValidation(documentsBruts({ vintages: { id: 'serie_historique' } }))
  })

  it('rejects a vintage row missing its source', () => {
    const vintages = JSON.parse(JSON.stringify(vintagesFixture)) as typeof vintagesFixture
    delete (vintages[0] as Partial<(typeof vintagesFixture)[number]>).source

    const erreur = attendErreurValidation(documentsBruts({ vintages }))
    expect(erreur.message).toMatch(/source/i)
  })

  it('rejects a malformed vintage date — drift must be loud, never silent', () => {
    const vintages = JSON.parse(JSON.stringify(vintagesFixture)) as typeof vintagesFixture
    vintages[0].date_reference = '2023/01/01'

    const erreur = attendErreurValidation(documentsBruts({ vintages }))
    expect(erreur.message).toMatch(/date_reference/i)
  })
})

/**
 * Le contrat de la structure par âge (issue #390) : SEPT tranches d'âge FIXES ×
 * exactement {F, M} par territoire — 14 lignes. Les tranches attendues sont le
 * contrat déclaré, jamais une dérivation de ce que le payload porte : c'est
 * précisément ce qui permet d'attraper une tranche ENTIÈREMENT absente (ses deux
 * sexes manquants), qu'une validation dérivée laisserait passer sans un mot.
 */
describe('parsePayload — le contrat âge×sexe de la structure par âge (issue #390)', () => {
  type Indicateurs = typeof indicateursDemographieFixture
  type LigneIndicateur = Indicateurs[number] & { sex?: string | null }

  /** Les lignes structure_age du fixture (14, pour 22001). */
  function lignesStructureAge(indicateurs: Indicateurs): LigneIndicateur[] {
    return (indicateurs as LigneIndicateur[]).filter((l) => l.key === 'structure_age')
  }

  function copieFixture(): Indicateurs {
    return JSON.parse(JSON.stringify(indicateursDemographieFixture)) as Indicateurs
  }

  it('accepte la forme complète — 7 tranches × {F, M} = 14 lignes par territoire', () => {
    const payload = parsePayload(documentsBruts())

    const lignes = lignesStructureAge(payload.indicateurs as unknown as Indicateurs)
    expect(lignes).toHaveLength(14)
    expect(new Set(lignes.map((l) => l.detail))).toEqual(
      new Set(['<15', '15-24', '25-39', '40-54', '55-64', '65-79', '80+']),
    )
    // chaque tranche porte EXACTEMENT F et M
    for (const tranche of ['<15', '15-24', '25-39', '40-54', '55-64', '65-79', '80+']) {
      const sexes = lignes.filter((l) => l.detail === tranche).map((l) => l.sex)
      expect(sexes.sort(), tranche).toEqual(['F', 'M'])
    }
  })

  it('refuse une TRANCHE entièrement absente (ses deux sexes manquants) — le trou qu’une validation dérivée rate', () => {
    // on retire les DEUX lignes de « 55-64 » : les tranches présentes restent
    // cohérentes par paires, donc seule une attente FIXE peut voir le trou
    const indicateurs = copieFixture().filter(
      (l) => !(l.key === 'structure_age' && l.detail === '55-64'),
    ) as Indicateurs

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/55-64/)
    expect(erreur.message).toMatch(/manquante/i)
  })

  it('refuse un SEXE manquant sur une tranche (une pyramide à un seul côté)', () => {
    const indicateurs = copieFixture().filter(
      (l) =>
        !(l.key === 'structure_age' && l.detail === '<15' && (l as LigneIndicateur).sex === 'M'),
    ) as Indicateurs

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/manquante/i)
    expect(erreur.message).toMatch(/« M »/)
  })

  it('refuse une représentation MIXTE sexe / null (un payload à moitié migré)', () => {
    const indicateurs = copieFixture()
    const ligne = lignesStructureAge(indicateurs).find((l) => l.detail === '<15' && l.sex === 'F')!
    ligne.sex = null

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/mixte/i)
  })

  it('refuse un sexe INVALIDE (jamais « _T », jamais autre chose que F / M)', () => {
    const indicateurs = copieFixture()
    const ligne = lignesStructureAge(indicateurs).find((l) => l.detail === '<15' && l.sex === 'F')!
    // « _T » est hors du type publié : c'est exactement la dérive qu'un payload
    // réel peut porter et que la validation doit refuser au lieu de la croire
    ;(ligne as { sex: string | null }).sex = '_T'

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/sex/)
    expect(erreur.message).toMatch(/_T/)
  })

  it('refuse une paire âge×sexe EN DOUBLE (la même tranche, le même sexe, deux fois)', () => {
    const indicateurs = copieFixture()
    const ligne = lignesStructureAge(indicateurs).find((l) => l.detail === '<15' && l.sex === 'F')!
    ;(indicateurs as LigneIndicateur[]).push({ ...ligne })

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/double/i)
  })

  it('refuse une tranche HORS CONTRAT (« 90+ » n’est pas un étage bonus)', () => {
    const indicateurs = copieFixture()
    for (const ligne of lignesStructureAge(indicateurs)) {
      if (ligne.detail === '80+') ligne.detail = '90+'
    }

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/hors contrat/i)
    expect(erreur.message).toMatch(/90\+/)
  })

  /**
   * Le repli HÉRITÉ (pré-#390) que l'issue #390 prévoit explicitement : le
   * payload committé porte encore 7 lignes sans sexe (le pipeline ne l'a pas
   * republié). Cette forme est acceptée telle quelle — mais elle reste STRICTE
   * sur les sept tranches : la dérive de schéma y est détectée comme ailleurs.
   */
  it('accepte la forme héritée (7 tranches, aucune sexuée) — le repli d’avant la republication', () => {
    // on retire les 7 lignes « M » et on dé-sexue les 7 « F » → la forme pré-#390
    const sansM = copieFixture().filter(
      (l) => !(l.key === 'structure_age' && (l as LigneIndicateur).sex === 'M'),
    ) as Indicateurs
    for (const ligne of lignesStructureAge(sansM)) delete ligne.sex

    const payload = parsePayload(documentsBruts({ indicateurs: sansM }))

    const publiees = lignesStructureAge(payload.indicateurs as unknown as Indicateurs)
    expect(publiees).toHaveLength(7)
    expect(publiees.every((l) => l.sex === null)).toBe(true)
  })

  it('refuse une tranche manquante DANS la forme héritée aussi (jamais un angle mort)', () => {
    const sansM = copieFixture().filter(
      (l) => !(l.key === 'structure_age' && (l as LigneIndicateur).sex === 'M'),
    ) as Indicateurs
    for (const ligne of lignesStructureAge(sansM)) delete ligne.sex
    const tronquee = sansM.filter(
      (l) => !(l.key === 'structure_age' && l.detail === '25-39'),
    ) as Indicateurs

    const erreur = attendErreurValidation(documentsBruts({ indicateurs: tronquee }))
    expect(erreur.message).toMatch(/25-39/)
    expect(erreur.message).toMatch(/manquante/i)
  })
})

describe('parsePayload — the shared vintages table', () => {
  it('carries the validated vintages on the payload', () => {
    const payload = parsePayload(documentsBruts())

    expect(payload.vintages).toEqual(vintagesFixture)
  })

  it('accepts an absent vintages table (null — no invented sourcing)', () => {
    const payload = parsePayload(documentsBruts({ vintages: null }))

    expect(payload.vintages).toBeNull()
  })
})

describe('parsePayload — the Économie contract (issue #120, forme RÉSOLUE #312)', () => {
  it('accepts the reshaped Économie documents — 3 indicators + the resolved Stories', () => {
    const payload = parsePayload(documentsEconomie())

    expect(payload.indicateurs).toHaveLength(indicateursEconomieFixture.length)
    expect(payload.histoires).toHaveLength(histoiresEconomieFixture.length)
    // la forme résolue : UNE lecture par (territoire, groupe), le top-5 replié
    expect(payload.histoires.filter((h) => h.theme === 'economie' && h.territoire === '22001')).toHaveLength(1)
    expect(payload.histoires.filter((h) => h.theme === 'economie' && h.territoire === '22001')[0]).toMatchObject({
      groupe: 'sante-et-taille',
      story_key: 'ce-que-la-commune-abrite',
      salience_reason: 'defaut',
    })
    // la structure verte est un sous-groupe indicateur silencieux ; la région
    // ne porte donc aucune lecture Économie.
    expect(payload.histoires.filter((h) => h.territoire === '53')).toHaveLength(0)
  })

  it('rejects an Économie histoire with an unknown story_key (drift must be loud)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture)) as typeof histoiresEconomieFixture
    ;(histoires[0] as { story_key: string }).story_key = 'le-matin-la-commune-se-vide'

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/Story/)
  })

  it('rejects an Économie histoire missing the flat top-5 params (the multi-line revert)', () => {
    // La forme d'avant la résolution : le top-5 comme lignes séparées, sans les
    // paramètres plats (top1_*..top5_*) — une dérive du contrat, jamais
    // silencieuse.
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture)) as typeof histoiresEconomieFixture
    const ligneAncienne = histoires[0] as unknown as Record<string, unknown>
    delete ligneAncienne.top1_activity_code
    delete ligneAncienne.top1_activity_label

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/top1_activity_code/)
  })

  it('rejects a duplicate reading (territoire × groupe) — le pool non résolu échoue fort (#312)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture)) as typeof histoiresEconomieFixture
    histoires.push(histoires[0] as typeof histoires[0])

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/plusieurs lectures/)
  })

  it('rejects a story_key living in the wrong groupe (a displaced reading)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture)) as typeof histoiresEconomieFixture
    ;(histoires[0] as { groupe: string }).groupe = 'structure-verte'

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/vit dans le groupe/)
  })

  it('rejects a ce-que-la-commune-abrite row without its LQ (the reading IS the specialisation)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture)) as typeof histoiresEconomieFixture
    ;(histoires[0] as { top1_lq: number | null }).top1_lq = null

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/top1_lq/)
  })

  it('rejects a Story vintage malformed like an indicator one (two ISO dates + source/version)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture)) as typeof histoiresEconomieFixture
    ;(histoires[0] as { vintage_date_publication: string }).vintage_date_publication = '2026/05/01'

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/vintage/)
  })

  it('does NOT relax the one-line-per-territory invariant for the other themes', () => {
    // Démographie / Habitat inchangés : deux histoires pour le même territoire
    // restent une dérive du contrat (seul le thème Économie est multi-lignes).
    const histoires = JSON.parse(JSON.stringify(histoiresDemographieFixture)) as typeof histoiresDemographieFixture
    histoires.push({ ...histoires[0] })

    attendErreurValidation(documentsBruts({ histoires }))
  })
})

describe('parsePayload — le thème Mobilité sans lecture (#1048 slice 3)', () => {
  it('accepte les faits Mobilité retenus sans aucune ligne d’histoire', () => {
    const payload = parsePayload(documentsMobilite())

    expect(payload.indicateurs).toHaveLength(indicateursMobiliteFixture.length)
    expect(payload.histoires.filter((h) => h.theme === 'mobilite')).toEqual([])
  })

  it('ignore une ligne d’histoire résiduelle encore servie avant le republish', () => {
    const legacy = {
      territoire: '22001',
      type: 'commune',
      theme: 'mobilite',
      groupe: 'acces-aux-services',
      story_key: 'story-du-snapshot-retire',
      salience_reason: 'defaut',
    }
    const payload = parsePayload(documentsMobilite({ histoires: [legacy] }))

    expect(payload.histoires).toEqual([])
  })

  it('rejette toujours une lecture en double sur un thème qui en porte (Démographie)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresDemographieFixture))
    histoires.push({ ...histoires[0] })

    const erreur = attendErreurValidation(documentsBruts({ histoires }))
    expect(erreur.message).toMatch(/plusieurs lectures/)
  })

  it('rejette toujours un tampon d’histoire malformé sur un thème qui en porte', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture))
    histoires[0].vintage_date_publication = '2026/08/06'

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/vintage|ISO/)
  })
})
describe('parsePayload — the Milieux contract (issue #174, ADR-0014, re-keyed par la spec #225)', () => {
  it('accepts the Milieux documents — la Story unique « Se densifier, s’étaler, ou s’en aller »', () => {
    const payload = parsePayload(documentsMilieux())

    expect(payload.indicateurs).toHaveLength(indicateursMilieuxFixture.length)
    const milieux = payload.histoires.filter((h): h is HistoireMilieux => h.theme === 'milieux')
    expect(milieux).toHaveLength(histoiresMilieuxFixture.length)
    for (const histoire of milieux) {
      expect(histoire.story_key).toBe('se-densifier-setaler-ou-sen-aller')
      expect(histoire.periode_pop).toBe('2017-2023')
      expect(histoire.periode_artif?.length ?? 0).toBeGreaterThan(0)
      expect(typeof histoire.delta_population).toBe('number')
      for (const champ of [
        'artif_m2',
        'artif_m3',
        'artif_m2_par_habitant',
        'artif_m3_par_habitant',
        'trajectoire_artif_par_habitant',
      ] as const) {
        expect(typeof histoire[champ], `« ${champ} »`).toBe('number')
      }
      // l'invariant du contrat : sign(ratio − 1) = sign(delta) — le fixture
      // entier le satisfait (la lecture et le graphe ne peuvent pas diverger) ;
      // les lignes sans trajectoire (le trou NA honnête) sortent de la preuve
      const m2 = histoire.artif_m2_par_habitant
      const m3 = histoire.artif_m3_par_habitant
      const ratio = histoire.trajectoire_artif_par_habitant
      if (m2 === null || m3 === null || ratio === null) continue
      expect(Math.sign(ratio - 1)).toBe(Math.sign(m3 - m2))
    }
    // les QUATRE lectures sont exercées dans le fixture, cas de signes mélangés
    // compris (22002 densifie en grandissant, 200000002 se vide en se renaturant)
    const lectures = new Set(milieux.map((h) => h.classification))
    expect(lectures).toEqual(
      new Set([
        'grandir-en-se-densifiant',
        'grandir-en-setalant',
        'sen-aller-et-consommer-quand-meme',
        'les-departs-laissent-la-place-a-la-renaturation',
      ]),
    )
  })

  it('rejects a Milieux histoire with an unknown story_key (drift must be loud)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as { story_key: string }).story_key = 'la-fuite-vers-la-campagne'

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/inconnue du contrat/)
  })

  it('rejects a Milieux histoire with an unknown classification', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as { classification: string }).classification = 'super'

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/classification/)
  })

  it('accepts a null classification — lecture NA (total incomplet), jamais une lecture inventée', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as { classification: string | null }).classification = null

    const payload = parsePayload(documentsMilieux({ histoires }))
    const milieux = payload.histoires.filter((h): h is HistoireMilieux => h.theme === 'milieux')
    expect(milieux[0].classification).toBeNull()
  })

  it('accepts the M2 = 0 shape — trajectoire null, classification null (la découverte #243)', () => {
    // 102 communes réelles (~8 %) n'ont AUCUNE terre artificialisée à l'état
    // initial : le ratio M3/0 est indéfini, la trajectoire est null — jamais
    // un rapport infini inventé, jamais un « s'étale » fabriqué.
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    const ligne = histoires[0] as HistoireMilieux
    ligne.artif_m2 = 0
    ligne.artif_m2_par_habitant = 0
    ligne.trajectoire_artif_par_habitant = null
    ligne.classification = null

    const payload = parsePayload(documentsMilieux({ histoires }))
    const milieux = payload.histoires.filter((h): h is HistoireMilieux => h.theme === 'milieux')
    expect(milieux[0].trajectoire_artif_par_habitant).toBeNull()
    expect(milieux[0].classification).toBeNull()
  })

  it('accepts the absent-state shape — tous les états null, la lecture absente (le trou NA honnête)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    const ligne = histoires[0] as HistoireMilieux
    ligne.artif_m2 = null
    ligne.artif_m3 = null
    ligne.artif_m2_par_habitant = null
    ligne.artif_m3_par_habitant = null
    ligne.trajectoire_artif_par_habitant = null
    ligne.classification = null

    const payload = parsePayload(documentsMilieux({ histoires }))
    const milieux = payload.histoires.filter((h): h is HistoireMilieux => h.theme === 'milieux')
    expect(milieux[0].trajectoire_artif_par_habitant).toBeNull()
    expect(milieux[0].classification).toBeNull()
  })

  it('rejects a defined trajectory with M2 = 0 — le ratio M3/0 est indéfini (fix #243)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as HistoireMilieux).artif_m2 = 0
    ;(histoires[0] as HistoireMilieux).artif_m2_par_habitant = 0
    // trajectoire laissée définie (1.13) — un Inf déguisé, rejeté

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/indéfini/)
  })

  it('rejects a null trajectory with M2 > 0 — la trajectoire est requise', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as HistoireMilieux).trajectoire_artif_par_habitant = null

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/trajectoire/)
  })

  it('rejects a classification without a trajectory — jamais une lecture sans sa seconde force', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    const ligne = histoires[0] as HistoireMilieux
    ligne.artif_m2 = 0
    ligne.artif_m2_par_habitant = 0
    ligne.trajectoire_artif_par_habitant = null
    // classification laissée définie — une lecture sans sa trajectoire, rejetée

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/classification/)
  })

  it('rejects mixed states — les quatre états sont tous présents ou tous absents, jamais un mélange', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as HistoireMilieux).artif_m3 = null

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/états/)
  })

  it('rejects a Milieux histoire missing its forces (delta_population / trajectoire absents)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    delete (histoires[0] as Partial<HistoireMilieux>).delta_population

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/delta_population/)
  })

  it('rejects a Milieux histoire missing the pivot columns (periode_artif / artif_m2 absents)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    delete (histoires[0] as Partial<HistoireMilieux>).periode_artif

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/periode_artif/)
  })

  it('rejects a negative artificialized area — une surface ne peut pas être négative', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as { artif_m2: number }).artif_m2 = -5

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/artif_m2/)
  })

  it('accepts a zero trajectory — la renaturation COMPLÈTE (M3 = 0) est une trajectoire 0 réelle', () => {
    // 11 communes réelles ont M2 > 0 et M3 = 0 (la renaturation complète) :
    // la trajectoire 0 est une valeur VRAIE, jamais une corruption — la même
    // forme que le 56001 du fixture (m2ph > 0, m3ph = 0, delta négatif).
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    const ligne = histoires[0] as HistoireMilieux
    ligne.artif_m3 = 0
    ligne.artif_m3_par_habitant = 0
    ligne.trajectoire_artif_par_habitant = 0
    ligne.classification = 'grandir-en-se-densifiant'

    const payload = parsePayload(documentsMilieux({ histoires }))
    const milieux = payload.histoires.filter((h): h is HistoireMilieux => h.theme === 'milieux')
    expect(milieux[0].trajectoire_artif_par_habitant).toBe(0)
  })

  it('rejects a negative trajectory — jamais un ratio négatif', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as HistoireMilieux).trajectoire_artif_par_habitant = -1

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/trajectoire/)
  })

  it('rejects the ratio/delta contradiction — un ratio < 1 doit porter un delta < 0 (l’invariant)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    // 22001 : delta +300 (2 550 − 2 250) — un ratio < 1 se contredit
    ;(histoires[0] as { trajectoire_artif_par_habitant: number }).trajectoire_artif_par_habitant = 0.95

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/se contredisent/)
  })

  it('rejects the inverse contradiction — un ratio > 1 doit porter un delta > 0', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    // 22002 : delta −45 (855 − 900) — un ratio > 1 se contredit
    ;(histoires[1] as { trajectoire_artif_par_habitant: number }).trajectoire_artif_par_habitant = 1.2

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/se contredisent/)
  })

  it('rejects ratio == 1 avec un delta non nul — la cohérence est exacte', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as { trajectoire_artif_par_habitant: number }).trajectoire_artif_par_habitant = 1

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/se contredisent/)
  })

  it('rejects a duplicate Milieux lecture — une lecture par (territoire, groupe), jamais deux', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    histoires.push({ ...histoires[0] })

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/plusieurs lectures/)
  })
})

describe('parsePayload — the retired programmes.json (#893)', () => {
  it('never parses a programmes document — the section stays null, no validator exists for it', () => {
    const payload = parsePayload(documentsBruts())

    expect(payload.programmes).toBeNull()
  })
})

describe('parsePayload — the retired apercu.json (#894)', () => {
  it('never parses an apercu document — no section, no validator exists for it', () => {
    const payload = parsePayload(documentsBruts())

    expect('apercu' in payload).toBe(false)
  })
})

describe('parsePayload — les faits du sixième thème Programmes et subventions (#408)', () => {
  it('accepte les indicateurs du thème — la couverture catégorielle et les subventions numériques', () => {
    const payload = parsePayload(documentsBruts({ indicateurs: indicateursProgrammesFixture }))

    const programmes = payload.indicateurs.filter((i) => i.theme === 'programmes')
    expect(programmes).toHaveLength(indicateursProgrammesFixture.length)
    // l'indicateur CATÉGORIEL : value = 1, unit « adhésion », le rider sur la
    // ligne du label qui le porte
    const acv = programmes.find((i) => i.detail === 'ACV')
    expect(acv).toMatchObject({ key: 'couverture_programmes', value: 1, unit: 'adhésion', rider: 'convention valant ORT' })
    // les indicateurs NUMÉRIQUES : le total poolé (dimension = l'année) et la
    // ventilation par domaine
    expect(programmes.some((i) => i.key === 'subventions_annuelles')).toBe(true)
    expect(programmes.some((i) => i.key === 'subventions_par_domaine')).toBe(true)
  })

  it('accepte une ligne ORT sans date de publication (le suivi continu, contrat #175)', () => {
    const ort = indicateursProgrammesFixture.find((i) => i.detail === 'ORT')
    expect(ort?.vintage_date_publication ?? null).toBeNull()
    expect(ort?.vintage_date_reference).toBeTruthy()

    const payload = parsePayload(documentsBruts({ indicateurs: indicateursProgrammesFixture }))
    const ortValide = payload.indicateurs.find((i) => i.detail === 'ORT')
    expect(ortValide).toBeDefined()
  })

  it('rejette un fait SANS AUCUNE horloge (référence ET publication null)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursProgrammesFixture)) as typeof indicateursProgrammesFixture
    const premiere = indicateurs[0]
    premiere.vintage_date_reference = null
    premiere.vintage_date_publication = null

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/horloge/i)
  })

  it('rejette une date de publication non ISO (la discipline des deux dates)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursProgrammesFixture)) as typeof indicateursProgrammesFixture
    ;(indicateurs[0] as { vintage_date_publication: unknown }).vintage_date_publication = 'septembre 2025'

    attendErreurValidation(documentsBruts({ indicateurs }))
  })

  it('rejette une ligne en double (territoire × key × detail × dimension)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursProgrammesFixture)) as typeof indicateursProgrammesFixture
    const annuelle = indicateurs.find((i) => i.key === 'subventions_annuelles')!
    indicateurs.push(JSON.parse(JSON.stringify(annuelle)))

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/double/i)
  })

  it('rejette un thème de fait hors du canon (les six thèmes, #408)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursProgrammesFixture)) as typeof indicateursProgrammesFixture
    ;(indicateurs[0] as { theme: string }).theme = 'financements'

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/theme|thème/i)
  })
})
