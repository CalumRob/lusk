// Read-only live API proof. Run from app/: node scripts/verify-mobility-cross-level.mjs
// Not a publication/whole-site parity check. Unsupported regional scalar facts
// stay unsupported; only comparison eligibility and retained facts are checked.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
let browser
const receipts = []
try {
  await server.listen()
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) })
  for (const [level, id] of [['commune', '35238'], ['epci', '243500725'], ['departement', '35'], ['region', '53']]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const reads = []
    page.on('request', request => {
      if (request.url().endsWith('/api/resources/read-batch')) reads.push(...JSON.parse(request.postData()).items)
    })
    await page.goto(`${server.resolvedUrls.local[0]}territoire/${level}/${id}?theme=mobilite`)
    await page.locator('.aedar-access-mode-selector').waitFor({ state: 'attached', timeout: 60000 })
    const pageOnePeerControls = await page.locator('.aedar-access-mode-selector, .aedar-equipment-explorer-modes')
      .getByRole('button', { name: /Groupe comparé/i }).count()
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, 700)
      await page.waitForTimeout(250)
    }
    await page.locator('.mobilite-raccordement-curve__territory').waitFor({ state: 'attached', timeout: 60000 })
    if (level !== 'region') await page.locator('.mobilite-raccordement-curve__comparison')
      .waitFor({ state: 'attached', timeout: 60000 })
    const text = await page.locator('body').innerText()
    const receipt = { level, id, pageOnePeerControls,
      comparisonReads: reads.filter(item => item.intent.kind !== 'facts'),
      factResources: [...new Set(reads.filter(item => item.intent.kind === 'facts').map(item => item.resource))],
      networkMarks: await page.locator('.mobilite-comparison-bars [data-comparison]').count(),
      comparedCurves: await page.locator('.mobilite-raccordement-curve__comparison').count(), text }
    receipts.push(receipt)
    if (level === 'region') {
      assert.equal(pageOnePeerControls, 0)
      assert.equal(receipt.comparisonReads.length, 0)
      assert.equal(receipt.networkMarks, 0)
      assert.equal(receipt.comparedCurves, 0)
      assert(!text.toLocaleLowerCase('fr-FR').includes('groupe comparé'))
      assert(!text.includes('Réessayer les comparaisons'))
      assert(text.includes('Contenu indisponible pour ce territoire.'))
      for (const resource of ['aedar_territory_summary', 'reseaux_par_habitant', 'raccordement_courbe']) {
        assert(receipt.factResources.includes(resource), `regional factual demand ${resource}`)
      }
      assert(!receipt.factResources.includes('offre_tc'), 'unsupported regional scalar is not requested')
    } else {
      assert(receipt.networkMarks > 0, `${level} page 2 retains comparisons`)
      assert.equal(receipt.comparedCurves, 1, `${level} page 3 retains comparison curve`)
      assert(!text.includes('Aucun repère de groupe comparé'), `${level} coverage comparison is available`)
    }
    await page.close()
  }
  await mkdir('../.scratch/mobility-cross-level', { recursive: true })
  await writeFile('../.scratch/mobility-cross-level/browser-matrix.json', JSON.stringify(receipts, null, 2))
  console.log(JSON.stringify(receipts.map(({ text, comparisonReads, ...receipt }) =>
    ({ ...receipt, comparisonReads: comparisonReads.length })), null, 2))
} finally {
  await browser?.close()
  await server.close()
}
