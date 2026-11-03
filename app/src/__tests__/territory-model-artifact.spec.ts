import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import {
  histoiresDemographieFixture,
  histoiresEconomieFixture,
  histoiresHabitatFixture,
  histoiresMilieuxFixture,
  histoiresMobiliteFixture,
  indicateursDemographieFixture,
  indicateursEconomieFixture,
  indicateursHabitatFixture,
  indicateursMilieuxFixture,
  indicateursMobiliteFixture,
  indicateursProgrammesFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
  vintagesFixture,
} from '@/payload/fixtures'
import { THEMES_CANONIQUES, type Theme } from '@/payload/types'
import {
  payloadDepuisModeleTerritoire,
  validerModeleTerritoire,
} from '@/payload/territoryReadModel'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import CahierMotorisationFigure from '@/fiche/prototype/CahierMotorisationFigure.vue'
import { remplacerFaitsScalaires } from '@/payload/scalarCohort'
import { territoryModelBuffer } from '../../scripts/territory-model-dev'

/**
 * #868 — couverture conservée du VALIDATEUR de l'artefact modèle de lecture par
 * territoire (payload/territoryReadModel.ts). L'artefact reste un asset
 * producteur/récupération requis (ADR-0031, `validate:territory-model`) même si le
 * navigateur ne le charge plus : schéma/identité, complétude des six thèmes,
 * projections de comparaison/distribution/rampe malformées. Seuls les tests
 * d'ancien fetch navigateur / opt-out ('0') sont retirés — aucun fallback de
 * chargeur legacy n'est réintroduit.
 */

const target = territoiresFixture.find((territoire) => territoire.territoire === '22001')!
const modelePublie22001 = JSON.parse(readFileSync(
  resolve(process.cwd(), '../public/data/modeles-lecture/territoires/commune/22001.json'),
  'utf8',
))
const modelePublie22002 = JSON.parse(readFileSync(
  resolve(process.cwd(), '../public/data/modeles-lecture/territoires/commune/22002.json'),
  'utf8',
))

/**
 * Écrit une racine canonique minimale depuis les fixtures partagées :
 * territoires.json, vintages.json et les trois fichiers par thème canonique
 * (indicateurs_*, histoires_*, theme_*). C'est le contrat lu par
 * scripts/territory-model-dev.ts (branche de parité du validateur).
 */
function ecrireRacineCanonique(racine: string): void {
  writeFileSync(join(racine, 'territoires.json'), JSON.stringify(territoiresFixture))
  writeFileSync(join(racine, 'vintages.json'), JSON.stringify(vintagesFixture))
  const indicateurs: Record<Theme, unknown[]> = {
    mobilite: indicateursMobiliteFixture,
    demographie: indicateursDemographieFixture,
    habitat: indicateursHabitatFixture,
    economie: indicateursEconomieFixture,
    milieux: indicateursMilieuxFixture,
    programmes: indicateursProgrammesFixture,
  }
  const histoires: Record<Theme, unknown[]> = {
    mobilite: histoiresMobiliteFixture,
    demographie: histoiresDemographieFixture,
    habitat: histoiresHabitatFixture,
    economie: histoiresEconomieFixture,
    milieux: histoiresMilieuxFixture,
    programmes: [],
  }
  for (const theme of THEMES_CANONIQUES) {
    writeFileSync(join(racine, `indicateurs_${theme}.json`), JSON.stringify(indicateurs[theme]))
    writeFileSync(join(racine, `histoires_${theme}.json`), JSON.stringify(histoires[theme]))
    writeFileSync(join(racine, `theme_${theme}.json`), JSON.stringify(metadonneesThemesFixtures[theme]))
  }
}

describe('artefact modèle de lecture par territoire — contrat producteur/récupération (ADR-0031, #868)', () => {
  it('transporte le rider réel de la chaîne statique jusqu’à la figure de motorisation', () => {
    const modele = validerModeleTerritoire(
      modelePublie22002,
      'territoires/commune/22002.json',
      { type: 'commune', territoire: '22002' },
      { requireAllThemes: true },
    )
    const mobilite = modele.themes.mobilite!
    const payload = payloadDepuisModeleTerritoire(modele)
    const bornesRow = payload.indicateurs.find((row) => row.key === 'bornes_ev_par_station_service')!
    const scalarOverlay = remplacerFaitsScalaires(
      payload.indicateurs,
      [{ ...bornesRow, rider: null }],
      ['bornes_ev_par_station_service'],
    )
    const facts = territoryFactsFor({ ...payload, indicateurs: scalarOverlay }, '22002')!
    const motorisation = resolveMobiliteThemeContent(facts, mobilite.metadata).units[2]!.sections[0]!.evidence
    expect(motorisation?.kind).toBe('motorisation')
    if (motorisation?.kind !== 'motorisation') throw new Error('éléments de motorisation attendus')
    const bornes = motorisation.charging.find(({ fact }) => fact.key === 'bornes_ev_par_station_service')!
    expect(bornes.fact.reason).toBe('Aucune station-service sur le territoire')
    const rendered = mount(CahierMotorisationFigure, { props: motorisation })
    expect(rendered.text()).toContain('Indisponible')
    expect(rendered.find('.motorisation-rider').exists()).toBe(true)
    expect(rendered.find('.motorisation-rider').text()).toBe('Aucune station-service sur le territoire')
  })

  it('refuse un artefact de production qui ne porte pas les six thèmes (requireAllThemes)', () => {
    expect(() =>
      validerModeleTerritoire(
        {
          schema_version: '1',
          snapshot_id: '2026-09-15',
          territory: target,
          territoires: territoiresFixture,
          themes: {
            mobilite: {
              theme: 'mobilite',
              indicateurs: indicateursMobiliteFixture,
              histoires: histoiresMobiliteFixture,
              theme_metadata: metadonneesThemesFixtures.mobilite,
              profils_acces_bpe: null,
              distribution_acces_batiments: null,
              rampe_acces_batiments: null,
            },
          },
        },
        'territoires/commune/22001.json',
        { type: 'commune', territoire: '22001' },
        { requireAllThemes: true },
      ),
    ).toThrow(/thèmes manquants/)
  })

  it('isole une projection facultative invalide (allowPartialThemes) sans toucher à l’identité', () => {
    const rawModel = structuredClone(modelePublie22001)
    rawModel.themes.habitat.theme_metadata = null
    const model = validerModeleTerritoire(
      rawModel,
      'territoires/commune/22001.json',
      { type: 'commune', territoire: '22001' },
      { allowPartialThemes: true },
    )
    expect(model.territory).toMatchObject({ type: 'commune', territoire: '22001' })
    expect(model.themes.programmes).toBeDefined()
    expect(model.themes.habitat).toBeUndefined()
    expect(model.themeErrors?.habitat).toMatchObject({ kind: 'validation' })
  })

  it('rejette un artefact dont l’identité canonique diffère de la route attendue', () => {
    expect(() =>
      validerModeleTerritoire(
        modelePublie22001,
        'territoires/commune/22002.json',
        { type: 'commune', territoire: '22002' },
      ),
    ).toThrow(/ne correspond pas à la route/)
  })

  it('porte les faits Mobilité et ses preuves auxiliaires dans une unité atomique', () => {
    const modele = validerModeleTerritoire(
      {
        schema_version: '1',
        snapshot_id: '2026-09-15',
        territory: target,
        territoires: territoiresFixture,
        themes: {
          mobilite: {
            theme: 'mobilite',
            indicateurs: indicateursMobiliteFixture,
            histoires: histoiresMobiliteFixture,
            theme_metadata: metadonneesThemesFixtures.mobilite,
            profils_acces_bpe: [
              {
                territoire: '22001',
                type: 'commune',
                profil: 'velo-compense',
                profil_libelle: 'Le vélo compense',
                nombre_typequ: 3,
                exemplar_typequ: 'D267',
                exemplar_libelle: 'Spécialiste en dermatologie vétérinérologie',
                exemplar_c: 0.1,
                exemplar_b: 0.4,
                exemplar_t: 0.1,
              },
            ],
            distribution_acces_batiments: null,
            rampe_acces_batiments: null,
          },
        },
      },
      'territoires/commune/22001.json',
    )

    expect(modele.schemaVersion).toBe('1')
    expect(modele.territory).toEqual(target)
    expect(modele.themes.mobilite?.indicators).toHaveLength(indicateursMobiliteFixture.length)
    expect(modele.themes.mobilite?.indicators[0]).toMatchObject(indicateursMobiliteFixture[0]!)
    expect(modele.themes.mobilite?.bpeAccess).toHaveLength(1)

    // #627 - the auxiliary BPE profile rows stay VALIDATED in the raw
    // producer/recovery artifact (the validator contract is unchanged), but
    // payloadDepuisModeleTerritoire no longer projects them into the fiche
    // payload seam: the retired accessibility readers are gone.
    const payload = payloadDepuisModeleTerritoire(modele)
    expect('profilsAccesBpe' in payload).toBe(false)
    expect('distributionAccesBatiments' in payload).toBe(false)
    expect('rampeAccesBatiments' in payload).toBe(false)
    const facts = territoryFactsFor(payload, target.territoire)
    expect(facts?.territory.name).toBe(target.nom)
    expect(facts?.mobility.indicators).toHaveLength(
      indicateursMobiliteFixture.filter((row) => row.territoire === target.territoire).length)
  })

  it('porte une comparaison pré-calculée sans publier les lignes des pairs', () => {
    const indicateursCible = indicateursMobiliteFixture.filter(
      (row) => row.territoire === target.territoire ||
        (row.territoire === '53' && row.key === 'nb_buildings'),
    )
    const ligneCible = indicateursCible.find((row) => row.territoire === target.territoire)!
    const modele = validerModeleTerritoire(
      {
        schema_version: '1',
        snapshot_id: '2026-09-15',
        territory: target,
        territoires: territoiresFixture.filter((territoire) =>
          [target.territoire, target.epci, target.departement, '53'].includes(territoire.territoire),
        ),
        themes: {
          mobilite: {
            theme: 'mobilite',
            indicateurs: indicateursCible,
            histoires: histoiresMobiliteFixture.filter(
              (row) => row.territoire === target.territoire,
            ),
            theme_metadata: metadonneesThemesFixtures.mobilite,
            profils_acces_bpe: null,
            distribution_acces_batiments: null,
            rampe_acces_batiments: null,
            directions_comparaison: { [ligneCible.key]: 'high' },
            comparaisons: {
              epci: {
                scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
                faits: [{
                  key: ligneCible.key,
                  detail: ligneCible.detail,
                  sex: ligneCible.sex ?? null,
                  dimension: ligneCible.dimension ?? null,
                  origin: 'indicator',
                  direction: 'plus-est-mieux',
                  rank_position: 2,
                  rank_size: 7,
                  reference_kind: 'median',
                  reference_value: 42,
                }],
              },
            },
          },
        },
      },
      'territoires/commune/22001.json',
    )

    const payload = payloadDepuisModeleTerritoire(modele)
    const facts = territoryFactsFor(
      payload,
      target.territoire,
      modele.themes.mobilite?.comparisons.epci,
    )

    expect(payload.indicateurs.every((row) =>
      row.territoire === target.territoire || row.territoire === '53',
    )).toBe(true)
    expect(facts?.mobility.indicators.find((fact) => fact.key === ligneCible.key)?.comparison)
      .toEqual({
        direction: 'plus-est-mieux',
        scope: {
          mode: 'epci',
          kind: 'communes-epci',
          label: 'communes de EPCI X',
        },
        rank: { position: 2, size: 7 },
        reference: { kind: 'median', value: 42 },
      })
  })

  it('refuse un modèle dont le territoire déclaré ne figure pas dans le contexte', () => {
    expect(() =>
      validerModeleTerritoire(
        {
          schema_version: '1',
          snapshot_id: '2026-09-15',
          territory: { ...target, territoire: '99999' },
          territoires: territoiresFixture,
          themes: {},
        },
        'territoires/commune/99999.json',
      ),
    ).toThrow(/territoire déclaré/)
  })

  it('refuse un mode inconnu et deux comparaisons portant la même signature', () => {
    const themeBase = {
      theme: 'mobilite',
      indicateurs: indicateursMobiliteFixture,
      histoires: histoiresMobiliteFixture,
      theme_metadata: metadonneesThemesFixtures.mobilite,
      profils_acces_bpe: null,
      distribution_acces_batiments: null,
      rampe_acces_batiments: null,
      directions_comparaison: Object.fromEntries(
        indicateursMobiliteFixture.map((indicator) => [indicator.key, 'high']),
      ),
    }
    const envelope = (comparaisons: Record<string, unknown>) => ({
      schema_version: '1',
      snapshot_id: '2026-09-15',
      territory: target,
      territoires: territoiresFixture,
      themes: { mobilite: { ...themeBase, comparaisons } },
    })
    const targetFact = indicateursMobiliteFixture.find(
      (indicator) => indicator.territoire === target.territoire,
    )!
    const fact = {
      key: targetFact.key,
      detail: targetFact.detail,
      sex: targetFact.sex ?? null,
      dimension: targetFact.dimension ?? null,
      origin: 'indicator',
      direction: 'plus-est-mieux',
      rank_position: 1,
      rank_size: 2,
      reference_kind: 'median',
      reference_value: 100,
    }

    expect(() => validerModeleTerritoire(envelope({
      mystere: {
        scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
        faits: [],
      },
    }), 'territoires/commune/22001.json')).toThrow(/mode de comparaison inconnu/)

    expect(() => validerModeleTerritoire(envelope({
      epci: {
        scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
        faits: [fact, fact],
      },
    }), 'territoires/commune/22001.json')).toThrow(/dupliquée/)

    expect(() => validerModeleTerritoire(envelope({
      bretagne: {
        scope: { kind: 'departements-bretagne', label: 'départements bretons' },
        faits: [fact],
      },
    }), 'territoires/commune/22001.json')).toThrow(/scope.*incompatible/)

    expect(() => validerModeleTerritoire(envelope({
      epci: {
        scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
        faits: [{ ...fact, key: 'fait-inventé' }],
      },
    }), 'territoires/commune/22001.json')).toThrow(/fait.*absent.*cible/)

    expect(() => validerModeleTerritoire(envelope({
      epci: {
        scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
        faits: [{ ...fact, direction: 'moins-est-mieux' }],
      },
    }), 'territoires/commune/22001.json')).toThrow(/direction.*incohérente/)

    const densityModel = validerModeleTerritoire(envelope({
      densite: {
        scope: { kind: 'communes-densite', label: 'grands centres urbains bretons' },
        faits: [fact],
      },
    }), 'territoires/commune/22001.json')
    expect(densityModel.themes.mobilite?.comparisons.densite?.scope).toEqual({
      kind: 'communes-densite',
      label: 'grands centres urbains bretons',
    })
    const densityFacts = territoryFactsFor(
      payloadDepuisModeleTerritoire(densityModel),
      target.territoire,
      densityModel.themes.mobilite?.comparisons.densite,
    )
    expect(densityFacts?.mobility.indicators.find((candidate) => candidate.key === fact.key)?.comparison)
      .toMatchObject({
        scope: {
          mode: 'densite',
          kind: 'communes-densite',
          label: 'grands centres urbains bretons',
        },
      })
  })

  it('refuse une projection de distribution comparée incomplète', () => {
    const brut = structuredClone(modelePublie22001)
    const cellules = brut.themes.mobilite.comparaisons.epci.distribution_batiments.cells
    expect(cellules.length).toBeGreaterThan(1)
    cellules.pop()

    expect(() => validerModeleTerritoire(
      brut,
      'territoires/commune/22001.json',
    )).toThrow(/distribution comparée.*incomplète/)
  })

  it('#627 - the building figures no longer resolve through the payload projection', () => {
    const brut = structuredClone(modelePublie22001)
    brut.themes.mobilite.comparaisons.epci.distribution_batiments = null
    brut.themes.mobilite.comparaisons.epci.rampe_acces = null
    const model = validerModeleTerritoire(brut, 'territoires/commune/22001.json')
    const facts = territoryFactsFor(
      payloadDepuisModeleTerritoire(model), '22001', model.themes.mobilite?.comparisons.epci,
    )
    // The raw artifact keeps its comparisons (the validator contract), but
    // the retired building figures never cross the facts seam.
    expect(facts).not.toBeNull()
    expect('buildingDistribution' in facts!.mobility).toBe(false)
    expect('accessRamp' in facts!.mobility).toBe(false)
  })

  it('refuse une preuve comparée dont le libellé diverge de son périmètre', () => {
    const brut = structuredClone(modelePublie22001)
    type ContexteBrut = {
      scope: { label: string }
      distribution_batiments?: { label: string } | null
      rampe_acces?: { label: string } | null
    }
    const comparaisons = brut.themes.mobilite.comparaisons as Record<string, ContexteBrut | null>
    for (const contexte of Object.keys(comparaisons).map((mode) => comparaisons[mode])) {
      if (!contexte) continue
      if (contexte.distribution_batiments) {
        contexte.distribution_batiments.label = contexte.scope.label
      }
      if (contexte.rampe_acces) {
        contexte.rampe_acces.label = contexte.scope.label
      }
    }
    brut.themes.mobilite.comparaisons.epci.distribution_batiments.label =
      'communes de mauvais périmètre'

    expect(() => validerModeleTerritoire(
      brut,
      'territoires/commune/22001.json',
    )).toThrow(/libellé de distribution comparée incohérent/)
  })

  it('refuse un périmètre comparé dont le libellé diverge du référentiel territorial', () => {
    const brut = structuredClone(modelePublie22001)
    brut.themes.mobilite.comparaisons.epci.scope.label = 'communes de mauvais EPCI'
    brut.themes.mobilite.comparaisons.epci.distribution_batiments.label =
      'communes de mauvais EPCI'
    brut.themes.mobilite.comparaisons.epci.rampe_acces.label =
      'communes de mauvais EPCI'

    expect(() => validerModeleTerritoire(
      brut,
      'territoires/commune/22001.json',
    )).toThrow(/libellé de périmètre incohérent/)
  })

  it('refuse une distribution comparée qui ne recompose pas son total', () => {
    const brut = structuredClone(modelePublie22001)
    brut.themes.mobilite.comparaisons.epci.distribution_batiments.cells[0].building_count += 1

    expect(() => validerModeleTerritoire(
      brut,
      'territoires/commune/22001.json',
    )).toThrow(/distribution comparée.*incohérente/)
  })

  it('refuse une projection de rampe comparée incomplète', () => {
    const brut = structuredClone(modelePublie22001)
    brut.themes.mobilite.comparaisons.epci.distribution_batiments.label =
      brut.themes.mobilite.comparaisons.epci.scope.label
    brut.themes.mobilite.comparaisons.epci.rampe_acces.label =
      brut.themes.mobilite.comparaisons.epci.scope.label
    const points = brut.themes.mobilite.comparaisons.epci.rampe_acces.points
    expect(points.length).toBeGreaterThan(1)
    points.pop()

    expect(() => validerModeleTerritoire(
      brut,
      'territoires/commune/22001.json',
    )).toThrow(/rampe comparée.*incomplète/)
  })
})

/**
 * #891 — le chemin MANUEL de régénération des modèles depuis les JSON publiés
 * est retiré (app/scripts/publish-territory-model.mjs + la commande
 * generate:territory-model), tandis que le VALIDATEUR d'artefacts reste :
 * validate:territory-model et son aide de parité canonique
 * (scripts/territory-model-dev.ts), seule lectrice retenue de territoires.json /
 * vintages.json / theme_*.json / projections Mobilité, et elle n'est utilisée
 * que par la branche de parité optionnelle du validateur — jamais pour publier.
 */
describe('contrat CLI et branche de parité canonique du validateur (#891)', () => {
  it('retire le wrapper generate:territory-model mais garde validate:territory-model', () => {
    const appRoot = process.cwd()
    const pkg = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect('generate:territory-model' in pkg.scripts).toBe(false)
    expect(pkg.scripts['validate:territory-model']).toBe('node scripts/validate-territory-model.mjs')
    expect(existsSync(resolve(appRoot, 'scripts', 'publish-territory-model.mjs'))).toBe(false)
    expect(existsSync(resolve(appRoot, 'scripts', 'validate-territory-model.mjs'))).toBe(true)
    expect(existsSync(resolve(appRoot, 'scripts', 'territory-model-dev.ts'))).toBe(true)
  })

  it('la branche de parité canonique projette toujours un modèle validable depuis une racine fixture', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'lusk-canonique-'))
    try {
      ecrireRacineCanonique(racine)

      const buffer = await territoryModelBuffer(racine, 'commune', '22001')
      expect(buffer).not.toBeNull()
      const brut = JSON.parse(buffer!.toString('utf8')) as {
        schema_version: string
        snapshot_id: string
        territory: { territoire: string }
        themes: Record<string, unknown>
      }
      expect(brut.schema_version).toBe('1')
      expect(brut.territory.territoire).toBe('22001')
      expect(Object.keys(brut.themes).sort()).toEqual([...THEMES_CANONIQUES].sort())
      const snapshotAttendu = vintagesFixture
        .map((vintage) => vintage.date_reference)
        .filter((date): date is string => Boolean(date))
        .sort()
        .at(-1)
      expect(brut.snapshot_id).toBe(snapshotAttendu)

      // le modèle reconstruit depuis la racine canonique traverse le validateur
      // d'artefact exactement comme la branche de parité de validate-territory-model.mjs
      const modele = validerModeleTerritoire(
        brut,
        'legacy-commune-22001.json',
        { type: 'commune', territoire: '22001' },
      )
      expect(modele.territory).toMatchObject({ type: 'commune', territoire: '22001' })
      expect(modele.themes.mobilite).toBeDefined()

      // un territoire absent de la référence ne produit aucune projection
      expect(await territoryModelBuffer(racine, 'commune', '99999')).toBeNull()
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })
})

/**
 * #891 (SPEC P2) — la branche de parité sémantique doit être exercée via
 * l'entrypoint CLI RÉEL (`node scripts/validate-territory-model.mjs <modele>
 * <racine-canonique>`, comparaison compact-vs-legacy du fichier :39-99), pas
 * seulement via ses fonctions internes. Le test positif assert
 * `semanticParity: true` sur un modèle et une racine canonique fixture ; le
 * test négatif prouve qu'un contenu sémantique divergent fait ÉCHOUER la
 * parité, donc que la comparaison ne peut pas être contournée. Aucun artefact
 * commité n'est modifié : tout passe par des copies temporaires isolées.
 */
describe('entrypoint CLI validate:territory-model — parité sémantique canonique (#891)', () => {
  const appRoot = process.cwd()
  const cli = resolve(appRoot, 'scripts', 'validate-territory-model.mjs')

  function runCli(modelePath: string, racine: string) {
    return spawnSync(process.execPath, [cli, modelePath, racine], {
      cwd: appRoot,
      encoding: 'utf8',
      timeout: 120000,
    })
  }

  // territory-model-dev.ts met en cache la source au niveau du module :
  // vi.resetModules() + import dynamique donnent une instance fraîche par racine
  async function ecrireModeleDepuisRacine(dossier: string, racine: string, altere = false): Promise<string> {
    vi.resetModules()
    const { territoryModelBuffer: bufferFrais } = await import('../../scripts/territory-model-dev')
    const buffer = await bufferFrais(racine, 'commune', '22001')
    if (!buffer) throw new Error('projection fixture nulle')
    const brut = JSON.parse(buffer.toString('utf8')) as {
      themes: { mobilite: { indicateurs: Array<Record<string, unknown>> } }
    }
    if (altere) {
      const ligne = brut.themes.mobilite.indicateurs.find((row) =>
        row.territoire === '22001' && row.key === 'offre_tc')
      if (!ligne) throw new Error('ligne offre_tc absente du fixture')
      ligne.value = 0.5 // contenu sémantique divergent de la racine canonique
    }
    // le CLI déduit type/territoire du chemin : <...>/commune/22001.json
    const chemin = join(dossier, 'territoires', 'commune', '22001.json')
    mkdirSync(dirname(chemin), { recursive: true })
    writeFileSync(chemin, JSON.stringify(brut))
    return chemin
  }

  it('imprime semanticParity:true via le CLI sur modèle + racine canonique fixture', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'lusk-cli-racine-'))
    const dossierModele = mkdtempSync(join(tmpdir(), 'lusk-cli-modele-'))
    try {
      ecrireRacineCanonique(racine)
      const modelePath = await ecrireModeleDepuisRacine(dossierModele, racine)
      const result = runCli(modelePath, racine)
      expect(result.status, String(result.stderr)).toBe(0)
      expect(result.stdout).toContain('"territory":"22001"')
      expect(result.stdout).toContain('"semanticParity":true')
    } finally {
      rmSync(racine, { recursive: true, force: true })
      rmSync(dossierModele, { recursive: true, force: true })
    }
  }, 180000)

  it('fait échouer la parité quand le contenu sémantique diverge (comparaison non contournable)', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'lusk-cli-racine-'))
    const dossierModele = mkdtempSync(join(tmpdir(), 'lusk-cli-modele-'))
    try {
      ecrireRacineCanonique(racine)
      const modelePath = await ecrireModeleDepuisRacine(dossierModele, racine, true)
      const result = runCli(modelePath, racine)
      expect(result.status).not.toBe(0)
      expect(result.stderr + result.stdout).toMatch(/observable Mobilit/)
      expect(result.stdout).not.toContain('"semanticParity":true')
    } finally {
      rmSync(racine, { recursive: true, force: true })
      rmSync(dossierModele, { recursive: true, force: true })
    }
  }, 180000)
})
