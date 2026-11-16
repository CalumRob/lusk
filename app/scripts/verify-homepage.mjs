import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

// #1027: public rendered seam against a running preview. No invented article or
// territory content: long labels come from the served committed reference.
const base = process.env.LUSK_PREVIEW_URL || 'http://127.0.0.1:5177'
const output = process.env.LUSK_SCREENSHOT_DIR || 'E:/Temp/opencode/homepage-1027'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
})
const report = []
try {
  for (const width of [1440, 375, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } })
    const errors = []
    const assetFailures = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', (response) => {
      if (response.status() >= 400 && response.url() !== `${base}/data/territoires.json`) {
        assetFailures.push(`${response.status()} ${response.url()}`)
      }
    })
    await page.goto(base)
    await page.locator('.accueil[aria-busy="false"]').waitFor()
    await page.evaluate(() => document.fonts.ready)
    const referenceResponse = await page.request.get(`${base}/data/territoires.json`)
    assert.equal(referenceResponse.status(), 200)
    const territories = await referenceResponse.json()
    assert(territories.length > 1000, 'real territory assets, not an HTML fallback')
    const longest = [...territories].sort((a, b) => b.nom.length - a.nom.length)[0]
    const input = page.locator('.accueil input[role="combobox"]')
    const geometry = () => page.evaluate(() => {
      const box = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect()
        return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height }
      }
      return { search: box('.accueil-recherche'), editorial: box('.accueil-editorial'),
        link: box('.accueil-indicateurs'), pageWidth: document.documentElement.scrollWidth }
    })
    const initial = await geometry()
    assert(initial.pageWidth <= width, 'no horizontal page overflow')
    await input.fill(longest.nom)
    await page.locator('.accueil [role="option"]').first().waitFor()
    assert.equal(await page.locator('.accueil [role="option"]').first().innerText().then((t) => t.includes(longest.nom)), true)
    assert.deepEqual(await geometry(), initial, 'long results cannot change page/search geometry')
    const panelFits = await page.locator('.accueil .global-search__dropdown').evaluate((el) => el.scrollWidth <= el.clientWidth)
    assert(panelFits, 'long result fits inside dropdown without horizontal scrolling')
    await page.screenshot({ path: `${output}/homepage-${width}-long-search.png`, fullPage: true })
    await input.press('ArrowDown')
    assert.equal(await input.getAttribute('aria-activedescendant'), 'gsb-option-0')
    await input.press('Escape')
    assert.equal(await input.getAttribute('aria-expanded'), 'false')
    await input.blur()
    await input.focus()
    await input.fill('zzzzzzaucunterritoire')
    await page.getByText('Aucun résultat trouvé.', { exact: true }).waitFor()
    assert.deepEqual(await geometry(), initial, 'empty result geometry')
    await input.press('Escape')
    await input.fill('')
    const slots = await page.locator('.accueil-emplacement').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width }
    }))
    assert.equal(slots.length, 3)
    assert(slots.every((s) => Math.abs(s.width - slots[0].width) < 1))
    assert(width < 768 ? slots[1].y > slots[0].y : slots[1].y === slots[0].y)
    assert.equal(await page.locator('.accueil-editorial a, .accueil-editorial button, .accueil-editorial [tabindex]').count(), 0)
    await page.screenshot({ path: `${output}/homepage-${width}.png`, fullPage: true })
    // Hold the real territory read, then fail it once and retry over real HTTP.
    let release
    const held = new Promise((resolve) => { release = resolve })
    await page.route('**/data/territoires.json', async (route) => {
      await held
      await route.fulfill({ status: 503, body: 'Temporarily unavailable' })
    }, { times: 1 })
    await page.reload()
    await page.locator('.accueil[aria-busy="true"]').waitFor()
    await page.evaluate(() => document.fonts.ready)
    const loading = await geometry()
    assert.deepEqual(loading, initial, 'loading must keep the ready-state geometry')
    await input.fill('Rennes')
    await page.getByText('Chargement des territoires…', { exact: true }).waitFor()
    release()
    await page.locator('.bouton-reessayer').waitFor()
    assert.deepEqual(await geometry(), loading, 'error/retry must not shift search or following content')
    await page.screenshot({ path: `${output}/homepage-${width}-error.png`, fullPage: true })
    await page.locator('.bouton-reessayer').click()
    await page.locator('.accueil[aria-busy="false"]').waitFor()
    await input.focus()
    await page.locator('.accueil [role="option"]').first().waitFor()
    assert.deepEqual(await geometry(), loading, 'successful retry must keep geometry')
    assert.equal(errors.length, 0, errors.join('\n'))
    assert.equal(assetFailures.length, 0, assetFailures.join('\n'))
    report.push({ width, longest: longest.nom, initial, loading, slots, pageErrors: errors, assetFailures })
    await page.close()
  }
  await writeFile(`${output}/verification.json`, JSON.stringify(report, null, 2))
  console.log(`Homepage geometry, real assets, empty/loading/error/retry, keyboard and inert slots passed at 1440/375/320px. Evidence: ${output}`)
} finally { await browser.close() }
