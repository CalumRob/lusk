import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Maintained native bridge invocation for #857: fresh guarded SQL/HTTP captures
// (five pages + the state/calendar boundary) served verbatim through the real
// shared acquirer/adapter seams, with an explicit JSON report.
//
// Requires the guarded test-only database environment BEFORE running (see
// api/tests/integration/README.md): LUSK_TEST_DATABASE_PREFIX/LUSK_TEST_DATABASE_NAME
// (lusk_it_*), LUSK_TEST_PUBLISH_DSN, LUSK_TEST_READ_DSN, PGPASSFILE set to the
// passfile PATH. Never prints or copies passfile contents. No R is involved.
const appRoot = process.cwd()
const repoRoot = resolve(appRoot, '..')
// Outside the checkout by default; pass an explicit directory for evidence runs.
const out = resolve(process.argv[2] ?? join(tmpdir(), 'lusk-series-native-bridge'))
const required = ['LUSK_TEST_DATABASE_PREFIX', 'LUSK_TEST_DATABASE_NAME',
  'LUSK_TEST_PUBLISH_DSN', 'LUSK_TEST_READ_DSN']
const missing = required.filter((name) => !process.env[name])
assert.equal(missing.length, 0, `Missing guarded database environment: ${missing.join(', ')}`)
assert.ok(process.env.LUSK_TEST_DATABASE_NAME.startsWith('lusk_it_'),
  'The guarded target must be a test-only lusk_it_* database')

const headAtStart = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const branchAtStart = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const statusAtStart = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()
assert.equal(statusAtStart, '', 'Native bridge verification requires a clean committed source tree')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const captureRun = spawnSync('python', ['-m', 'pytest',
  'api/tests/integration/test_native_series_family_capture.py',
  'api/tests/integration/test_native_series_page_boundary.py',
  '-q', '-s', '--basetemp', resolve(out, 'native-tmp')], {
  cwd: repoRoot, encoding: 'utf8',
  env: { ...process.env, PYTHONPATH: repoRoot },
})
const captureLog = `${captureRun.stdout ?? ''}\n${captureRun.stderr ?? ''}`
if (captureRun.status !== 0) {
  console.error(captureLog)
  throw new Error('The guarded native capture run failed')
}
const captures = readdirSync(resolve(out, 'native-tmp'), { recursive: true })
  .filter((entry) => String(entry).endsWith('.json'))
  .map((entry) => resolve(out, 'native-tmp', String(entry)))
assert.ok(captures.length >= 5, `Expected at least five native captures, got ${captures.length}`)

const vitest = spawnSync('npx.cmd', ['vitest', 'run', 'src/__tests__/native-series-semantic-bridge.spec.ts',
  '--reporter=json', '--outputFile', resolve(out, 'native-bridge.json')], {
  cwd: appRoot, encoding: 'utf8',
  env: { ...process.env, LUSK_NATIVE_SERIES_FAMILY_CAPTURES: captures.join(';') },
})
const vitestLog = `${vitest.stdout ?? ''}\n${vitest.stderr ?? ''}`
if (vitest.status !== 0) {
  console.error(vitestLog)
  throw new Error('The native bridge suite failed against the fresh captures')
}
const report = JSON.parse(readFileSync(resolve(out, 'native-bridge.json'), 'utf8'))
assert.ok(report.numTotalTests >= 6,
  `The native bridge must run the real capture-driven tests, got ${report.numTotalTests}`)
assert.equal(report.numFailedTests, 0)
const headAtEnd = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const branchAtEnd = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const statusAtEnd = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()
assert.equal(headAtEnd, headAtStart, 'HEAD must remain unchanged during native bridge verification')
assert.equal(branchAtEnd, branchAtStart, 'Branch must remain unchanged during native bridge verification')
assert.equal(statusAtEnd, '', 'Source tree must remain clean throughout native bridge verification')
console.log(JSON.stringify({ issue: '#857', head: headAtStart, branch: branchAtStart,
  sourceCleanBeforeAndAfter: true, captureTest: 'api/tests/integration/test_native_series_family_capture.py + test_native_series_page_boundary.py',
  captures, numTotalTests: report.numTotalTests, numPassedTests: report.numPassedTests,
  numFailedTests: report.numFailedTests, report: resolve(out, 'native-bridge.json') }, null, 2))
