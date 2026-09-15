import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { expect, it } from 'vitest'

import { territoryFactsFor } from '../src/fiche/content/territoryFacts'
import { resolveMobiliteThemeContent } from '../src/fiche/content/themeContent'
import type { Payload } from '../src/payload/types'
import {
  validerDistributionAccesBatiments,
  validerHistoires,
  validerIndicateurs,
  validerProfilsAccesBpe,
  validerRampeAccesBatiments,
  validerTerritoires,
} from '../src/payload/validate'

const dataDirectory = resolve(import.meta.dirname, '../../public/data')
const files = {
  territoires: 'territoires.json',
  indicateurs: 'indicateurs_mobilite.json',
  histoires: 'histoires_mobilite.json',
  profils: 'profils_acces_bpe.json',
  distribution: 'distribution_acces_batiments.json',
  rampe: 'rampe_acces_batiments.json',
} as const

function timed<T>(run: () => T): { value: T; milliseconds: number } {
  const started = performance.now()
  const value = run()
  return { value, milliseconds: performance.now() - started }
}

const read = timed(() =>
  Object.fromEntries(
    Object.entries(files).map(([key, file]) => [key, readFileSync(resolve(dataDirectory, file))]),
  ) as Record<keyof typeof files, Buffer>,
)
const decode = timed(() =>
  Object.fromEntries(
    Object.entries(read.value).map(([key, contents]) => [key, contents.toString('utf8')]),
  ) as Record<keyof typeof files, string>,
)
const parse = timed(() =>
  Object.fromEntries(
    Object.entries(decode.value).map(([key, contents]) => [key, JSON.parse(contents)]),
  ) as Record<keyof typeof files, unknown>,
)

const validation = timed(() => {
  const territoires = validerTerritoires(parse.value.territoires, files.territoires)
  return {
    territoires,
    indicateurs: validerIndicateurs(parse.value.indicateurs, files.indicateurs, territoires),
    histoires: validerHistoires(parse.value.histoires, files.histoires, territoires),
    profils: validerProfilsAccesBpe(parse.value.profils, files.profils, territoires),
    distribution: validerDistributionAccesBatiments(
      parse.value.distribution,
      files.distribution,
      territoires,
    ),
    rampe: validerRampeAccesBatiments(parse.value.rampe, files.rampe, territoires),
  }
})

const ingestion = timed(() => {
  const indicateurs = []
  const histoires = []
  for (const row of validation.value.indicateurs) indicateurs.push(row)
  for (const row of validation.value.histoires) histoires.push(row)
  return { indicateurs, histoires }
})

const payload: Payload = {
  territoires: validation.value.territoires,
  indicateurs: ingestion.value.indicateurs,
  histoires: ingestion.value.histoires,
  apercu: null,
  runReport: null,
  vintages: null,
  programmes: null,
  profilsAccesBpe: validation.value.profils,
  distributionAccesBatiments: validation.value.distribution,
  rampeAccesBatiments: validation.value.rampe,
  themeMetadata: {},
}
const content = timed(() => {
  const facts = territoryFactsFor(payload, '35238')
  if (!facts) throw new Error('Representative territory 35238 (Rennes) is absent')
  return resolveMobiliteThemeContent(facts)
})

const rawBytes = Object.fromEntries(
  Object.entries(read.value).map(([key, contents]) => [key, contents.byteLength]),
)
const gzipBytes = Object.fromEntries(
  Object.entries(read.value).map(([key, contents]) => [key, gzipSync(contents).byteLength]),
)

console.log(
  JSON.stringify(
    {
      files: { rawBytes, gzipBytes },
      stagesMs: {
        read: read.milliseconds,
        decode: decode.milliseconds,
        parse: parse.milliseconds,
        validation: validation.milliseconds,
        ingestion: ingestion.milliseconds,
        territoryFactsAndThemeContent: content.milliseconds,
        total:
          read.milliseconds +
          decode.milliseconds +
          parse.milliseconds +
          validation.milliseconds +
          ingestion.milliseconds +
          content.milliseconds,
      },
      rows: {
        territories: validation.value.territoires.length,
        indicators: validation.value.indicateurs.length,
        readings: validation.value.histoires.length,
        bpeProfiles: validation.value.profils?.length ?? 0,
        buildingDistribution: validation.value.distribution?.length ?? 0,
        accessRamp: validation.value.rampe?.length ?? 0,
      },
      representativeTerritory: {
        id: '35238',
        contentUnits: content.value.units.length,
      },
    },
    null,
    2,
  ),
)

it('benchmarks a real complete Mobilité territory resolution', () => {
  expect(content.value.units.length).toBeGreaterThan(0)
})
