// Differentially verifies every current published territory label against the
// actual app search implementation. Run from repo root:
// node --experimental-strip-types api/scripts/verify_search_parity.mjs
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const appSearchPath = path.join(root, 'app/src/search/recherche.ts')
const source = JSON.parse(readFileSync(path.join(root, 'public/data/territoires.json'), 'utf8'))
const territories = source.map((row) => ({
  territoire: row.territoire,
  type: row.type,
  nom: row.nom,
  departement: row.departement,
  epci: row.epci,
}))
const queries = [...new Set(territories.map((territory) => territory.nom))]

const python = String.raw`
import json, sys
from api.main import search_territory_rows, _search_normalize
data = json.load(sys.stdin)
rows = [{"id": r["territoire"], "type": r["type"], "name": r["nom"]} for r in data["territories"]]
result = {q: search_territory_rows(rows, q, 8) for q in data["queries"]}
print(json.dumps(result, ensure_ascii=False))
`
const response = spawnSync('python', ['-c', python], {
  cwd: root,
  input: JSON.stringify({ territories, queries }),
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})
if (response.status !== 0) throw new Error(response.stderr || 'Python candidate generation failed')
const candidatesByQuery = JSON.parse(response.stdout)
const { rechercherTerritoires } = await import(pathToFileURL(appSearchPath))

for (const query of queries) {
  const candidates = candidatesByQuery[query].map((row) => ({
    territoire: row.id,
    type: row.type,
    nom: row.name,
  }))
  const expected = rechercherTerritoires(territories, query, 8).map((row) => row.territoire)
  const actual = rechercherTerritoires(candidates, query, 8).map((row) => row.territoire)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Search candidate parity failed for query ${JSON.stringify(query)}: expected ${expected.join(',')}; got ${actual.join(',')}; candidates=${candidates.map((row) => row.territoire + ':' + row.nom).join('|')}`)
  }
}
console.log(`JS/Python candidate parity passed for ${queries.length} unique names (${territories.length} published territory rows)`)
