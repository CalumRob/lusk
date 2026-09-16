import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { createServer } from 'vite'

const filePath = process.argv[2]
const canonicalRoot = process.argv[3]
if (!filePath) {
  throw new Error('Usage: node scripts/validate-territory-model.mjs <territory-model.json>')
}

const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
})

try {
  const { validerModeleTerritoire } = await server.ssrLoadModule(
    '/src/payload/territoryReadModel.ts',
  )
  const absolutePath = path.resolve(filePath)
  const territory = path.basename(absolutePath, '.json')
  const type = path.basename(path.dirname(absolutePath))
  const raw = JSON.parse(await readFile(absolutePath, 'utf8'))
  const model = validerModeleTerritoire(raw, path.basename(absolutePath), {
    type,
    territoire: territory,
  }, { requireAllThemes: true })
  const comparisonCount = Object.values(model.themes).reduce(
    (total, theme) => total + Object.values(theme?.comparisons ?? {}).length,
    0,
  )
  console.log(JSON.stringify({
    territory: model.territory.territoire,
    themes: Object.keys(model.themes),
    comparisonContexts: comparisonCount,
  }))

  if (canonicalRoot) {
    const { territoryModelBuffer } = await server.ssrLoadModule(
      '/scripts/territory-model-dev.ts',
    )
    const { payloadDepuisModeleTerritoire } = await server.ssrLoadModule(
      '/src/payload/territoryReadModel.ts',
    )
    const { territoryFactsFor } = await server.ssrLoadModule(
      '/src/fiche/content/territoryFacts.ts',
    )
    const { resolveMobiliteThemeContent } = await server.ssrLoadModule(
      '/src/fiche/content/themeContent.ts',
    )
    const legacyBuffer = await territoryModelBuffer(path.resolve(canonicalRoot), type, territory)
    if (!legacyBuffer) throw new Error(`No canonical projection for ${type}/${territory}`)
    const legacyModel = validerModeleTerritoire(
      JSON.parse(legacyBuffer.toString('utf8')),
      `legacy-${path.basename(absolutePath)}`,
      { type, territoire: territory },
    )
    const compactPayload = payloadDepuisModeleTerritoire(model)
    const legacyPayload = payloadDepuisModeleTerritoire(legacyModel)
    const compactContext = model.themes.mobilite?.comparisons.epci ??
      model.themes.mobilite?.comparisons.bretagne
    const compactFacts = territoryFactsFor(compactPayload, territory, compactContext)
    const legacyFacts = territoryFactsFor(legacyPayload, territory)
    const compactContent = compactFacts ? resolveMobiliteThemeContent(compactFacts) : null
    const legacyContent = legacyFacts ? resolveMobiliteThemeContent(legacyFacts) : null
    const scopeKinds = new Set([
      'communes-epci', 'communes-bretagne', 'epcis-bretagne', 'departements-bretagne',
    ])
    const normalize = (value) => {
      if (Array.isArray(value)) return value.map(normalize)
      if (!value || typeof value !== 'object') return value
      if (scopeKinds.has(value.kind)) return { kind: value.kind }
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]))
    }
    const compactNormalized = normalize(compactContent)
    const legacyNormalized = normalize(legacyContent)
    const firstDifference = (left, right, currentPath = '$') => {
      if (Object.is(left, right)) return null
      if (typeof left === 'number' && typeof right === 'number' &&
          Math.abs(left - right) <= 1e-12 * Math.max(1, Math.abs(left), Math.abs(right))) return null
      if (typeof left !== typeof right || left === null || right === null) {
        return { path: currentPath, compact: left, legacy: right }
      }
      if (typeof left !== 'object') return { path: currentPath, compact: left, legacy: right }
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
      for (const key of keys) {
        const difference = firstDifference(left[key], right[key], `${currentPath}.${key}`)
        if (difference) return difference
      }
      return null
    }
    const difference = firstDifference(compactNormalized, legacyNormalized)
    if (difference) {
      throw new Error(
        `Compact model changes observable Mobilité content for ${territory}: ${JSON.stringify(difference)}`,
      )
    }
    console.log(JSON.stringify({ territory, semanticParity: true }))
  }
} finally {
  await server.close()
}
