// THROWAWAY stress campaign. Synthetic mutations never leave this browser context.
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

// v1 receipts stay untouched; this campaign exercises the new three-mode cap.
const compact = true
const out = compact ? 'E:/Temp/opencode/cahier-pdf-stress-v2' : 'E:/Temp/opencode/cahier-pdf-stress'
await mkdir(out, { recursive: true })
const keys = ['aedar-car-overview', 'aedar-diversity-loss', 'aedar-access', 'aedar-equipment-profile', 'aedar-equipment-explorer']
const cases = [
  ...keys.map(sectionKey => ({ id: `real-${sectionKey}`, sectionKey })),
  { id: 'real-full-chapter', sectionKey: null },
  ...['aedar-access', 'aedar-equipment-explorer'].flatMap(sectionKey => [
    { id: `all-${sectionKey}`, sectionKey, modes: 'all' },
    { id: `single-${sectionKey}`, sectionKey, modes: 'single' },
    { id: `no-comparison-${sectionKey}`, sectionKey, modes: 'all', noComparison: true },
  ]),
  { id: 'real-longest-equipment', sectionKey: 'aedar-equipment-explorer', modes: 'all', equipment: 'longest' },
  { id: 'real-short-horizon', sectionKey: 'aedar-equipment-explorer', modes: 'all', horizon: '5 minutes' },
  ...keys.map(sectionKey => ({ id: `long-identity-${sectionKey}`, sectionKey, synthetic: true, mutation: 'identity' })),
  { id: 'large-values-sandbox', sectionKey: 'aedar-equipment-explorer', modes: 'three', synthetic: true, mutation: 'large' },
  { id: 'missing-values-sandbox', sectionKey: 'aedar-equipment-explorer', modes: 'three', synthetic: true, mutation: 'missing' },
  { id: 'oversized-waffle', sectionKey: 'aedar-equipment-profile', synthetic: true, mutation: 'oversized' },
  { id: 'repeat-sandbox', sectionKey: 'aedar-equipment-explorer', modes: 'all', repeat: true },
  ...(compact ? [{ id: 'three-mode-two-page-sandbox', sectionKey: 'aedar-equipment-explorer', modes: 'all', tablesOnSecondPage: true }] : []),
]
const server = await createServer({ optimizeDeps: { include: ['jspdf', 'svg2pdf.js'] }, server: { host: '127.0.0.1', port: 5199, strictPort: true, hmr: false } })
await server.listen()
const browser = await chromium.launch({ headless: true })
const results = []
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })
  page.setDefaultTimeout(15000)
  for (const test of cases.filter(test => !only || test.id === only)) {
    const errors = []
    const onError = error => errors.push(error.message)
    page.on('pageerror', onError)
    try {
      await page.goto('http://127.0.0.1:5199/territoire/commune/35238?theme=mobilite&comparaison=epci', { waitUntil: 'domcontentloaded' })
      await page.evaluate(async () => { window.rennesPrototype = await import('/src/fiche/prototype/pdf-prototype/rennes.js') })
      await page.waitForFunction(() => window.rennesPrototype.ready(), null, { timeout: 60000 })
      const section = page.locator(`.concept-group[data-section="${test.sectionKey}"]`)
      if (test.modes) {
        const buttons = section.locator('.cahier-figure-legend button[aria-pressed]')
        const count = await buttons.count()
        let kept = 0
        for (let index = 0; index < count; index++) {
          const button = buttons.nth(index)
          if ((await button.innerText()).includes('Groupe comparé')) continue
          const desired = test.modes === 'all' || kept < (test.modes === 'three' ? 3 : 1)
          if (desired) kept++
          if ((await button.getAttribute('aria-pressed') === 'true') !== desired) await button.click()
        }
      }
      if (test.noComparison) await section.locator('button[aria-pressed="true"]').filter({ hasText: 'Groupe comparé' }).click()
      if (test.equipment) {
        await section.getByRole('button', { name: 'Choisir un autre équipement' }).click()
        const options = page.getByRole('option')
        const labels = await options.allTextContents()
        const index = labels.reduce((best, label, index) => label.length > labels[best].length ? index : best, 0)
        test.selectedEquipment = labels[index].trim()
        await options.nth(index).click()
        await page.waitForFunction(() => window.rennesPrototype.ready(), null, { timeout: 60000 })
      }
      if (test.horizon) await section.locator('.aedar-equipment-explorer-horizon').getByRole('button', { name: test.horizon, exact: true }).click()
      await page.evaluate(async test => {
        const { nextTick } = await import('/node_modules/.vite/deps/vue.js')
        const instances = window.rennesPrototype.instances()
        if (test.mutation === 'identity') {
          const label = 'SYNTHÉTIQUE — Saint-Martin-de-la-Très-Longue-Dénomination-sur-la-Rivière'
          instances[0].props.content.territory.name = label
          document.querySelectorAll('.page-heading-territory').forEach(node => { node.textContent = label })
        }
        if (['large', 'missing'].includes(test.mutation)) {
          for (const instance of instances.filter(instance => instance.vnode.el?.closest?.('.concept-group')?.dataset.section === test.sectionKey)) {
            if (instance.type.__name === 'AccessRampFigureCahier') {
              for (const series of instance.props.timeRamp.series) for (const point of series.points) {
                point.value = test.mutation === 'missing' ? null : 123456789.9
                point.referenceValue = test.mutation === 'missing' ? null : 98765432.1
                if (test.mutation === 'missing') point.referenceRank = null
              }
            }
            if (instance.type.__name === 'CahierGroupedVerticalBarChart') {
              for (const series of instance.props.figure.series) {
                series.values.fill(test.mutation === 'missing' ? null : 123456789)
                if (test.mutation === 'missing') series.ranks?.fill(null)
              }
            }
            instance.proxy?.$forceUpdate()
          }
          const label = document.createElement('p'); label.textContent = 'SYNTHÉTIQUE — contraintes de valeurs, pas des observations réelles'
          document.querySelector(`.concept-group[data-section="${test.sectionKey}"]`).append(label)
        }
        if (test.mutation === 'oversized') {
          const section = document.querySelector(`.concept-group[data-section="${test.sectionKey}"]`)
          const figure = section.querySelector('figure')
          if (!figure) throw new Error('No waffle figure to duplicate')
          for (let i = 0; i < 5; i++) section.append(figure.cloneNode(true))
          const label = document.createElement('p'); label.textContent = 'SYNTHÉTIQUE — figure répétée six fois pour dépasser A4'; section.prepend(label)
        }
        await nextTick(); await document.fonts.ready
      }, test)
      // Generate from the actually loaded site faces, as in the ordinary harness.
      if (results.length === 0) {
        const inventory = await page.evaluate(() => ({
          fonts: [...new Map([...document.querySelectorAll('#figure-lecture *, .en-tete .lusk-marque, .en-tete .lusk-marque *')].filter(node => node.getClientRects().length).map(node => {
            const style = getComputedStyle(node)
            const spec = { family: style.fontFamily.split(',')[0].replaceAll(/["']/g, '').trim(), weight: Number(style.fontWeight), style: style.fontStyle }
            return [JSON.stringify(spec), spec]
          })).values()],
          loadedFaces: [...document.fonts].filter(face => face.status === 'loaded').map(face => ({ family: face.family.replaceAll(/["']/g, ''), style: face.style, weight: face.weight })),
        }))
        await writeFile(`${out}/inventory.json`, JSON.stringify(inventory))
        execFileSync('python', ['scripts/prototype-pdf-fonts.py', `${out}/inventory.json`], { stdio: 'inherit' })
      }
      await page.evaluate(async () => { window.desktopPdf = await import('/src/fiche/prototype/pdf-prototype/desktop.js') })
      const publicUrl = new URL(page.url()), target = new URL(server.config.server.proxy['/api'].target)
      publicUrl.host = target.host; publicUrl.protocol = target.protocol
      await page.evaluate(url => { window.desktopPublicPageUrl = url }, publicUrl.href)
      const snapshot = () => page.evaluate(() => ({ html: document.querySelector('.cahier').outerHTML, clones: document.querySelectorAll('.cahier').length }))
      const before = await snapshot()
      for (let run = 0; run < (test.repeat ? 2 : 1); run++) {
        await page.evaluate(() => {
          window.pdfScreenFrames = []
          window.pdfWatchScreen = true
          const sample = () => {
            if (!window.pdfWatchScreen) return
            window.pdfScreenFrames.push([...window.rennesPrototype.instances()[0].setupState.aedarAccessSelectedModes])
            requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        })
        const id = run ? `${test.id}-again` : test.id
        const download = page.waitForEvent('download', { timeout: 120000 }).catch(() => null)
        const exporting = page.evaluate(options => window.desktopPdf.exportDesktop(options), {
          sectionKey: test.sectionKey, includeTooltipTables: ['aedar-access', 'aedar-equipment-explorer'].includes(test.sectionKey), territoryFirst: true,
          tablesOnSecondPage: Boolean(test.tablesOnSecondPage),
        })
        let choiceEvidence
        if (compact && test.modes === 'all') {
          const dialog = page.locator('[data-pdf-mode-choice]')
          await dialog.waitFor({ state: 'visible' })
          const choices = dialog.locator('input[type="checkbox"]')
          const confirm = dialog.locator('[data-pdf-confirm-modes]')
          const disabledWithZero = await confirm.isDisabled()
          for (let index = 0; index < 4; index++) await choices.nth(index).check()
          const disabledWithFour = await confirm.isDisabled()
          await choices.nth(3).uncheck()
          const enabledWithThree = await confirm.isEnabled()
          if (test.id === 'all-aedar-equipment-explorer') await dialog.screenshot({ path: `${out}/mode-choice.png`, caret: 'initial' })
          choiceEvidence = { disabledWithZero, disabledWithFour, enabledWithThree }
          if (!disabledWithZero || !disabledWithFour || !enabledWithThree) throw new Error('Invalid mode-choice gating')
          await confirm.click()
        }
        const receipt = await exporting
        receipt.choiceEvidence = choiceEvidence
        receipt.screenFrames = await page.evaluate(() => { window.pdfWatchScreen = false; return window.pdfScreenFrames })
        receipt.noVisibleModeChange = receipt.screenFrames.every(modes => JSON.stringify(modes) === JSON.stringify(receipt.screenModes))
        if (!receipt.noVisibleModeChange) throw new Error('Screen selection changed at a browser paint')
        for (const table of receipt.tooltipTables) {
          const modes = table.selectedModes ?? [...new Set(table.rows.map(row => row.seriesKey ?? row.label))]
          if (test.modes === 'all' && modes.length !== (compact ? 3 : 5)) throw new Error(`Wrong exported mode count: ${modes.length}`)
          if (test.modes === 'single' && modes.length !== 1) throw new Error(`Expected one mode, got ${modes.length}`)
          if (test.modes === 'three' && modes.length !== 3) throw new Error(`Expected three modes, got ${modes.length}`)
          if (test.noComparison && table.hasComparison) throw new Error('Comparison still present in exported table')
          if (test.horizon && table.equipment?.horizonMinutes !== 5) throw new Error('Horizon was not changed to five minutes')
        }
        const artifact = await download
        if (!artifact) throw new Error('No PDF download')
        await artifact.saveAs(`${out}/${id}.pdf`)
        const after = await snapshot()
        receipt.liveDomUnchanged = before.html === after.html
        receipt.cloneCountUnchanged = before.clones === after.clones
        if (!receipt.liveDomUnchanged) {
          await writeFile(`${out}/${id}-before.html`, before.html)
          await writeFile(`${out}/${id}-after.html`, after.html)
        }
        await writeFile(`${out}/${id}-receipt.json`, JSON.stringify(receipt, null, 2))
        results.push({ ...test, id, synthetic: Boolean(test.synthetic), browserErrors: [...errors] })
        console.log('EXPORTED', id, receipt.bytes, `${receipt.totalMs.toFixed(0)}ms`, 'unchanged:', receipt.liveDomUnchanged)
      }
    } catch (error) {
      results.push({ ...test, synthetic: Boolean(test.synthetic), error: error.message, browserErrors: errors })
      console.error('FAILED', test.id, error.message)
    } finally {
      page.off('pageerror', onError)
      await writeFile(`${out}/cases.json`, JSON.stringify(results, null, 2))
    }
  }
  if (compact && !only) {
    const before = await page.evaluate(() => document.querySelector('.cahier').outerHTML)
    const invalid = await page.evaluate(async () => {
      try {
        await window.desktopPdf.exportDesktop({ sectionKey: 'aedar-equipment-explorer', pdfModes: ['car', 'bike_lts2', 'bike_lts4', 'transit'] })
        return false
      } catch (error) { return error.message.includes('one to three') }
    })
    let downloads = 0
    const onDownload = () => { downloads++ }
    page.on('download', onDownload)
    const cancelling = page.evaluate(() => window.desktopPdf.exportDesktop({ sectionKey: 'aedar-equipment-explorer', includeTooltipTables: true }))
    await page.locator('[data-pdf-mode-choice]').waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    const cancelled = await cancelling
    const after = await page.evaluate(() => document.querySelector('.cahier').outerHTML)
    page.off('download', onDownload)
    const checks = { invalidFourModeOverrideRejected: invalid, cancelled: cancelled.cancelled === true, noDownload: downloads === 0, liveDomUnchanged: before === after }
    await writeFile(`${out}/mode-choice-checks.json`, JSON.stringify(checks, null, 2))
    if (Object.values(checks).some(value => !value)) throw new Error('Mode cancellation/validation check failed')
    console.log('PASS mode-choice cancellation and explicit four-mode rejection')
  }
} finally { await browser.close(); server.httpServer?.closeAllConnections(); await server.close() }
console.log(`Artifacts: ${out}`)
