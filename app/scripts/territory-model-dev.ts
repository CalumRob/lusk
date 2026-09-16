import { readFile } from 'node:fs/promises'
import path from 'node:path'

const THEMES = ['programmes', 'mobilite', 'demographie', 'habitat', 'economie', 'milieux'] as const
type Row = Record<string, unknown> & { territoire: string; type?: string; theme?: string }

interface SourceData {
  territoires: Row[]
  vintages: Array<{ date_reference?: string | null }>
  themes: Record<string, { indicateurs: Row[]; histoires: Row[]; metadata: unknown }>
  profils: Row[] | null
  distribution: Row[] | null
  rampe: Row[] | null
}

let sourcePromise: Promise<SourceData> | null = null
const modelCache = new Map<string, Buffer>()

async function json<T>(root: string, name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(root, name), 'utf8')) as T
}

async function optionalRows(root: string, name: string): Promise<Row[] | null> {
  try {
    return await json<Row[]>(root, name)
  } catch {
    return null
  }
}

function loadSource(root: string): Promise<SourceData> {
  return (sourcePromise ??= (async () => {
    const themeEntries = await Promise.all(THEMES.map(async (theme) => [theme, {
      indicateurs: await json<Row[]>(root, `indicateurs_${theme}.json`),
      histoires: await json<Row[]>(root, `histoires_${theme}.json`),
      metadata: await json<unknown>(root, `theme_${theme}.json`),
    }] as const))
    return {
      territoires: await json<Row[]>(root, 'territoires.json'),
      vintages: await json<Array<{ date_reference?: string | null }>>(root, 'vintages.json'),
      themes: Object.fromEntries(themeEntries),
      profils: await optionalRows(root, 'profils_acces_bpe.json'),
      distribution: await optionalRows(root, 'distribution_acces_batiments.json'),
      rampe: await optionalRows(root, 'rampe_acces_batiments.json'),
    }
  })())
}

function contextRows(territoires: Row[], target: Row): Row[] {
  const ids = new Set<string>([target.territoire])
  for (const region of territoires.filter((row) => row.type === 'region')) ids.add(region.territoire)
  if (target.type === 'commune') {
    const epci = typeof target.epci === 'string' ? target.epci : null
    const departement = typeof target.departement === 'string' ? target.departement : null
    for (const row of territoires) {
      if (row.type === 'commune' && (epci ? row.epci === epci : true)) {
        ids.add(row.territoire)
        // The legacy in-memory projection still needs a valid reference slice:
        // when a commune has no EPCI, its Brittany fallback carries every
        // commune, so each of those communes' EPCI references must be present.
        if (!epci && typeof row.epci === 'string') ids.add(row.epci)
      }
    }
    if (epci) ids.add(epci)
    if (departement) ids.add(departement)
  } else if (target.type === 'epci') {
    for (const row of territoires.filter((candidate) => candidate.type === 'epci')) ids.add(row.territoire)
    if (typeof target.departement === 'string') ids.add(target.departement)
  } else if (target.type === 'departement') {
    for (const row of territoires.filter((candidate) => candidate.type === 'departement')) ids.add(row.territoire)
  }
  return territoires
    .filter((row) => ids.has(row.territoire))
    .sort((left, right) => left.territoire.localeCompare(right.territoire))
}

function signature(row: Row): string {
  return ['key', 'detail', 'sex', 'dimension'].map((key) => String(row[key] ?? '<NA>')).join('\r')
}

function themeRows(theme: string, rows: Row[], ids: Set<string>, target: string): Row[] {
  const scoped = rows.filter((row) => row.theme === theme && ids.has(row.territoire))
  if (!['mobilite', 'programmes'].includes(theme)) {
    return scoped.filter((row) => row.territoire === target)
  }
  if (theme !== 'mobilite') return scoped
  const targetSignatures = new Set(scoped.filter((row) => row.territoire === target).map(signature))
  return scoped.filter((row) => targetSignatures.has(signature(row)) || (
    row.key === 'nb_buildings' && row.detail == null && row.sex == null && row.dimension == null
  ))
}

export async function territoryModelBuffer(
  root: string,
  type: string,
  territoire: string,
): Promise<Buffer | null> {
  const cacheKey = `${type}/${territoire}`
  const cached = modelCache.get(cacheKey)
  if (cached) return cached

  const source = await loadSource(root)
  const target = source.territoires.find((row) => row.territoire === territoire && row.type === type)
  if (!target) return null
  const contexte = contextRows(source.territoires, target)
  const ids = new Set(contexte.map((row) => row.territoire))
  const themes = Object.fromEntries(THEMES.map((theme) => {
    const data = source.themes[theme]!
    return [theme, {
      theme,
      indicateurs: themeRows(theme, data.indicateurs, ids, territoire),
      histoires: theme === 'mobilite' || theme === 'programmes'
        ? data.histoires.filter((row) => ids.has(row.territoire))
        : data.histoires.filter((row) => row.territoire === territoire),
      theme_metadata: data.metadata,
      profils_acces_bpe: theme === 'mobilite'
        ? source.profils?.filter((row) => ids.has(row.territoire)) ?? null
        : null,
      distribution_acces_batiments: theme === 'mobilite'
        ? source.distribution?.filter((row) => row.territoire === territoire) ?? null
        : null,
      rampe_acces_batiments: theme === 'mobilite'
        ? source.rampe?.filter((row) => row.territoire === territoire) ?? null
        : null,
    }]
  }))
  const dates = source.vintages
    .flatMap((vintage) => vintage.date_reference ? [vintage.date_reference] : [])
    .sort()
  const buffer = Buffer.from(JSON.stringify({
    schema_version: '1',
    snapshot_id: dates.at(-1) ?? 'unknown',
    territory: target,
    territoires: contexte,
    themes,
  }))
  modelCache.set(cacheKey, buffer)
  return buffer
}
