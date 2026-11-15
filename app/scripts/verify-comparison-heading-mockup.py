"""THROWAWAY artifact verification. Reuses the old exact numeric grid audit unchanged.
Run from app/: python scripts/verify-comparison-heading-mockup.py
Does not apply the old section-title assertion: its removal is the experiment.
"""
import json
import runpy
from pathlib import Path
import fitz

out = Path('E:/Temp/opencode/cahier-comparison-subtitle-mockup')
audit = runpy.run_path('scripts/audit-prototype-pdf-stress.py')
receipts = json.loads((out / 'receipts.json').read_text(encoding='utf8'))
results, crops = [], []
sample_book = fitz.open()
for receipt in receipts:
    doc = fitz.open(out / (receipt['id'] + '.pdf'))
    checks, findings = [], []
    pages = [audit['Page'](page) for page in doc]
    for index, page in enumerate(pages):
        audit['check_page_box'](page, checks)
        audit['check_text_bounds'](page, checks, findings)
        audit['check_comparison_footer'](page, receipt['pages'][index], checks, findings)
        audit['check_overlaps'](page, checks, findings)
        audit['check_page_number'](page, checks)
        audit['check_links'](page, receipt, checks, findings)
    labels = {audit['squash'](entry['displayed']) for entry in receipt['compactLabels']}
    metrics = audit['audit_tooltip_tables'](pages, receipt, checks, findings, receipt['id'], labels)
    page = doc[0]
    text = ''.join(page.get_text().split())
    heading = receipt['comparisonHeadings'][0]
    displayed = heading['displayed']
    def check(name, ok):
        checks.append({'name': name, 'ok': bool(ok)})
    check('one A4 sheet', len(doc) == 1)
    check('no additional whole-sheet shrinking', abs(receipt['scale'] - (595.28 - 64) / receipt['desktopWidth']) < .001)
    check('live DOM unchanged', receipt['liveDomUnchanged'])
    check('no custom section subtitle', 'Bacàsable' not in text)
    if displayed:
        check('selectable complete heading', ''.join(displayed.split()) in text)
        check('two rendered lines at fixed name size', heading['height'] <= 52.5 and heading['nameFontSize'] == '18px')
        if heading['strategy'] in ['prefix', 'count-only']:
            trials = heading['measurements'][1:-1]
            successes = [index + 1 for index, trial in enumerate(trials) if trial['fits']]
            check('largest complete-name prefix by rendered measurements', heading['shown'] == (max(successes) if successes else 0))
    else:
        # No heading; any group labels still present belong to figure context, not a new heading.
        check('no comparison subtitle emitted', heading['reason'] == 'no-displayed-comparison')
    if receipt['spec'].get('specimen'):
        check('synthetic notice retained', 'MAQUETTESYNTHÉTIQUE' in text)
        check('no live numeric tables in specimen', not receipt['tooltipTables'])
    else:
        check('source retained below body', 'Source(s):' in text)
    # Full rendered PDF, not a browser screenshot standing in for a PDF.
    page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6)).save(out / (receipt['id'] + '.png'))
    lines = [line for block in page.get_text('dict')['blocks'] for line in block.get('lines', [])]
    territory = receipt['spec'].get('focal', {}).get('nom', 'Rennes').upper()
    focal_lines = [line for line in lines if territory in ''.join(span['text'] for span in line['spans'])]
    if focal_lines:
        top = min(line['bbox'][1] for line in focal_lines)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=fitz.Rect(26, top - 8, page.rect.width - 26, min(top + 100, page.rect.height - 50)))
        crop_path = out / (receipt['id'] + '-heading.png')
        pix.save(crop_path)
        crops.append((receipt['id'], crop_path))
    results.append({'id': receipt['id'], 'pass': all(check.get('ok') is not False for check in checks), 'checks': checks, 'findings': findings, 'numericGrid': metrics})
    sample_book.insert_pdf(doc)

width = 600
images = []
for label, path in crops:
    image = fitz.Pixmap(path)
    images.append((label, path, image.height * (width - 20) / image.width))
sheet = fitz.open()
sheet_page = sheet.new_page(width=width, height=sum(height + 34 for _, _, height in images))
y = 0
for label, path, height in images:
    sheet_page.insert_text((10, y + 14), label, fontsize=9)
    sheet_page.insert_image(fitz.Rect(10, y + 28, width - 10, y + 28 + height), filename=str(path))
    y += height + 34
sheet_page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(out / 'all-headings.png')
sample_book.save(out / 'comparison-heading-examples.pdf')
(out / 'verification.json').write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf8')
print(json.dumps([{'id': r['id'], 'pass': r['pass'], 'cells': r['numericGrid']['cellsMatched'], 'failures': [c for c in r['checks'] if c.get('ok') is False]} for r in results], indent=2, ensure_ascii=False))
raise SystemExit(0 if all(result['pass'] for result in results) else 1)
