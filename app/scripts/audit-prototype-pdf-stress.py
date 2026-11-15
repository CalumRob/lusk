"""THROWAWAY stress audit for the desktop PDF prototype (app/src/fiche/prototype/pdf-prototype/desktop.js).

Reads a stress-run ``cases.json`` (array of ``{id, synthetic, sectionKey, error?}``) and audits
each ``<id>.pdf`` against its ``<id>-receipt.json`` — the object returned by ``exportDesktop``.
Nothing here renders layout: every expectation is either taken from the receipt, from the
adapter's own page geometry constants, or measured in the produced PDF with PyMuPDF.

Contract used by the audit (all read from desktop.js, not re-declared as domain facts):

* A4 page box, ``left = 32`` horizontal margin, ``top = 72`` / ``bottom = 46`` content band,
  so body content occupies ``y in [72, H - 46]`` and the footer lines sit at ``H - 35`` /
  ``H - 23`` / ``H - 24`` (comparison note, invitation, page number).
* ``scale = min((W - 2 * left) / desktopWidth, capacity / max(sectionHeights))``. When the
  second term wins the whole section is shrunk below the width fit: that is the
  "extra whole-section downscale" finding, reported but not a hard failure.
* One footer invitation link per page, spawned by ``pdf.link(..., {url: home})`` outside the
  anchor walk, so PDF annotations == receipt ``links`` + page count.
* ``pages[i].showsComparisonContext`` gates the ``¹ Groupe comparé : …`` footer line and the
  dashed footer-reference links pointing at that page's own footer.

v2 receipts add four export-contract fields, all audited when present (a v1 receipt simply
skips them):

* ``exportModes`` / ``screenModes`` — the chooser narrows the reader's on-screen selection to at
  most three modes; every tooltip table must be laid out in exactly the exported modes.
* ``choiceEvidence`` (captured by the stress harness) — the chooser must refuse zero and four
  modes and accept three whenever the selection had to be narrowed.
* ``compactLabels`` ``[{full, displayed}]`` — a territory table header may be elided to at most
  two lines with a trailing ellipsis. The table header must read back as one of those labels,
  and the full identity must still appear elsewhere in the PDF (the heading).
* ``tablesOnSecondPage`` — the values tables get their own continuation page whose receipt
  ``sections`` end in ``-values``; the grid audit follows them to that page.

The one value substitution v2 allows is the literal ``Indisponible`` painted as ``Indisp.``,
and only while the page still carries the adapter's ``Indisp. : valeur indisponible.`` note.
Numeric cells are always compared exactly, so a number that does not fit stays a failure.

Usage:
    python app/scripts/audit-prototype-pdf-stress.py [cases.json] [--out DIR]

Defaults to ``E:/Temp/opencode/cahier-pdf-stress/cases.json``; pass the v2 campaign path
explicitly. ``--out`` still defaults to the cases directory. A case may override its artifact
names with ``pdfFile`` / ``receiptFile`` (relative to the cases file).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import fitz

DEFAULT_CASES = Path("E:/Temp/opencode/cahier-pdf-stress/cases.json")
DEFAULT_MIN_BYTES = 4000
DEFAULT_PNG_DPI = 120

A4_WIDTH = 595.28
A4_HEIGHT = 841.89
A4_TOLERANCE = 0.6

PAGE_MARGIN_LEFT = 32.0
PAGE_CONTENT_TOP = 72.0
PAGE_MARGIN_BOTTOM = 46.0

# Footer zone. 790 is the threshold asked for by the stress brief; the adapter's own body
# capacity ends at H - 46 = 795.89 and the first footer line starts at H - 35 (baseline 806.9,
# top of the 7pt glyphs at 800.0), so body text can legitimately reach 795.89. Both boundaries
# are used: words starting below FOOTER_BAND_TOP are "footer-ish", words starting below
# content_bottom are footer, and a body word whose bottom crosses content_bottom is overflow.
FOOTER_BAND_TOP = 790.0
FOOTER_ASCII = ("Retrouvez", "cartes", "explorez")
GROUPE_COMPARE = "groupe compare"
COMPARISON_MARK = "\u00b9"
GROUPED_LAYOUT = "grouped-modes"
# appendSandboxTables() appends the ramp table first, then the grouped bar table.
GROUPED_AXIS_HEADERS = ("Temps", "Statistique")

# v2 export contract (desktop.js `exportDesktop` + `fitTableLabels` + `modeChoice`).
MAX_EXPORT_MODES = 3
ELLIPSIS = "\u2026"
UNAVAILABLE_FULL = "Indisponible"
UNAVAILABLE_SHORT = "Indisp."
# Exact note the adapter appends once per section that abbreviates an unavailable value:
# "Indisp. : valeur indisponible."
UNAVAILABLE_NOTE_RE = re.compile(r"indisp\.?\s*:\s*valeur\s+indisponible")

OVERLAP_TOLERANCE = 0.75
TABLE_ROW_RULE_MIN_SEGMENTS = 6
TABLE_BAND_HEADER_ALLOWANCE = 34.0


# --------------------------------------------------------------------------- text helpers


def fold(text: str) -> str:
    """Accent/case-insensitive form for matching app-owned labels."""
    decomposed = unicodedata.normalize("NFKD", text or "")
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(stripped.lower().split())


def compact(text: str) -> str:
    """Comparison form for table cells: all whitespace removed (French digit grouping)."""
    return "".join((text or "").split())


def squash(text: str) -> str:
    """Accent/case-insensitive, whitespace-free form: labels only, never numeric cells.

    Table headers and the page heading can be uppercased by CSS (`text-transform`), so label
    identity is compared without case or accents.
    """
    return "".join(fold(text).split())


def unavailable_explained(text: str) -> bool:
    """True when the page carries the adapter's explanation of the 'Indisp.' abbreviation."""
    return bool(UNAVAILABLE_NOTE_RE.search(fold(text)))


def unavailable_note_count(text: str) -> int:
    return len(UNAVAILABLE_NOTE_RE.findall(fold(text)))


def cell_matches(expected: str, found: str, explained: bool) -> tuple[bool, str | None]:
    """Exact cell comparison, with the single v2 abbreviation the adapter is allowed to make.

    Numbers never get a substitute: only the literal value 'Indisponible' may be painted as
    'Indisp.', and only while the page still explains that abbreviation.
    """
    if compact(found) == compact(expected):
        return True, None
    if compact(expected) == compact(UNAVAILABLE_FULL) and compact(found) == compact(UNAVAILABLE_SHORT):
        if explained:
            return True, "abbreviated"
        return False, "abbreviated without the 'Indisp. : valeur indisponible.' note"
    return False, None


def compact_label_problem(entry: object) -> str | None:
    """Validate one receipt compactLabels entry: {full, displayed}.

    The adapter elides a territory table header with a trailing ellipsis, so the displayed
    label must be the full label truncated (never rewritten) and must end with the ellipsis.
    """
    if not isinstance(entry, dict):
        return "entry is not an object"
    full, displayed = entry.get("full"), entry.get("displayed")
    if not isinstance(full, str) or not full.strip():
        return "missing full label"
    if not isinstance(displayed, str) or not displayed.strip():
        return "missing displayed label"
    if displayed == full:
        return None
    if not displayed.endswith(ELLIPSIS):
        return f"displayed label {displayed!r} has no trailing ellipsis"
    stem = displayed[: -len(ELLIPSIS)].rstrip()
    if not stem:
        return "displayed label is only an ellipsis"
    if not squash(full).startswith(squash(stem)):
        return f"displayed label {displayed!r} is not a truncation of {full!r}"
    # Compare the retained stem, not the raw strings: NFKD turns the ellipsis into three dots,
    # which would make any elided label look no shorter than its full label.
    if len(squash(stem)) >= len(squash(full)):
        return f"displayed label {displayed!r} drops nothing from {full!r}"
    return None


# --------------------------------------------------------------------------- PDF geometry


class Page:
    """Words, rotated spans and rules of one PDF page, measured once."""

    def __init__(self, page: fitz.Page):
        self.raw = page
        self.width = page.rect.width
        self.height = page.rect.height
        self.content_bottom = self.height - PAGE_MARGIN_BOTTOM
        self.rotated = self._rotated_rects(page)
        self.words = self._words(page)
        self.rules = self._rules(page)

    @staticmethod
    def _rotated_rects(page: fitz.Page) -> list[fitz.Rect]:
        rects = []
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                direction = tuple(round(value, 2) for value in line.get("dir", (1.0, 0.0)))
                if direction not in ((1.0, 0.0), (-1.0, 0.0)):
                    rects.append(fitz.Rect(line["bbox"]))
        return rects

    def _words(self, page: fitz.Page) -> list[dict]:
        words = []
        for x0, y0, x1, y1, text, *_ in page.get_text("words"):
            rect = fitz.Rect(x0, y0, x1, y1)
            # A rotated chart axis label shares its bbox with the upright text around it; row
            # clustering only makes sense for upright glyphs.
            if any(abs(rect & rotated) > 0.5 * abs(rect) for rotated in self.rotated):
                continue
            words.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1, "text": text,
                          "yc": (y0 + y1) / 2})
        return words

    @staticmethod
    def _rules(page: fitz.Page) -> dict[float, list[tuple[float, float]]]:
        rules: dict[float, list[tuple[float, float]]] = {}
        for drawing in page.get_drawings():
            rect = drawing["rect"]
            if rect.height <= 1.0 and rect.width >= 15:
                rules.setdefault(round(rect.y0, 1), []).append((rect.x0, rect.x1))
        return rules

    def table_bands(self) -> list[tuple[float, float]]:
        """Vertical spans of drawn tables, from runs of multi-segment horizontal rules."""
        heavy = sorted(y for y, segments in self.rules.items()
                       if len(segments) >= TABLE_ROW_RULE_MIN_SEGMENTS)
        bands: list[list[float]] = []
        for y in heavy:
            if bands and y - bands[-1][1] <= 26:
                bands[-1][1] = y
            else:
                bands.append([y, y])
        return [(max(0.0, top - TABLE_BAND_HEADER_ALLOWANCE), bottom + 4) for top, bottom in bands]

    def in_table(self, y: float, bands: list[tuple[float, float]]) -> bool:
        return any(top <= y <= bottom for top, bottom in bands)

    def text(self) -> str:
        return self.raw.get_text()

    def footer_words(self) -> list[dict]:
        return [word for word in self.words if word["y0"] >= self.content_bottom - 0.5]

    def body_words(self) -> list[dict]:
        return [word for word in self.words if word["y0"] < self.content_bottom - 0.5]


def row_groups(words: list[dict], tolerance: float = 1.4) -> list[list[dict]]:
    rows: list[list[dict]] = []
    for word in sorted(words, key=lambda item: (item["yc"], item["x0"])):
        if rows and abs(rows[-1][-1]["yc"] - word["yc"]) <= tolerance:
            rows[-1].append(word)
        else:
            rows.append([word])
    for row in rows:
        row.sort(key=lambda item: item["x0"])
    return rows


def horizontal_overlaps(words: list[dict]) -> list[tuple[dict, dict, float]]:
    """Word pairs whose glyph boxes collide horizontally on the same baseline."""
    collisions = []
    for row in row_groups(words):
        for left, right in zip(row, row[1:]):
            overlap = left["x1"] - right["x0"]
            if overlap > OVERLAP_TOLERANCE:
                collisions.append((left, right, overlap))
    return collisions


# --------------------------------------------------------------------------- audit plumbing


def add(checks: list[dict], name: str, ok: bool | None, detail: str = "") -> bool:
    status = "skip" if ok is None else ("pass" if ok else "fail")
    checks.append({"name": name, "status": status, "detail": detail})
    return bool(ok)


def finding(findings: list[dict], code: str, detail: str, **extra) -> None:
    entry = {"code": code, "detail": detail}
    entry.update(extra)
    findings.append(entry)


def link_uris(page: fitz.Page) -> list[dict]:
    return [{"uri": link.get("uri"), "kind": link["kind"], "from": fitz.Rect(link["from"]),
             "page": link.get("page"), "to": link.get("to")} for link in page.get_links()]


# --------------------------------------------------------------------------- page checks


def check_page_box(page: Page, checks: list[dict]) -> None:
    ok = (abs(page.width - A4_WIDTH) <= A4_TOLERANCE and abs(page.height - A4_HEIGHT) <= A4_TOLERANCE)
    add(checks, f"page {page.raw.number + 1} is A4", ok,
        f"{page.width:.2f} x {page.height:.2f} pt")


def check_text_bounds(page: Page, checks: list[dict], findings: list[dict]) -> None:
    index = page.raw.number + 1
    outside_media = [word for word in page.words
                     if word["x0"] < -0.5 or word["y0"] < -0.5
                     or word["x1"] > page.width + 0.5 or word["y1"] > page.height + 0.5]
    add(checks, f"page {index} text inside media box", not outside_media,
        "" if not outside_media else f"{len(outside_media)} words outside the page box, first: "
        f"{outside_media[0]['text']!r} at ({outside_media[0]['x0']:.1f}, {outside_media[0]['y0']:.1f})")

    outside_margin = [word for word in page.words
                      if word["x0"] < PAGE_MARGIN_LEFT - OVERLAP_TOLERANCE
                      or word["x1"] > page.width - PAGE_MARGIN_LEFT + OVERLAP_TOLERANCE]
    for word in outside_margin[:12]:
        finding(findings, "text-outside-side-margins",
                f"page {index}: {word['text']!r} spans x={word['x0']:.1f}..{word['x1']:.1f}, "
                f"outside the {PAGE_MARGIN_LEFT:.0f} pt content margins",
                page=index, x0=round(word["x0"], 1), x1=round(word["x1"], 1))
    if len(outside_margin) > 12:
        finding(findings, "text-outside-side-margins",
                f"page {index}: {len(outside_margin) - 12} further words outside the side margins",
                page=index)

    # Body text must not reach the footer zone (comparison note at H-35, invitation at H-23).
    penetrating = [word for word in page.body_words() if word["y1"] > page.content_bottom + 0.5]
    add(checks, f"page {index} body stays above the footer", not penetrating,
        "" if not penetrating else f"{len(penetrating)} body words reach y > "
        f"{page.content_bottom:.1f}, first: {penetrating[0]['text']!r} at y={penetrating[0]['y1']:.1f}")

    footer = page.footer_words()
    for body_word in page.body_words():
        if body_word["y1"] < FOOTER_BAND_TOP:
            continue
        body_rect = fitz.Rect(body_word["x0"], body_word["y0"], body_word["x1"], body_word["y1"])
        for footer_word in footer:
            footer_rect = fitz.Rect(footer_word["x0"], footer_word["y0"], footer_word["x1"],
                                    footer_word["y1"])
            if abs(body_rect & footer_rect) > 0.4:
                finding(findings, "body-overlaps-footer",
                        f"page {index}: body {body_word['text']!r} overlaps footer "
                        f"{footer_word['text']!r}",
                        page=index)
                break


def check_selectable_text(page: Page, receipt_page: dict | None,
                          findings: list[dict]) -> int:
    index = page.raw.number + 1
    characters = len(page.text().strip())
    if receipt_page and receipt_page.get("sections"):
        if characters < 40:
            finding(findings, "sparse-selectable-text",
                    f"page {index}: only {characters} extractable characters for sections "
                    f"{receipt_page['sections']}", page=index, characters=characters)
    return characters


def check_comparison_footer(page: Page, receipt_page: dict, checks: list[dict],
                            findings: list[dict]) -> None:
    index = page.raw.number + 1
    raw_footer = page.raw.get_textbox(fitz.Rect(0, page.content_bottom - 2, page.width,
                                                page.height))
    footer_text = fold(raw_footer)
    expected = receipt_page.get("showsComparisonContext")
    if expected is None:
        finding(findings, "receipt-missing-comparison-context",
                f"page {index}: receipt has no showsComparisonContext, footer state unverified",
                page=index)
        add(checks, f"page {index} comparison footer", None, "receipt lacks showsComparisonContext")
        return
    shows = GROUPE_COMPARE in footer_text
    add(checks, f"page {index} comparison footer matches receipt", shows == bool(expected),
        f"footer shows {shows!r}, receipt says {bool(expected)!r}")
    # The mark is checked on the raw text: fold() decomposes the superscript into a plain digit.
    if expected and COMPARISON_MARK not in raw_footer:
        finding(findings, "comparison-footer-missing-mark",
                f"page {index}: comparison footer lacks the {COMPARISON_MARK} mark", page=index)


def check_page_number(page: Page, checks: list[dict]) -> None:
    index = page.raw.number + 1
    right_side = sorted((word for word in page.footer_words() if word["x0"] > page.width * 0.6),
                        key=lambda word: word["x0"])
    joined = "".join(word["text"] for word in right_side)
    match = re.search(r"(\d+)\s*/\s*(\d+)$", joined)
    ok = match is not None and int(match.group(2)) == page.raw.parent.page_count
    add(checks, f"page {index} prints 'n / N' in the footer", ok,
        f"right-hand footer text {joined!r}")


def check_links(page: Page, receipt: dict, checks: list[dict], findings: list[dict]) -> None:
    index = page.raw.number + 1
    links = link_uris(page.raw)
    url = receipt.get("url")
    if not url:
        finding(findings, "receipt-missing-url", f"page {index}: receipt has no url, link targets "
                                                 f"not checked", page=index)
        return
    parts = re.match(r"^(https?)://([^/]+)", url)
    home = f"{parts.group(1)}://{parts.group(2)}/" if parts else None
    adds = [link for link in links if link["kind"] == fitz.LINK_URI]

    add(checks, f"page {index} wordmark links home", any(
        link["uri"] == home and link["from"].y0 < 90 for link in adds),
        f"home={home}")
    add(checks, f"page {index} header links the public page", any(
        link["uri"] == url for link in adds), f"url={url}")
    add(checks, f"page {index} footer invitation links home", any(
        link["uri"] == home and link["from"].y0 > page.height - 80 for link in adds),
        "no home link below y=H-80")

    expected_context = None
    receipt_pages = receipt.get("pages") or []
    if len(receipt_pages) >= index:
        expected_context = receipt_pages[index - 1].get("showsComparisonContext")
    if expected_context:
        markers = [link for link in links if link["kind"] == fitz.LINK_GOTO
                   and link["page"] == index - 1]
        add(checks, f"page {index} footer markers target its own footer",
            bool(markers) and all(link["to"].y > page.height - 80 for link in markers),
            f"{len(markers)} internal links")


def check_overlaps(page: Page, checks: list[dict], findings: list[dict]) -> None:
    index = page.raw.number + 1
    bands = page.table_bands()
    words = [word for word in page.words if word["y0"] < page.content_bottom - 0.5]
    collisions = horizontal_overlaps(words)
    add(checks, f"page {index} no horizontal glyph collisions", not collisions,
        "" if not collisions else f"{len(collisions)} colliding word pairs")
    for left, right, overlap in collisions[:40]:
        code = "table-cell-overlap" if page.in_table(left["yc"], bands) else "text-overlap"
        finding(findings, code,
                f"page {index}: {left['text']!r} (x1={left['x1']:.1f}) overlaps "
                f"{right['text']!r} (x0={right['x0']:.1f}) by {overlap:.1f} pt at y={left['yc']:.0f}",
                page=index, overlap=round(overlap, 2))
    if len(collisions) > 40:
        finding(findings, "table-cell-overlap" if any(
            page.in_table(left["yc"], bands) for left, _, _ in collisions) else "text-overlap",
            f"page {index}: {len(collisions) - 40} further colliding word pairs suppressed",
            page=index)


# --------------------------------------------------------------------------- table audit


def find_axis_header(page: Page, label: str, after: float | None) -> dict | None:
    candidates = sorted((word for word in page.words if word["text"] == label
                         and (after is None or word["y0"] > after)), key=lambda w: w["y0"])
    return candidates[0] if candidates else None


def table_rule_run(page: Page, axis: dict, columns: int, max_gap: float = 30.0) -> list[float]:
    """y positions of the drawn row borders of the table whose header starts at ``axis``.

    ``border-collapse`` tables paint one horizontal rule per cell, so a data-row border shows
    up as exactly one segment per column. The run starts at the sub-header row's bottom border
    and continues while borders keep the same column count and stay adjacent.
    """
    run: list[float] = []
    for y in sorted(y for y in page.rules if y >= axis["y0"] - 1.0):
        if len(cell_edges(page.rules[y])) != columns:
            if run:
                break
            continue
        if run and y - run[-1] > max_gap:
            break
        run.append(y)
    return run


def cell_edges(segments: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """One entry per drawn cell border, dropping the duplicates a table can paint twice."""
    unique: list[list[float]] = []
    for x0, x1 in sorted(segments):
        if unique and abs(unique[-1][0] - x0) <= 0.2 and abs(unique[-1][1] - x1) <= 0.2:
            continue
        unique.append([x0, x1])
    return [(x0, x1) for x0, x1 in unique]


def contained_lines(page: Page, left: float, right: float, top: float, bottom: float) -> list[str]:
    """Text lines lying entirely inside a horizontal span, in reading order."""
    lines = []
    for words in row_groups([word for word in page.words
                             if top <= word["y0"] <= bottom
                             and left - 0.5 <= word["x0"]
                             and word["x1"] <= right + OVERLAP_TOLERANCE]):
        lines.append(" ".join(word["text"] for word in words))
    return lines


def audit_grouped_table(page: Page, table: dict, axis_label: str, checks: list[dict],
                        findings: list[dict], case_id: str, table_index: int,
                        header_after: float | None, allowed_labels: set[str] | frozenset[str],
                        explained: bool) -> dict | None:
    """Exact grid audit of one appendSandboxTables() table.

    The grid (cell edges, row bands) comes from the drawn cell borders, not from header word
    positions, so long territory names or missing comparison columns cannot desynchronise the
    column mapping. Values are then compared with the receipt's shared tooltip model.
    """
    modes = list(table.get("selectedModes") or [])
    rows = list(table.get("rows") or [])
    label = f"table {table_index} ({axis_label or '?'})"
    if not modes or not rows:
        add(checks, f"{label} auditable", None, "receipt table has no modes/rows")
        return None
    per_mode = 3 if table.get("hasComparison") else 1
    columns = 1 + per_mode * len(modes)
    labels = {mode: next((row["label"] for row in rows if row.get("seriesKey") == mode), None)
              for mode in modes}

    axis = find_axis_header(page, axis_label, header_after) if axis_label else None
    if axis is None:
        add(checks, f"{label} axis header present", False, f"missing {axis_label!r} header")
        return None
    add(checks, f"{label} axis header present", True, f"{axis_label!r} at y={axis['y0']:.1f}")

    run = table_rule_run(page, axis, columns)
    if len(run) < 2:
        add(checks, f"{label} drawn grid found", False,
            f"{len(run)} row borders with {columns} cells, expected at least the header and one row")
        finding(findings, "grouped-grid-missing",
                f"{case_id} {label}: could not locate {columns} drawn cell borders",
                case=case_id, table=table_index)
        return None
    add(checks, f"{label} drawn grid found", True,
        f"{len(run) - 1} data rows x {columns} columns")

    edges = cell_edges(page.rules[run[0]])
    if len(edges) != columns:
        add(checks, f"{label} cell edges match the column model", False,
            f"{len(edges)} drawn cell edges, expected {columns}")
        finding(findings, "grouped-grid-missing",
                f"{case_id} {label}: {len(edges)} unique cell edges, expected {columns}",
                case=case_id, table=table_index)
        return None
    add(checks, f"{label} cell edges match the column model", True,
        f"{columns} columns, x={edges[0][0]:.1f}..{edges[-1][1]:.1f}")

    header_bottom = run[0]
    row_step = (run[-1] - run[0]) / max(1, len(run) - 1)
    heights = [run[index + 1] - run[index] for index in range(len(run) - 1)]
    median_step = sorted(heights)[len(heights) // 2] if heights else row_step
    previous_rule = max((y for y in page.rules if y < header_bottom - 0.5), default=None)
    uses_rule = previous_rule is not None and header_bottom - previous_rule <= 30

    # ---- axis cell
    axis_cell = page.raw.get_textbox(fitz.Rect(edges[0][0], axis["y0"] - 1,
                                               edges[0][1], header_bottom - 0.3))
    add(checks, f"{label} axis header cell", compact(axis_cell) == compact(axis_label),
        f"cell holds {axis_cell.strip()!r}")

    # ---- mode row (colSpan labels), checked per column group against receipt labels.
    # A wrapped mode label keeps its lines inside its own colSpan cell, so the cell text is the
    # concatenation of the lines that stay inside the group; a centred caption line above the
    # table spans several groups and is therefore not picked up.
    group_span = [(edges[1 + per_mode * group][0], edges[per_mode * (group + 1)][1])
                  for group in range(len(modes))]
    header_band_top = (previous_rule if uses_rule else header_bottom - median_step) - median_step
    mode_bottom = (previous_rule if uses_rule else header_bottom - median_step) - 0.4
    mode_mismatches = []
    for group, mode in enumerate(modes):
        left, right = group_span[group]
        lines = contained_lines(page, left, right, header_band_top, mode_bottom)
        found = " ".join(lines)
        expected = labels.get(mode)
        if expected is not None and compact(found) != compact(expected):
            mode_mismatches.append({"mode": mode, "expected": expected, "found": found})
    add(checks, f"{label} mode headers name their series", not mode_mismatches,
        "" if not mode_mismatches else f"{len(mode_mismatches)} mode headers differ")
    for mismatch in mode_mismatches[:10]:
        finding(findings, "grouped-mode-header-mismatch",
                f"{case_id} {label}: mode header for {mismatch['mode']!r} reads "
                f"{mismatch['found']!r}, receipt label is {mismatch['expected']!r}",
                case=case_id, table=table_index)

    # ---- sub-header row: [territory, Groupe ¹, Rang] per mode, or one territory column.
    # v2 elides the territory label to at most two lines with a trailing ellipsis and records
    # the pair in receipt compactLabels, so that cell accepts the full or the displayed label.
    sub_top = (previous_rule + 0.2) if uses_rule else (axis["y0"] - 0.5)
    sub_bottom = header_bottom - 0.3
    sub_mismatches, empty_cells, clipped_labels = [], [], []
    for group, mode in enumerate(modes):
        for offset in range(per_mode):
            column = 1 + per_mode * group + offset
            left, right = edges[column]
            found = page.raw.get_textbox(fitz.Rect(left + 0.3, sub_top, right - 0.3, sub_bottom))
            if offset == 0:
                value = squash(found)
                if not value:
                    empty_cells.append({"mode": mode, "offset": offset})
                elif allowed_labels and value not in allowed_labels:
                    if any(allowed.startswith(value) for allowed in allowed_labels) \
                            and len(value) >= 3:
                        clipped_labels.append({"mode": mode, "found": found.strip()})
                    else:
                        sub_mismatches.append({"mode": mode, "offset": offset,
                                               "expected": "/".join(sorted(allowed_labels))[:160],
                                               "found": found.strip()})
                continue
            expected = "Groupe" if offset == 1 else "Rang"
            normalised = fold(found)
            ok = normalised.startswith("groupe") if offset == 1 else normalised == "rang"
            if not ok:
                sub_mismatches.append({"mode": mode, "offset": offset,
                                       "expected": expected, "found": found.strip()})
    add(checks, f"{label} sub-header cells", not sub_mismatches and not empty_cells,
        f"{len(sub_mismatches)} wrong labels, {len(empty_cells)} empty territory labels")
    if clipped_labels:
        add(checks, f"{label} territory label extraction is complete", None,
            f"{len(clipped_labels)} cell(s) lost part of a compact label to the cell clip")
        finding(findings, "compact-label-clipped",
                f"{case_id} {label}: {len(clipped_labels)} territory header cell(s) read back "
                f"shorter than the receipt's compact label (cell clip, not a layout defect); "
                f"first: {clipped_labels[0]['found']!r}",
                case=case_id, table=table_index)
    for mismatch in sub_mismatches[:10]:
        finding(findings, "grouped-subheader-mismatch",
                f"{case_id} {label}: {mismatch['mode']!r} column {mismatch['offset']} reads "
                f"{mismatch['found']!r}, expected {mismatch['expected']!r}",
                case=case_id, table=table_index)
    for cell in empty_cells[:10]:
        finding(findings, "grouped-subheader-mismatch",
                f"{case_id} {label}: empty territory label above mode {cell['mode']!r}",
                case=case_id, table=table_index)

    # ---- header words must stay inside the cell they start in (nowrap long identities).
    # Only the sub-header row is checked cell by cell: the mode row above it is a colSpan cell
    # and deliberately runs across its three columns, so it is validated by the label
    # comparison above instead.
    header_words = [word for word in page.words
                    if sub_top <= word["y0"] <= sub_bottom
                    and edges[0][0] - 1 <= word["x0"] <= edges[-1][1] + 1]
    bleeding = []
    for word in header_words:
        centre = (word["x0"] + word["x1"]) / 2
        column = next((index for index, (left, right) in enumerate(edges)
                       if left <= centre < right), None)
        if column is None:
            bleeding.append((word, None))
        elif word["x1"] > edges[column][1] + OVERLAP_TOLERANCE:
            bleeding.append((word, edges[column][1]))
    add(checks, f"{label} header words stay inside their column", not bleeding,
        "" if not bleeding else f"{len(bleeding)} header words cross a cell edge")
    for word, edge in bleeding[:10]:
        finding(findings, "grouped-header-bleed",
                f"{case_id} {label}: header word {word['text']!r} spans "
                f"x={word['x0']:.1f}..{word['x1']:.1f}"
                + (f", past its cell edge {edge:.1f}" if edge else ", outside every column"),
                case=case_id, table=table_index)

    # ---- vertical group separators, drawn only between mode groups
    separators = []
    for drawing in page.raw.get_drawings():
        rect = drawing["rect"]
        if rect.width < 1.0 and rect.height > 2 and header_bottom - 1 <= rect.y0 <= run[-1]:
            value = rect.x0
            if not any(abs(value - seen) <= 0.6 for seen in separators):
                separators.append(value)
    add(checks, f"{label} mode-group separators", len(separators) == len(modes) - 1,
        f"{len(separators)} vertical rules, expected {len(modes) - 1}")

    # ---- body cells against the receipt's tooltip rows
    cuts = list(dict.fromkeys(row["cut"] for row in rows))
    data_rows = len(run) - 1
    add(checks, f"{label} drawn rows match the receipt rows", data_rows == len(cuts),
        f"{data_rows} drawn rows, receipt has {len(cuts)} cuts")

    checked = 0
    matched = 0
    abbreviated = 0
    mismatches: list[dict] = []
    overflows: list[dict] = []
    for index, cut in enumerate(cuts[:data_rows]):
        band_top, band_bottom = run[index], run[index + 1]
        label_text = page.raw.get_textbox(fitz.Rect(edges[0][0] + 0.3, band_top + 0.2,
                                                    edges[0][1] - 0.3, band_bottom - 0.2))
        checked += 1
        if compact(label_text) == compact(cut):
            matched += 1
        else:
            mismatches.append({"cut": cut, "column": "row label",
                               "expected": cut, "found": label_text.strip()})
        for group, mode in enumerate(modes):
            expected_row = next((row for row in rows
                                 if row["cut"] == cut and row.get("seriesKey") == mode), None)
            if expected_row is None:
                continue
            comparison = expected_row.get("comparison") or {}
            values = [expected_row.get("value", "")]
            if per_mode == 3:
                values += [comparison.get("value", ""), comparison.get("rank") or "\u2014"]
            for offset, expected in enumerate(values):
                column = 1 + per_mode * group + offset
                cell = fitz.Rect(edges[column][0] + 0.3, band_top + 0.2,
                                 edges[column][1] - 0.3, band_bottom - 0.2)
                found = page.raw.get_textbox(cell)
                checked += 1
                ok, note = cell_matches(str(expected), found, explained)
                if ok:
                    matched += 1
                    if note == "abbreviated":
                        abbreviated += 1
                else:
                    detail = found.strip()
                    if note:
                        detail = f"{detail!r} ({note})"
                    mismatches.append({"cut": cut, "column": f"{mode}[{offset}]",
                                       "expected": expected, "found": detail})
                for word in page.words:
                    if not (band_top <= word["y0"] <= band_bottom):
                        continue
                    centre = (word["x0"] + word["x1"]) / 2
                    if cell.x0 <= centre < cell.x1 and word["x1"] > cell.x1 + OVERLAP_TOLERANCE:
                        overflows.append({"cut": cut, "column": f"{mode}[{offset}]",
                                          "text": word["text"], "x1": round(word["x1"], 1),
                                          "cell_right": round(cell.x1, 1)})

    add(checks, f"{label} cells match the receipt", matched == checked,
        f"{matched}/{checked} cells match"
        + (f" ({abbreviated} as {UNAVAILABLE_SHORT!r} with the note present)" if abbreviated else ""))
    if abbreviated:
        finding(findings, "unavailable-abbreviated",
                f"{case_id} {label}: {abbreviated} cell(s) painted {UNAVAILABLE_SHORT!r} instead of "
                f"{UNAVAILABLE_FULL!r}; the abbreviation is explained on the table page",
                case=case_id, table=table_index, count=abbreviated)
    for mismatch in mismatches[:15]:
        finding(findings, "grouped-cell-mismatch",
                f"{case_id} {label} cut={mismatch['cut']!r} column={mismatch['column']}: "
                f"expected {mismatch['expected']!r}, PDF cell holds {mismatch['found']!r}",
                case=case_id, table=table_index)
    if len(mismatches) > 15:
        finding(findings, "grouped-cell-mismatch",
                f"{case_id} {label}: {len(mismatches) - 15} further cell mismatches suppressed",
                case=case_id, table=table_index)

    unique_overflows = {overflow["text"] + overflow["column"]: overflow for overflow in overflows}
    add(checks, f"{label} cells stay inside their column", not unique_overflows,
        "" if not unique_overflows else
        f"{len(unique_overflows)} values cross their column edge")
    for overflow in list(unique_overflows.values())[:10]:
        finding(findings, "grouped-cell-overflow",
                f"{case_id} {label} cut={overflow['cut']!r} column={overflow['column']}: "
                f"{overflow['text']!r} ends at x={overflow['x1']} past cell edge "
                f"{overflow['cell_right']}", case=case_id, table=table_index)
    return {"lastRow": run[-1], "checked": checked, "matched": matched,
            "dataRows": data_rows, "columns": columns, "modes": len(modes),
            "abbreviated": abbreviated}


def table_page_order(receipt: dict, pages: list[Page]) -> list[int]:
    """Page indices to try, most likely table page first.

    v2 can move the values tables onto a continuation block (`tablesOnSecondPage`), which the
    adapter forces onto its own page and names `<sectionKey>-values`. The receipt's page
    sections say which page that is, so prefer it; otherwise keep the v1 behaviour of looking
    at page 1 first and falling back to the remaining pages.
    """
    receipt_pages = receipt.get("pages") or []
    continuation = next((index for index, page in enumerate(receipt_pages)
                         if any(str(key).endswith("-values") for key in (page.get("sections") or []))),
                        None)
    order: list[int] = []
    if receipt.get("tablesOnSecondPage") and continuation is not None:
        order.append(continuation)
    order.append(0)
    if continuation is not None:
        order.append(continuation)
    order.extend(range(1, len(pages)))
    seen: list[int] = []
    for index in order:
        if 0 <= index < len(pages) and index not in seen:
            seen.append(index)
    return seen


def audit_tooltip_tables(pages: list[Page], receipt: dict, checks: list[dict],
                         findings: list[dict], case_id: str,
                         allowed_labels: set[str] | frozenset[str]) -> dict:
    tables = list(receipt.get("tooltipTables") or [])
    metrics = {"tables": len(tables), "cellsChecked": 0, "cellsMatched": 0, "grouped": 0,
               "abbreviated": 0, "tableDetails": [], "skipped": [], "page": None}
    if not tables:
        return metrics

    axis_labels = [GROUPED_AXIS_HEADERS[index] if index < len(GROUPED_AXIS_HEADERS)
                   and table.get("tableLayout") == GROUPED_LAYOUT else None
                   for index, table in enumerate(tables)]
    wanted = [label for label in axis_labels if label]
    chosen = None
    for index in table_page_order(receipt, pages):
        page = pages[index]
        if not wanted or any(find_axis_header(page, label, None) for label in wanted):
            chosen = index
            break
    if chosen is None:
        add(checks, "tooltip tables located", False,
            f"no page carries the {wanted or ['table']} axis header")
        return metrics
    page = pages[chosen]
    metrics["page"] = chosen + 1
    add(checks, "tooltip tables located", True,
        f"page {chosen + 1} of {len(pages)}"
        + (" (continuation page)" if chosen else ""))
    explained = unavailable_explained(page.text())
    document_explained = unavailable_explained("\n".join(item.text() for item in pages))
    metrics["explainedOnTablePage"] = explained
    if not explained and document_explained:
        finding(findings, "unavailable-note-elsewhere",
                f"{case_id}: the 'Indisp.' note is not on the table page but exists elsewhere "
                f"in the PDF", case=case_id)

    if receipt.get("tablesOnSecondPage"):
        add(checks, "tables leave the first page when tablesOnSecondPage is set",
            chosen > 0, f"tables on page {chosen + 1}")
        if chosen == 0:
            finding(findings, "tables-not-on-continuation-page",
                    f"{case_id}: tablesOnSecondPage is set but the tables stayed on page 1",
                    case=case_id)
        add(checks, "continuation export has more than one page", len(pages) > 1,
            f"{len(pages)} page(s)")
    elif chosen:
        finding(findings, "tables-on-later-page",
                f"{case_id}: tables are on page {chosen + 1} although tablesOnSecondPage is not "
                f"set (natural overflow, not a failure)", case=case_id)

    # The adapter appends its 'Indisp. : valeur indisponible.' note once per abbreviated
    # section, so more than one note on the table page means the explanation was duplicated.
    notes = unavailable_note_count(page.text())
    metrics["noteOnTablePage"] = notes
    add(checks, "the 'Indisp.' abbreviation is explained once", notes <= 1,
        f"{notes} note(s) on the table page")
    if notes > 1:
        finding(findings, "unavailable-note-repeated",
                f"{case_id}: the 'Indisp.' note appears {notes} times on the table page",
                case=case_id, count=notes)

    export_modes = receipt.get("exportModes")
    cursor: float | None = None
    for index, table in enumerate(tables):
        layout = table.get("tableLayout")
        if layout != GROUPED_LAYOUT:
            # appendTimeRampTables() uses a different column model (14/32/18/18/18 %) with an
            # axis column and one row per cut, so the grouped grid audit does not apply.
            metrics["skipped"].append({"table": index,
                                       "reason": f"layout={layout!r} (ramp table, no grouped grid)"})
            add(checks, f"table {index} exact grid", None,
                "ramp layout differs from the grouped column model, exact grid skipped")
            continue
        metrics["grouped"] += 1
        if isinstance(export_modes, list):
            selected = list(table.get("selectedModes") or [])
            add(checks, f"table {index} columns are the exported modes",
                sorted(selected) == sorted(export_modes),
                f"table {selected}, exportModes {export_modes}")
        detail = audit_grouped_table(page, table, axis_labels[index], checks, findings, case_id,
                                     index, cursor, allowed_labels, explained)
        if detail:
            metrics["cellsChecked"] += detail["checked"]
            metrics["cellsMatched"] += detail["matched"]
            metrics["abbreviated"] += detail["abbreviated"]
            metrics["tableDetails"].append({"table": index, "axis": axis_labels[index], **detail})
            cursor = detail["lastRow"]
    if metrics["grouped"] and notes and not metrics["abbreviated"]:
        finding(findings, "unavailable-note-unused",
                f"{case_id}: the table page explains {UNAVAILABLE_SHORT!r} but no audited cell "
                f"was abbreviated", case=case_id)
    return metrics


# --------------------------------------------------------------------------- v2 receipt checks


def audit_modes(receipt: dict, checks: list[dict], findings: list[dict], case_id: str) -> dict:
    """The export-time mode cap and the chooser evidence recorded with it (v2 receipts)."""
    export_modes = receipt.get("exportModes")
    screen_modes = receipt.get("screenModes")
    if not isinstance(export_modes, list) and not isinstance(screen_modes, list):
        return {}
    export_modes = export_modes if isinstance(export_modes, list) else []
    screen_modes = screen_modes if isinstance(screen_modes, list) else []
    metrics = {"exportModes": export_modes, "screenModes": screen_modes,
               "applicable": bool(export_modes),
               "capped": bool(export_modes) and len(export_modes) < len(screen_modes),
               "choiceEvidence": None}

    add(checks, "exported modes stay within the three-mode cap",
        len(export_modes) <= MAX_EXPORT_MODES,
        f"{len(export_modes)} exported: {export_modes}")
    add(checks, "exported modes are unique", len(set(export_modes)) == len(export_modes),
        f"{export_modes}")
    invented = [mode for mode in export_modes if mode not in screen_modes]
    add(checks, "exported modes come from the reader's selection", not invented,
        f"not on screen: {invented}" if invented else f"subset of {screen_modes}")

    choice_required = bool(export_modes) and len(screen_modes) > MAX_EXPORT_MODES
    evidence = receipt.get("choiceEvidence")
    metrics["choiceEvidence"] = evidence
    if choice_required:
        if evidence is None:
            add(checks, "mode choice is evidenced", None,
                f"{len(screen_modes)} screen modes were narrowed to {len(export_modes)} "
                f"without choiceEvidence in the receipt")
            finding(findings, "choice-evidence-missing",
                    f"{case_id}: {len(screen_modes)} screen modes narrowed to "
                    f"{len(export_modes)} but the receipt carries no choiceEvidence",
                    case=case_id)
        elif not isinstance(evidence, dict):
            add(checks, "mode choice is evidenced", False,
                f"choiceEvidence is {evidence!r}")
        else:
            gating = {key: evidence.get(key) for key in
                      ("disabledWithZero", "disabledWithFour", "enabledWithThree")}
            add(checks, "mode chooser gating is proven", all(gating.values()),
                f"{gating}")
            if not all(gating.values()):
                finding(findings, "choice-gating-not-proven",
                        f"{case_id}: chooser gating evidence is {gating}", case=case_id)
    elif evidence:
        finding(findings, "choice-evidence-unexpected",
                f"{case_id}: choiceEvidence present although {len(screen_modes)} screen modes "
                f"needed no chooser", case=case_id)
    return metrics


def audit_compact_labels(receipt: dict, pages: list[Page], checks: list[dict],
                         findings: list[dict], case_id: str) -> tuple[dict, set[str]]:
    """Validate receipt compactLabels and return the labels a table header may show."""
    entries = receipt.get("compactLabels")
    if not isinstance(entries, list):
        return {}, set()
    allowed: set[str] = set()
    problems: list[str] = []
    compacted = 0
    for entry in entries:
        problem = compact_label_problem(entry)
        if problem:
            problems.append(problem)
            continue
        full, displayed = entry["full"], entry["displayed"]
        allowed.add(squash(full))
        allowed.add(squash(displayed))
        if displayed != full:
            compacted += 1
    add(checks, "compact labels are ellipsized truncations of their full label",
        not problems, "; ".join(problems[:5]) if problems else
        f"{len(entries)} entries, {compacted} truncated")
    for problem in problems[:10]:
        finding(findings, "compact-label-inconsistent",
                f"{case_id}: {problem}", case=case_id)

    metrics = {"entries": len(entries), "compacted": compacted,
               "pairs": [{"full": entry.get("full"), "displayed": entry.get("displayed")}
                         for entry in entries if isinstance(entry, dict)]}
    if compacted:
        document_text = squash("\n".join(page.text() for page in pages))
        full_identities = {squash(entry["full"]) for entry in entries
                           if isinstance(entry, dict) and isinstance(entry.get("full"), str)}
        missing = [full for full in full_identities if full not in document_text]
        add(checks, "full territory identity is retained outside the compacted table headers",
            not missing,
            "" if not missing else f"{len(missing)} full label(s) absent from the PDF text")
        if missing:
            finding(findings, "full-identity-missing",
                    f"{case_id}: compacted table header dropped the full identity from the PDF: "
                    f"{[label[:60] for label in missing[:3]]}", case=case_id)
    return metrics, allowed


# --------------------------------------------------------------------------- receipt checks


def audit_scale(receipt: dict, pages: list[Page], checks: list[dict], findings: list[dict],
                case_id: str) -> dict:
    scale = receipt.get("scale")
    desktop_width = receipt.get("desktopWidth")
    metrics = {"scale": scale, "desktopWidth": desktop_width, "scale_by_width": None,
               "downscale_ratio": None}
    if not isinstance(scale, (int, float)) or not isinstance(desktop_width, (int, float)):
        add(checks, "receipt carries scale/desktopWidth", False,
            f"scale={scale!r} desktopWidth={desktop_width!r}")
        return metrics
    if not desktop_width:
        add(checks, "receipt desktopWidth is usable", False, "desktopWidth is 0")
        return metrics
    width_scale = (pages[0].width - 2 * PAGE_MARGIN_LEFT) / desktop_width
    metrics["scale_by_width"] = round(width_scale, 6)
    ratio = scale / width_scale if width_scale else 0.0
    metrics["downscale_ratio"] = round(ratio, 6)
    add(checks, "receipt scale never exceeds the width fit", scale <= width_scale + 1e-6,
        f"scale={scale:.6f} width fit={width_scale:.6f}")

    sizes = receipt.get("sectionSizes") or []
    tallest = max((size.get("height", 0) for size in sizes), default=0)
    capacity = pages[0].height - PAGE_CONTENT_TOP - PAGE_MARGIN_BOTTOM
    metrics["tallestSectionHeight"] = tallest
    metrics["capacity"] = round(capacity, 2)
    if ratio < 0.9995:
        limiting = "tallest section" if tallest and abs(capacity / tallest - scale) < 1e-3 \
            else "unknown term"
        finding(findings, "whole-section-downscale",
                f"{case_id}: scale {scale:.4f} is {ratio * 100:.1f}% of the "
                f"{(pages[0].width - 2 * PAGE_MARGIN_LEFT):.0f} pt width fit "
                f"({width_scale:.4f}); limiting term: {limiting} "
                f"(tallest section {tallest:.0f} px vs {capacity:.1f} pt capacity)",
                case=case_id, ratio=metrics["downscale_ratio"])
    return metrics


def audit_receipt(receipt: dict, pages: list[Page], pdf_bytes: int, checks: list[dict],
                  min_bytes: int) -> dict:
    metrics = {"bytes": pdf_bytes, "bytesPerPage": round(pdf_bytes / max(1, len(pages)), 1)}
    add(checks, "PDF size above the floor", pdf_bytes >= min_bytes,
        f"{pdf_bytes} bytes (floor {min_bytes})")

    receipt_pages = receipt.get("pages") or []
    add(checks, "page count matches the receipt", len(receipt_pages) == len(pages),
        f"receipt {len(receipt_pages)} pages, PDF {len(pages)} pages")

    for index, (receipt_page, page) in enumerate(zip(receipt_pages, pages), start=1):
        occupied = receipt_page.get("occupiedHeight")
        capacity = receipt.get("pageContentHeight") or (page.height - PAGE_CONTENT_TOP
                                                        - PAGE_MARGIN_BOTTOM)
        if isinstance(occupied, (int, float)):
            add(checks, f"page {index} occupied height fits the content band",
                occupied <= capacity + 0.001, f"{occupied:.2f} / {capacity:.2f} pt")
        centering = receipt_page.get("centeringInset")
        if isinstance(centering, (int, float)):
            expected = max(0.0, (capacity - (occupied or 0)) / 2)
            add(checks, f"page {index} centering inset matches its occupancy",
                abs(centering - expected) <= 0.51, f"{centering:.2f} vs {expected:.2f} pt")

    images = sum(len(page.raw.get_image_info()) for page in pages)
    if "images" in receipt:
        add(checks, "raster image count matches the receipt", images == receipt["images"],
            f"PDF {images}, receipt {receipt['images']}")

    annotations = sum(len(page.raw.get_links()) for page in pages)
    expected_links = receipt.get("links")
    if isinstance(expected_links, int):
        # The footer invitation link is added with a raw pdf.link() call, outside the anchor
        # walk that counts receipt.links, so exactly one extra annotation per page is expected.
        add(checks, "link annotations match receipt links plus footer invitations",
            annotations == expected_links + len(pages),
            f"PDF {annotations}, receipt {expected_links} + {len(pages)} pages")

    text_runs = receipt.get("textRuns")
    if isinstance(text_runs, int):
        characters = sum(len(page.text()) for page in pages)
        add(checks, "receipt counted text runs", text_runs > 0 or characters == 0,
            f"receipt textRuns={text_runs}, extracted characters={characters}")
        if text_runs > 0 and characters < 40:
            add(checks, "PDF keeps selectable text", False,
                f"{text_runs} painted runs but only {characters} extractable characters")
    return metrics


def check_section_identity(receipt: dict, pages: list[Page], checks: list[dict],
                           findings: list[dict], case_id: str, section_key: str | None) -> None:
    add(checks, "receipt sectionKey matches the case", receipt.get("sectionKey") == section_key,
        f"receipt {receipt.get('sectionKey')!r}, case {section_key!r}")
    document_text = "\n".join(page.text() for page in pages)
    if section_key and section_key.startswith("aedar"):
        present = re.search(r"AEDAR\s*\d{4}", document_text) is not None \
            or "AEDAR" in document_text
        add(checks, "AEDAR evidence source retained in the section PDF", present,
            "no AEDAR source string in the extracted text")
        if not present:
            finding(findings, "source-string-missing",
                    f"{case_id}: section {section_key} PDF has no AEDAR source attribution",
                    case=case_id)


# --------------------------------------------------------------------------- per-case driver


def audit_case(case: dict, cases_dir: Path, out_dir: Path, min_bytes: int, dpi: int,
               png: bool) -> dict:
    case_id = str(case.get("id"))
    section_key = case.get("sectionKey")
    expected_error = case.get("error")
    pdf_path = Path(case.get("pdfFile") or f"{case_id}.pdf")
    receipt_path = Path(case.get("receiptFile") or f"{case_id}-receipt.json")
    if not pdf_path.is_absolute():
        pdf_path = cases_dir / pdf_path
    if not receipt_path.is_absolute():
        receipt_path = cases_dir / receipt_path

    result = {"id": case_id, "synthetic": bool(case.get("synthetic")),
              "sectionKey": section_key, "expectedError": expected_error,
              "pdf": str(pdf_path), "receipt": str(receipt_path),
              "status": "pass", "checks": [], "findings": [], "metrics": {},
              "png": None}
    checks, findings = result["checks"], result["findings"]

    if expected_error:
        present = pdf_path.exists()
        add(checks, "failed export left no PDF behind", not present,
            f"expected error {expected_error!r}, PDF exists: {present}")
        result["status"] = "pass" if not present else "fail"
        # A PDF may still exist from an earlier successful run in the same directory; that is
        # reported, not treated as a new failure mode.
        return result

    if not pdf_path.exists():
        add(checks, "PDF artifact exists", False, f"missing {pdf_path}")
        result["status"] = "fail"
        return result
    if not receipt_path.exists():
        add(checks, "receipt exists", False, f"missing {receipt_path}")
        result["status"] = "fail"
        return result

    try:
        receipt = json.loads(receipt_path.read_text(encoding="utf8"))
    except json.JSONDecodeError as error:
        add(checks, "receipt is valid JSON", False, str(error))
        result["status"] = "fail"
        return result

    try:
        document = fitz.open(pdf_path)
    except Exception as error:  # noqa: BLE001 - audit tool, any open failure is a finding
        add(checks, "PDF opens", False, f"{type(error).__name__}: {error}")
        result["status"] = "fail"
        return result

    try:
        if document.needs_pass:
            add(checks, "PDF opens", False, "document is encrypted")
            result["status"] = "fail"
            return result
        pages = [Page(page) for page in document]
        result["metrics"]["pageCount"] = len(pages)

        for page in pages:
            check_page_box(page, checks)
            check_text_bounds(page, checks, findings)
        for index, page in enumerate(pages):
            receipt_page = (receipt.get("pages") or [])[index] \
                if index < len(receipt.get("pages") or []) else {}
            characters = check_selectable_text(page, receipt_page, findings)
            page_metrics = result["metrics"].setdefault("pageMetrics", [])
            page_metrics.append({
                "page": index + 1, "characters": characters, "words": len(page.words),
                "images": len(page.raw.get_image_info()),
                "links": len(page.raw.get_links()),
                "showsComparisonContext": receipt_page.get("showsComparisonContext"),
                "sections": receipt_page.get("sections"),
            })
            check_comparison_footer(page, receipt_page, checks, findings)
            check_page_number(page, checks)
            check_links(page, receipt, checks, findings)
            check_overlaps(page, checks, findings)

        result["metrics"]["scale"] = audit_scale(receipt, pages, checks, findings, case_id)
        result["metrics"].update(audit_receipt(receipt, pages, pdf_path.stat().st_size, checks,
                                               min_bytes))
        check_section_identity(receipt, pages, checks, findings, case_id, section_key)
        modes = audit_modes(receipt, checks, findings, case_id)
        if modes:
            result["metrics"]["modes"] = modes
        label_metrics, allowed_labels = audit_compact_labels(receipt, pages, checks, findings,
                                                             case_id)
        if label_metrics:
            result["metrics"]["compactLabels"] = label_metrics
        result["metrics"].update(audit_tooltip_tables(pages, receipt, checks, findings,
                                                      case_id, allowed_labels))

        if png and pages:
            png_path = out_dir / f"{case_id}.png"
            pages[0].raw.get_pixmap(dpi=dpi).save(str(png_path))
            result["png"] = str(png_path)
            size = png_path.stat().st_size
            add(checks, "first page renders to PNG", size > 2000, f"{size} bytes at {dpi} dpi")
    finally:
        document.close()

    failures = [check for check in checks if check["status"] == "fail"]
    result["status"] = "fail" if failures else "pass"
    return result


# --------------------------------------------------------------------------- reporting


LIMITATIONS = [
    "Scale provenance: the audit only sees receipt numbers and the PDF. It cannot tell which "
    "DOM state produced them, so 'whole-section downscale' is reported as a finding with the "
    "limiting term named, never as a prototype defect on its own.",
    "Footer boundary: the brief's y>790 threshold sits inside the adapter's own content band "
    "(body may legitimately reach H-46 = 795.89). Body/footer overlap is therefore judged "
    "against H-46, and a body word is only called footer overlap when its box actually meets "
    "a footer glyph box.",
    "Exact table grid is limited to appendSandboxTables() tables (tableLayout "
    "'grouped-modes'): axis label plus three columns per mode. appendTimeRampTables() exports "
    "use a different column model (14/32/18/18/18 %) and are deliberately skipped for cell "
    "comparison; they are still covered by the generic collision scan.",
    "Grouped axis labels are inferred by position (Temps, then Statistique) because the receipt "
    "omits axisLabel; a receipt written by a different adapter revision could pair the wrong "
    "table with the wrong header.",
    "Word collision detection is geometric (word boxes on one baseline overlapping by more than "
    "0.75 pt). It cannot see clipping, low-contrast overlap, or overlap inside a rasterised "
    "figure, and intentional overlaps (if any exist) would be reported as findings.",
    "Link counting assumes the adapter's invariant annotations == receipt.links + page count, "
    "i.e. exactly one raw footer invitation link per page. A different footer implementation "
    "must update this check.",
    "Text outside the media/side margins is measured from PyMuPDF word boxes, which include "
    "font side bearings; sub-point excursions are inside tolerance and not reported.",
    "Bytes-per-page floors are heuristics: they catch truncated or near-empty exports, not "
    "visual quality. A legitimately sparse scalar page can sit near the floor.",
    "Synthetic cases are designed to push layout bounds. Their failures show where the "
    "prototype stops being safe, not necessarily a regression on served content.",
    "Rendering is first-page-only at the requested dpi; later pages are audited by geometry and "
    "text, not by image.",
    "v2 compact labels: the accepted header strings are exactly the receipt's {full, displayed} "
    "pairs. The audit cannot re-measure the chooser's two-line width fit, so a label that fits "
    "in two lines but reads badly is only caught by the geometric bleed/overflow checks.",
    "v2 'Indisp.': only the literal value 'Indisponible' may be read back as 'Indisp.', and only "
    "while the page carries the note 'Indisp. : valeur indisponible.'. Numeric cells still need "
    "an exact value match, so a number abbreviated for width stays a failure.",
    "v2 two-page continuation: the table page is chosen from the receipt's page sections "
    "('<sectionKey>-values') and the axis header. A forced break that lands the tables on a page "
    "other than the one the receipt claims is reported as a finding, except when "
    "tablesOnSecondPage is set and the tables stayed on page 1, which is a failure.",
    "v2 choiceEvidence is captured by the stress harness, not by the adapter. A missing evidence "
    "object is reported as a finding (cannot verify the chooser), while evidence showing the "
    "confirm button enabled at zero or four modes is a failure.",
]


def summarize(results: list[dict]) -> dict:
    totals = {"cases": len(results), "pass": 0, "fail": 0, "expectedErrors": 0,
              "synthetic": 0, "failures": 0, "findings": 0}
    by_code: dict[str, int] = {}
    for result in results:
        totals["expectedErrors" if result["expectedError"] else result["status"]] += 1
        totals["synthetic"] += int(result["synthetic"])
        failures = [check for check in result["checks"] if check["status"] == "fail"]
        totals["failures"] += len(failures)
        totals["findings"] += len(result["findings"])
        for item in result["findings"]:
            by_code[item["code"]] = by_code.get(item["code"], 0) + 1
    totals["findingsByCode"] = dict(sorted(by_code.items(), key=lambda item: -item[1]))
    return totals


def write_markdown(report: dict, path: Path) -> None:
    totals = report["totals"]
    lines = [
        "# Desktop PDF prototype — stress audit",
        "",
        f"- Generated: {report['generatedAt']}",
        f"- Cases: `{report['casesPath']}`",
        f"- Artifacts: `{report['outDir']}`",
        f"- PyMuPDF {report['engine']['pymupdf']} / MuPDF {report['engine']['mupdf']}",
        f"- Result: **{totals['pass']} pass / {totals['fail']} fail** "
        f"({totals['expectedErrors']} expected-error cases, {totals['synthetic']} synthetic)",
        f"- {totals['failures']} failed checks, {totals['findings']} findings",
        "",
        "## Cases",
        "",
        "| id | synthetic | section | status | pages | scale | width fit | downscale | failures | findings |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for result in report["cases"]:
        metrics = result["metrics"]
        scale = metrics.get("scale") or {}
        failures = sum(1 for check in result["checks"] if check["status"] == "fail")
        status = "expected error" if result["expectedError"] else result["status"]
        scale_text = f"{scale['scale']:.4f}" \
            if isinstance(scale.get("scale"), (int, float)) else "—"
        width_text = f"{scale['scale_by_width']:.4f}" \
            if isinstance(scale.get("scale_by_width"), (int, float)) else "—"
        ratio = scale.get("downscale_ratio")
        downscale_text = f"{ratio * 100:.0f}%" if isinstance(ratio, (int, float)) else "—"
        lines.append(f"| `{result['id']}` | {'yes' if result['synthetic'] else 'no'} "
                     f"| {result['sectionKey'] or 'whole document'} | {status} "
                     f"| {metrics.get('pageCount', '—')} | {scale_text} | {width_text} "
                     f"| {downscale_text} | {failures} | {len(result['findings'])} |")

    if totals["findingsByCode"]:
        lines += ["", "## Findings by code", "",
                  "| code | count |", "|---|---|"]
        for code, count in totals["findingsByCode"].items():
            lines.append(f"| `{code}` | {count} |")

    v2_cases = [result for result in report["cases"]
                if result["metrics"].get("modes") or result["metrics"].get("compactLabels")]
    if v2_cases:
        lines += ["", "## v2 export choices", "",
                  "| id | screen modes | exported modes | capped | chooser evidence "
                  "| compact labels | tables page | abbreviated cells |",
                  "|---|---|---|---|---|---|---|---|"]
        for result in v2_cases:
            metrics = result["metrics"]
            modes = metrics.get("modes") or {}
            labels = metrics.get("compactLabels") or {}
            evidence = modes.get("choiceEvidence")
            need_evidence = bool(modes.get("applicable")) and \
                len(modes.get("screenModes") or []) > MAX_EXPORT_MODES
            if isinstance(evidence, dict):
                evidence_text = " / ".join(
                    f"{key}={'ok' if value else 'NO'}" for key, value in evidence.items())
            elif evidence is None:
                evidence_text = "MISSING" if need_evidence else "not needed"
            else:
                evidence_text = str(evidence)
            labels_text = f"{labels.get('compacted', 0)}/{labels.get('entries', 0)} truncated" \
                if labels else "—"
            if not modes.get("applicable"):
                capped_text = "—"
            else:
                capped_text = "yes" if modes.get("capped") else "no"
            lines.append(
                f"| `{result['id']}` | {len(modes.get('screenModes') or [])} "
                f"| {len(modes.get('exportModes') or [])} "
                f"| {capped_text} | {evidence_text} "
                f"| {labels_text} | {metrics.get('page') or '—'} "
                f"| {metrics.get('abbreviated', 0)} |")

    produced = [result for result in report["cases"] if result["png"]]
    if produced:
        lines += ["", "## First pages", "", "| case | PNG |", "|---|---|"]
        for result in produced:
            lines.append(f"| `{result['id']}` | `{Path(result['png']).name}` |")

    lines += ["", "## Per-case detail", ""]
    for result in report["cases"]:
        if result["expectedError"]:
            lines += [f"### `{result['id']}` — expected error", "",
                      f"`{result['expectedError']}`", ""]
            continue
        failures = [check for check in result["checks"] if check["status"] == "fail"]
        skips = [check for check in result["checks"] if check["status"] == "skip"]
        lines += [f"### `{result['id']}` — {result['status'].upper()}", ""]
        metrics = result["metrics"]
        if "pageMetrics" in metrics:
            lines += ["| page | chars | words | images | links | comparison footer | sections |",
                      "|---|---|---|---|---|---|---|"]
            for page in metrics["pageMetrics"]:
                context = page["showsComparisonContext"]
                lines.append(f"| {page['page']} | {page['characters']} | {page['words']} "
                             f"| {page['images']} | {page['links']} "
                             f"| {'—' if context is None else ('yes' if context else 'no')} "
                             f"| {', '.join(page['sections'] or []) or '—'} |")
            lines.append("")
        modes = metrics.get("modes") or {}
        if modes:
            lines.append(f"- Modes: {len(modes.get('screenModes') or [])} on screen → "
                         f"{len(modes.get('exportModes') or [])} exported "
                         f"({', '.join(modes.get('exportModes') or []) or 'none'})")
        labels = metrics.get("compactLabels") or {}
        if labels:
            lines.append(f"- Compact labels: {labels.get('compacted', 0)} of "
                         f"{labels.get('entries', 0)} table headers truncated")
            for pair in (labels.get("pairs") or [])[:4]:
                if pair.get("full") != pair.get("displayed"):
                    lines.append(f"  - `{pair.get('full')}` → `{pair.get('displayed')}`")
        if metrics.get("page") and metrics.get("tables"):
            lines.append(f"- Tooltip tables: page {metrics['page']}, "
                         f"{metrics.get('cellsMatched', 0)}/{metrics.get('cellsChecked', 0)} "
                         f"cells matched, {metrics.get('abbreviated', 0)} abbreviated")
        if modes or labels or metrics.get("tables"):
            lines.append("")
        if failures:
            lines += ["**Failed checks**", ""]
            lines += [f"- `{check['name']}` — {check['detail'] or 'no detail'}"
                      for check in failures]
            lines.append("")
        if result["findings"]:
            lines += ["**Findings**", ""]
            lines += [f"- `{item['code']}` — {item['detail']}"
                      for item in result["findings"][:25]]
            if len(result["findings"]) > 25:
                lines.append(f"- … {len(result['findings']) - 25} further findings "
                             f"(see report.json)")
            lines.append("")
        if skips:
            lines += ["**Skipped**", ""]
            lines += [f"- `{check['name']}` — {check['detail']}" for check in skips]
            lines.append("")

    lines += ["## Explicit limitations", ""]
    lines += [f"{index}. {limitation}" for index, limitation in enumerate(LIMITATIONS, start=1)]
    lines += ["", "## Re-run", "", "```", f"python {report['command']}", "```", ""]
    path.write_text("\n".join(lines), encoding="utf8")


def relative(path: Path) -> str:
    try:
        return path.resolve().relative_to(Path.cwd().resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("cases", nargs="?", default=str(DEFAULT_CASES),
                        help=f"cases.json written by the stress harness (default {DEFAULT_CASES})")
    parser.add_argument("--out", help="output directory for report.json/REPORT.md/PNGs "
                                      "(default: the cases directory)")
    parser.add_argument("--min-bytes", type=int, default=DEFAULT_MIN_BYTES,
                        help="minimum acceptable PDF size in bytes")
    parser.add_argument("--dpi", type=int, default=DEFAULT_PNG_DPI,
                        help="resolution of the first-page PNG renders")
    parser.add_argument("--only", action="append", default=[],
                        help="audit only these case ids (repeatable)")
    parser.add_argument("--skip-png", action="store_true", help="do not render first pages")
    args = parser.parse_args(argv)

    cases_path = Path(args.cases)
    if not cases_path.exists():
        print(f"No stress cases at {cases_path}.\n"
              f"Generate them first, then run:\n"
              f"  python {relative(Path(__file__))} {relative(cases_path)}",
              file=sys.stderr)
        return 2
    cases = json.loads(cases_path.read_text(encoding="utf8"))
    if not isinstance(cases, list):
        print(f"{cases_path} must hold a JSON array of cases", file=sys.stderr)
        return 2
    if args.only:
        wanted = set(args.only)
        cases = [case for case in cases if str(case.get("id")) in wanted]

    out_dir = Path(args.out) if args.out else cases_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for case in cases:
        result = audit_case(case, cases_path.parent, out_dir, args.min_bytes, args.dpi,
                            not args.skip_png)
        failures = [check for check in result["checks"] if check["status"] == "fail"]
        pages = result["metrics"].get("pageCount", 0)
        head = f"{result['status'].upper():4} {result['id']}"
        if not result["expectedError"]:
            head += f"  pages={pages}"
        if failures:
            head += f"  failures={len(failures)}"
        if result["findings"]:
            head += f"  findings={len(result['findings'])}"
        print(head)
        for check in failures:
            print(f"     FAIL {check['name']}: {check['detail']}")
        results.append(result)

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "casesPath": str(cases_path),
        "outDir": str(out_dir),
        "command": f"{relative(Path(__file__))} {relative(cases_path)}",
        "engine": {"pymupdf": (fitz.__doc__ or "unknown").split(":")[0].strip(),
                   "mupdf": getattr(fitz, "mupdf_version", "unknown")},
        "limits": {"minBytes": args.min_bytes, "pngDpi": args.dpi,
                   "footerBandTop": FOOTER_BAND_TOP, "contentBottom": A4_HEIGHT - PAGE_MARGIN_BOTTOM,
                   "overlapTolerance": OVERLAP_TOLERANCE},
        "totals": summarize(results),
        "cases": results,
        "limitations": LIMITATIONS,
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False),
                                        encoding="utf8")
    write_markdown(report, out_dir / "REPORT.md")
    totals = report["totals"]
    print(f"\n{totals['pass']} pass / {totals['fail']} fail / "
          f"{totals['expectedErrors']} expected errors — "
          f"{totals['failures']} failed checks, {totals['findings']} findings")
    print(f"Report: {out_dir / 'REPORT.md'}")
    return 0 if totals["fail"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
