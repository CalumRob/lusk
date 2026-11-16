import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

// #1027: public rendered seam against a running preview. No invented article or
// territory content: long labels come from the served committed reference.
const base = process.env.LUSK_PREVIEW_URL || 'http://127.0.0.1:5177'
const output = process.env.LUSK_SCREENSHOT_DIR || 'E:/Temp/opencode/homepage-1027-r7'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
})
const report = []
try {
  for (const width of [1440, 900, 375, 320]) {
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
        return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height,
          bottom: r.bottom + window.scrollY }
      }
      const intro = box('.accueil-sous-titre')
      const tabs = box('.accueil-onglets')
      const brand = box('.accueil-hero-marque')
      return { search: box('.accueil-territoires'), brand, intro, tabs,
        editorial: box('.accueil-editorial'),
        link: box('.accueil-indicateurs'), pageWidth: document.documentElement.scrollWidth,
        docHeight: document.documentElement.scrollHeight,
        heroBorder: getComputedStyle(document.querySelector('.accueil-hero')).borderBottomWidth,
        gapIntroTabs: tabs.y - intro.bottom,
        gapIntroBrand: brand.y - intro.bottom,
        gapBrandTabs: tabs.y - brand.bottom,
        brandArea: getComputedStyle(document.querySelector('.accueil-hero-marque')).gridArea,
        brandFont: parseFloat(getComputedStyle(document.querySelector('.accueil-hero-marque .lusk-marque__mot')).fontSize),
        brandErmine: box('.accueil-hero-marque .lusk-marque__ermine'),
        columns: getComputedStyle(document.querySelector('.accueil-hero-interieur')).gridTemplateColumns }
    })
    const initial = await geometry()
    assert(initial.pageWidth <= width, 'no horizontal page overflow')
    assert.equal(initial.heroBorder, '0px', 'no permanent divider between hero and editorial selection')

    assert.equal(initial.brandArea, 'marque', 'brand occupies its named grid area, not auto-placement')
    assert(initial.gapIntroTabs > 0, 'the intro-to-tabs gap is documented, never collapsed')
    if (width >= 768) {
      // Owner density revision: breathing room, but bounded (the old auto-placed
      // brand stretched this row to ~127px at 1440).
      assert(initial.gapIntroTabs >= 16 && initial.gapIntroTabs <= 40,
        `intro→tabs gap ${initial.gapIntroTabs}px out of bounds`)
      assert(initial.brand.x > initial.search.x + initial.search.width,
        'the named brand area occupies the right column')
    } else {
      // Stacked flow: the brand itself sits between intro and tabs, so the two
      // visible gaps are asserted rather than the composite one.
      assert(initial.gapIntroBrand >= 16 && initial.gapIntroBrand <= 40,
        `intro→brand gap ${initial.gapIntroBrand}px out of bounds`)
      assert(initial.gapBrandTabs >= 16 && initial.gapBrandTabs <= 40,
        `brand→tabs gap ${initial.gapBrandTabs}px out of bounds`)
      assert.equal(initial.brand.x, initial.intro.x)
      assert.equal(initial.brand.width, initial.intro.width)
    }

    const searchTab = page.getByRole('tab', { name: 'Rechercher', exact: true })
    const browseTab = page.getByRole('tab', { name: 'Parcourir', exact: true })
    const searchTabBox = await searchTab.boundingBox()
    const browseTabBox = await browseTab.boundingBox()
    assert(Math.abs(searchTabBox.width - browseTabBox.width) < 1, 'tabs have equal widths')
    assert.equal(await searchTab.getAttribute('aria-selected'), 'true')
    for (const tab of [searchTab, browseTab]) {
      const panel = page.locator(`#${await tab.getAttribute('aria-controls')}`)
      assert.equal(await panel.getAttribute('role'), 'tabpanel')
      assert.equal(await panel.getAttribute('aria-labelledby'), await tab.getAttribute('id'))
    }
    await searchTab.focus()
    await searchTab.press('ArrowRight')
    assert.equal(await browseTab.getAttribute('aria-selected'), 'true')
    assert(await browseTab.evaluate((el) => el === document.activeElement))
    assert.equal(await input.isVisible(), false)
    const browseGeometry = await geometry()
    assert.equal(browseGeometry.search.width, initial.search.width, 'tab entry width stays fixed')
    assert.equal(browseGeometry.search.x, initial.search.x, 'tab entry does not move horizontally')
    assert.equal(browseGeometry.gapIntroTabs, initial.gapIntroTabs, 'the intro row never stretches with the brand or panel')
    assert.equal(browseGeometry.gapIntroBrand, initial.gapIntroBrand)
    assert.equal(browseGeometry.gapBrandTabs, initial.gapBrandTabs)

    assert(browseGeometry.search.height > initial.search.height, 'browse panel intentionally uses more natural height')
    assert(browseGeometry.link.y > initial.link.y, 'browse intentionally pushes the indicator link down')
    assert(browseGeometry.editorial.y > initial.editorial.y, 'browse intentionally pushes subsequent content down')
    assert.equal(browseGeometry.link.x, initial.link.x)
    assert.equal(browseGeometry.editorial.width, initial.editorial.width)
    if (width >= 768) {
      // Owner revision: the right-side brand is anchored in the composition.
      assert.deepEqual(browseGeometry.brand, initial.brand, 'brand/ermine stays put across tab changes')
    } else {
      // Single-column flow: the brand is ordered before the expanding access
      // area, so it must not move either; only its left edge may reflow.
      assert.deepEqual(browseGeometry.brand, initial.brand, 'stacked brand stays put across tab changes')
    }
    const rowGeometry = await page.locator('#accueil-panneau-parcourir a').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect()
      const panel = el.parentElement.getBoundingClientRect()
      const style = getComputedStyle(el)
      return { x: r.x, y: r.y, width: r.width, height: r.height, panelWidth: panel.width,
        border: style.borderBottomStyle, borderWidth: parseFloat(style.borderBottomWidth),
        decorativeArrow: el.querySelector('svg')?.getAttribute('aria-hidden') }
    }))
    assert.equal(rowGeometry.length, 3)
    for (const row of rowGeometry) {
      assert.equal(row.width, row.panelWidth, 'full-width navigational row')
      assert(row.height >= 48, 'generous click target')
      assert.equal(row.decorativeArrow, 'true')
    }
    assert(rowGeometry[1].y >= rowGeometry[0].y + rowGeometry[0].height)
    assert(rowGeometry[2].y >= rowGeometry[1].y + rowGeometry[1].height)
    assert(rowGeometry.slice(0, 2).every((row) => row.border === 'solid' && row.borderWidth >= 1), 'subtle row separators')
    const firstRow = page.locator('#accueil-panneau-parcourir a').first()
    const background = () => firstRow.evaluate((el) => getComputedStyle(el).backgroundColor)
    const restBackground = await background()
    await firstRow.hover()
    const hoverBackground = await background()
    assert.notEqual(hoverBackground, restBackground, 'visible row hover state')
    await page.mouse.down()
    assert.notEqual(await background(), hoverBackground, 'visible row active state')
    await browseTab.hover()
    await page.mouse.up()
    assert.equal(await page.locator('[role="tabpanel"] a[href="/indicateurs"]').count(), 0)
    await browseTab.press('Tab')
    assert(await page.locator('#accueil-panneau-parcourir a[href="/communes"]').evaluate((el) => el === document.activeElement))
    assert(await firstRow.evaluate((el) => getComputedStyle(el).outlineStyle !== 'none' && parseFloat(getComputedStyle(el).outlineWidth) >= 2), 'visible keyboard row focus')
    await page.keyboard.press('Shift+Tab')
    assert(await browseTab.evaluate((el) => el === document.activeElement))
    await browseTab.press('ArrowRight')
    assert(await searchTab.evaluate((el) => el === document.activeElement))
    await searchTab.press('End')
    assert(await browseTab.evaluate((el) => el === document.activeElement))
    await browseTab.press('Home')
    assert.deepEqual(await geometry(), initial, 'returning to search contracts to the original natural height')
    await searchTab.press('ArrowLeft')
    assert(await browseTab.evaluate((el) => el === document.activeElement))
    await page.screenshot({ path: `${output}/homepage-${width}-browse.png`, fullPage: true, animations: 'disabled' })
    for (const path of ['/communes', '/epcis', '/departements']) {
      await browseTab.click()
      await page.locator(`#accueil-panneau-parcourir a[href="${path}"]`).click()
      await page.waitForURL(`${base}${path}`)
      await page.locator('main h1').waitFor()
      await page.goBack()
      await page.locator('.accueil[aria-busy="false"]').waitFor()
      assert.equal(await searchTab.getAttribute('aria-selected'), 'true')
    }
    // Header remains the Sources/À propos navigation owner; mobile drawer is accessible.
    const headerNav = width < 768 ? page.locator('#menu-mobile') : page.locator('.nav-bureau')
    if (width < 768) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      assert.equal(await headerNav.getAttribute('aria-hidden'), 'false')
    }
    for (const href of ['/sources', '/a-propos', '/indicateurs']) {
      assert(await headerNav.locator(`a[href="${href}"]`).isVisible())
    }
    if (width < 768) {
      await page.keyboard.press('Escape')
      assert.equal(await headerNav.getAttribute('aria-hidden'), 'true')
      assert(await page.getByRole('button', { name: 'Menu', exact: true }).evaluate((el) => el === document.activeElement))
    }
    assert.deepEqual(await page.locator('.pied a').evaluateAll((els) => els.map((el) => el.getAttribute('href'))), ['https://calumrobertson.fr'])

    // #1028: the shared header search accepts the same exact code.
    if (width < 768) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      const tiroir = page.locator('#menu-mobile')
      const drawerInput = tiroir.locator('input[role="combobox"]')
      await drawerInput.fill('22001')
      await tiroir.locator('[role="option"]').first().waitFor()
      assert((await tiroir.locator('[role="option"]').first().innerText()).includes('Allineuc'))
      await drawerInput.press('Escape')
      await page.keyboard.press('Escape')
      assert.equal(await tiroir.getAttribute('aria-hidden'), 'true')
    } else {
      await page.getByRole('button', { name: 'Rechercher', exact: true }).click()
      const overlay = page.locator('#recherche-superposee')
      const overlayInput = overlay.locator('input[role="combobox"]')
      await overlayInput.fill('22001')
      await overlay.locator('[role="option"]').first().waitFor()
      assert((await overlay.locator('[role="option"]').first().innerText()).includes('Allineuc'))
      await overlayInput.press('Escape')
    }
    await searchTab.focus()
    await searchTab.press('Tab')
    assert(await input.evaluate((el) => el === document.activeElement))
    await input.fill(longest.nom)
    await page.locator('.accueil [role="option"]').first().waitFor()
    assert.equal(await page.locator('.accueil [role="option"]').first().innerText().then((t) => t.includes(longest.nom)), true)
    assert.deepEqual(await geometry(), initial, 'long results cannot change page/search geometry')
    const panelFits = await page.locator('.accueil .global-search__dropdown').evaluate((el) => el.scrollWidth <= el.clientWidth)
    assert(panelFits, 'long result fits inside dropdown without horizontal scrolling')
    await page.screenshot({ path: `${output}/homepage-${width}-long-search.png`, fullPage: true, animations: 'disabled' })
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

    // #1028: real identifiers read from the served reference, not invented.
    for (const exemple of [
      { code: '22001', nom: 'Allineuc', type: 'Commune', route: '/territoire/commune/22001' },
      { code: '200027027', nom: 'CC Arc Sud Bretagne', type: 'EPCI', route: '/territoire/epci/200027027' },
    ]) {
      await input.blur()
      await input.focus()
      await input.fill(exemple.code)
      await page.locator('.accueil [role="option"]').first().waitFor()
      assert.equal(await page.locator('.accueil [role="option"]').count(), 1, `code ${exemple.code} returns one row`)
      const option = page.locator('.accueil [role="option"]').first()
      assert((await option.innerText()).includes(exemple.nom))
      assert.equal(await option.locator('.global-search__chip').innerText(), exemple.type)
      assert.deepEqual(await geometry(), initial, 'code results cannot change geometry')
      await input.press('ArrowDown')
      assert.equal(await input.getAttribute('aria-activedescendant'), 'gsb-option-0')
      await input.press('Enter')
      await page.waitForURL(`${base}${exemple.route}`)
      await page.goBack()
      await page.locator('.accueil[aria-busy="false"]').waitFor()
      await input.focus()
    }
    await input.blur()
    await input.focus()
    await input.fill('22')
    await page.locator('.accueil [role="option"]').first().waitFor()
    assert((await page.locator('.accueil [role="option"]').first().innerText()).includes("Côtes-d'Armor"))
    assert.equal(await page.locator('.accueil [role="option"]').first().locator('.global-search__chip').innerText(), 'Département')
    assert((await page.locator('.accueil [role="option"]').count()) > 1, 'exact department also exposes its code prefixes')
    // Owner revision: code prefixes work while typing, not only complete codes.
    await input.fill('2200')
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('.accueil [role="option"]')]
      return rows.length > 1 && rows.every((row) => row.textContent.includes('Commune'))
    })
    const prefixRows = await page.locator('.accueil [role="option"]').evaluateAll((els) => els.map((el) => el.innerText.trim()))
    assert(prefixRows.length > 1)
    assert(prefixRows[0].includes('Allineuc'))
    assert(prefixRows.every((text) => text.includes('Commune')))
    assert.deepEqual(await geometry(), initial, 'prefix results cannot change geometry')
    await input.press('ArrowDown')
    assert.equal(await input.getAttribute('aria-activedescendant'), 'gsb-option-0')
    await input.press('Enter')
    await page.waitForURL(`${base}/territoire/commune/22001`)
    await page.goBack()
    await page.locator('.accueil[aria-busy="false"]').waitFor()
    await input.focus()
    await input.fill('200027')
    await page.waitForFunction(() => {
      const first = document.querySelector('.accueil [role="option"]')
      return first?.textContent.includes('CC Arc Sud Bretagne') && first.textContent.includes('EPCI')
    })
    const epciPrefix = await page.locator('.accueil [role="option"]').first().innerText()
    assert(epciPrefix.includes('CC Arc Sud Bretagne'))
    assert(epciPrefix.includes('EPCI'))
    await input.fill('99999')
    await page.getByText('Aucun résultat trouvé.', { exact: true }).waitFor()
    await input.press('Escape')
    await input.fill('')
    const codeSearch = { prefix2200: prefixRows, prefix200027: epciPrefix }
    const slots = await page.locator('.accueil-emplacement').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width }
    }))
    assert.equal(slots.length, 3)
    assert(slots.every((s) => Math.abs(s.width - slots[0].width) < 1))
    assert(width < 768 ? slots[1].y > slots[0].y : slots[1].y === slots[0].y)
    assert.equal(await page.locator('.accueil-editorial a, .accueil-editorial button, .accueil-editorial [tabindex]').count(), 0)
    const feuillets = await page.locator('.accueil-feuillet').evaluateAll((els) => els.map((el) => {
      const style = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return { background: style.backgroundColor, border: style.borderTopWidth,
        paddingLeft: parseFloat(style.paddingLeft), width: r.width, height: r.height }
    }))
    assert.equal(feuillets.length, 3)
    for (const feuillet of feuillets) {
      assert.equal(feuillet.background, 'rgb(241, 242, 236)', 'paper comes from the editorial token')
      assert.equal(feuillet.border, '1px')
      assert(feuillet.paddingLeft > 0, 'page margin treatment is present')
    }
    assert(feuillets.every((f) => Math.abs(f.width - feuillets[0].width) < 1), 'equal-width mini-pages')
    assert(feuillets.every((f) => Math.abs(f.height - feuillets[0].height) < 1), 'equal provisional page heights')
    await page.screenshot({ path: `${output}/homepage-${width}.png`, fullPage: true, animations: 'disabled' })
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
    const errorGeometry = await geometry()
    // Owner experiment: no permanently reserved recovery height. The real
    // error legitimately grows the document; only the search/brand/anchor
    // positions and the entry width must stay put.
    for (const cle of ['search', 'brand', 'link']) {
      assert.deepEqual(errorGeometry[cle], loading[cle], `error must not move ${cle}`)
    }
    assert(errorGeometry.editorial.y > loading.editorial.y,
      'the real error expands the document deliberately')
    const errorHeight = await page.locator('.accueil-erreur').evaluate((el) => el.getBoundingClientRect().height)
    assert(errorHeight > 0, 'the error occupies real space only when present')
    await page.screenshot({ path: `${output}/homepage-${width}-error.png`, fullPage: true, animations: 'disabled' })
    // The search dropdown is an out-of-flow overlay: dismiss it before using
    // the page-level retry underneath (the normal keyboard path).
    await input.press('Escape')
    await page.locator('.bouton-reessayer').click()
    await page.locator('.accueil[aria-busy="false"]').waitFor()
    await input.focus()
    await page.locator('.accueil [role="option"]').first().waitFor()
    assert.deepEqual(await geometry(), loading, 'successful retry returns to the compact geometry')
    assert.equal(errors.length, 0, errors.join('\n'))
    assert.equal(assetFailures.length, 0, assetFailures.join('\n'))
    const brandDeltaY = browseGeometry.brand.y - initial.brand.y
    report.push({ width, tabWidths: [searchTabBox.width, browseTabBox.width], rowGeometry, browseGeometry, codeSearch,
      brandDeltaY, feuillets,
      longest: longest.nom, initial, loading, slots, pageErrors: errors, assetFailures })
    await page.close()
  }

  // Owner experiment: compact normal-search view at representative desktop
  // heights. Fit is measured, never forced (no clipping, fixed height or
  // overflow:hidden), and a real 800px viewport is allowed to scroll.
  const desktopHeights = []
  for (const height of [900, 800]) {
    const page = await browser.newPage({ viewport: { width: 1440, height } })
    await page.goto(base)
    await page.locator('.accueil[aria-busy="false"]').waitFor()
    await page.evaluate(() => document.fonts.ready)
    const mesure = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect()
      return {
        viewport: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        hiddenOverflow: [document.documentElement, document.body]
          .some((el) => ['hidden', 'clip'].includes(getComputedStyle(el).overflowY)),
        reservation: document.querySelector('.accueil-recuperation')?.getBoundingClientRect().height ?? 0,
        errorPresent: Boolean(document.querySelector('.accueil-erreur')),
        editorialBottom: rect('.accueil-editorial').bottom + window.scrollY,
        footerTop: rect('.pied').top + window.scrollY,
      }
    })
    assert.equal(mesure.hiddenOverflow, false, 'fit is never obtained by clipping overflow')
    assert.equal(mesure.reservation, 0, 'no permanent empty recovery reservation')
    assert.equal(mesure.errorPresent, false)
    assert(mesure.editorialBottom <= mesure.footerTop, 'editorial precedes the footer')
    if (height === 900) {
      assert(mesure.scrollHeight <= mesure.viewport,
        `1440x900 must fit without scrolling (${mesure.scrollHeight} > ${mesure.viewport})`)
    } else {
      assert(mesure.scrollHeight > mesure.viewport,
        '1440x800 is recorded as an honest overflow, not force-fitted')
    }
    await page.screenshot({ path: `${output}/homepage-1440x${height}.png`, fullPage: true, animations: 'disabled' })
    desktopHeights.push({ height, ...mesure })
    await page.close()
  }
  await writeFile(`${output}/verification.json`, JSON.stringify({ previewWidths: report, desktopHeights }, null, 2))
  console.log(`Homepage tabs/focus/list navigation/header/footer, code exact/prefix search (#1028), compact 1440x900 (fit) and 1440x800 (honest overflow), geometry, real assets, empty/loading/error/retry, keyboard and inert mini-pages passed at 1440/900/375/320px. Evidence: ${output}`)
} finally { await browser.close() }
