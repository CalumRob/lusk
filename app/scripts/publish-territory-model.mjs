import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const pipelineRoot = path.resolve(appRoot, '..', 'pipeline')
const script = path.join(pipelineRoot, 'scripts', 'publish-territory-models.R')
const result = spawnSync('Rscript', [script, ...process.argv.slice(2)], {
  cwd: pipelineRoot,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`[read-models] impossible de lancer Rscript : ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
