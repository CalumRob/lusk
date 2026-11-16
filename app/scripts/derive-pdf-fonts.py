#!/usr/bin/env python3
"""Derive the PDF faces embedded by the shared Cahier composer.

The app already self-hosts its faces through ``@fontsource-variable``. jsPDF
needs static TrueType faces, so this build-time script reads the installed
Fontsource WOFF2 files, instantiates the weights the document actually uses and
writes TTF files under ``src/assets/fonts/pdf``.

This is a build/provenance tool, never a reader dependency: the derived assets
and their manifest are committed, and the browser only fetches them when a PDF
is requested.

Requires ``fonttools`` and ``brotli`` locally (the repository's prototype tooling
already used the same pair). It invents no font: every face maps to the family,
weight and style shipped by the package. The license text is copied verbatim.

Run from ``app/``:  python scripts/derive-pdf-fonts.py
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
PACKAGES = ROOT / "node_modules" / "@fontsource-variable"
DESTINATION = ROOT / "src" / "assets" / "fonts" / "pdf"

# family, package, source style, weight, PDF id. Only faces the document uses.
FACES = [
    ("Mozilla Headline", "mozilla-headline", "normal", 400, "mozilla-headline-400"),
    ("Mozilla Headline", "mozilla-headline", "normal", 600, "mozilla-headline-600"),
    ("Mozilla Text", "mozilla-text", "normal", 400, "mozilla-text-400"),
    ("Mozilla Text", "mozilla-text", "normal", 500, "mozilla-text-500"),
    ("Mozilla Text", "mozilla-text", "normal", 600, "mozilla-text-600"),
    ("Fira Code", "fira-code", "normal", 400, "fira-code-400"),
    ("Fira Code", "fira-code", "normal", 500, "fira-code-500"),
    ("Fira Code", "fira-code", "normal", 600, "fira-code-600"),
    ("Fira Code", "fira-code", "normal", 700, "fira-code-700"),
    ("Newsreader", "newsreader", "italic", 600, "newsreader-600-italic"),
]

# The document is French; the Fontsource `latin` subset covers Latin-1, the
# French ligatures (œ/Œ), curly quotes, dashes, ellipsis, guillemets and €.
SUBSET = "latin"


def regular_source(package: str, style: str) -> Path:
    name = f"{package}-{SUBSET}-wght-{style}.woff2"
    path = PACKAGES / package / "files" / name
    if not path.is_file():
        raise SystemExit(f"Missing Fontsource face: {path}")
    return path


def main() -> None:
    DESTINATION.mkdir(parents=True, exist_ok=True)
    manifest = []
    for family, package, style, weight, key in FACES:
        source = regular_source(package, style)
        font = TTFont(source)
        if "fvar" in font:
            axes = {}
            for axis in font["fvar"].axes:
                axes[axis.axisTag] = (
                    max(axis.minValue, min(axis.maxValue, weight))
                    if axis.axisTag == "wght"
                    else axis.defaultValue
                )
            font = instantiateVariableFont(font, axes, inplace=True)
        if style == "italic" and "Italic" not in font["name"].getDebugName(4):
            # No synthetic oblique: the chosen source is a real italic face.
            raise SystemExit(f"{source} is not an italic face")
        font.flavor = None
        target = DESTINATION / f"{key}.ttf"
        font.save(target)
        payload = target.read_bytes()
        # Verify the actual glyph coverage of the French document copy rather
        # than assuming the subset: refuse a face that lacks a used character.
        cmap = set()
        for table in font["cmap"].tables:
            cmap.update(table.cmap.keys())
        required = {
            0x20, 0x27, 0x28, 0x29, 0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x31,
            0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x3B,
            0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
            0x4B, 0x4C, 0x4D, 0x4E, 0x4F, 0x50, 0x51, 0x52, 0x53, 0x54,
            0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x61, 0x62, 0x63, 0x64,
            0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E,
            0x6F, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78,
            0x79, 0x7A, 0xAB, 0xBB, 0xC0, 0xC7, 0xC8, 0xC9, 0xCA, 0xCE,
            0xCF, 0xD4, 0xD9, 0xDB, 0xE0, 0xE2, 0xE7, 0xE8, 0xE9, 0xEA,
            0xEB, 0xEE, 0xEF, 0xF4, 0xF9, 0xFB, 0xFC, 0x152, 0x153,
            0x2013, 0x2014, 0x2019, 0x201C, 0x201D, 0x2026, 0x20AC,
        }
        missing = sorted(required - cmap)
        if missing:
            raise SystemExit(
                f"{key} lacks required glyphs: {[hex(c) for c in missing]}"
            )
        license_path = PACKAGES / package / "LICENSE"
        manifest.append(
            {
                "id": key,
                "family": family,
                "weight": weight,
                "style": style,
                "file": f"{key}.ttf",
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "source": source.relative_to(ROOT).as_posix(),
                "sourcePackage": f"@fontsource-variable/{package}",
                "license": license_path.name,
                "licenseSpdx": "OFL-1.1",
            }
        )
        (DESTINATION / f"{key}-LICENSE.txt").write_text(
            license_path.read_text(encoding="utf8"), encoding="utf8"
        )

    (DESTINATION / "manifest.json").write_text(
        json.dumps({"subset": SUBSET, "faces": manifest}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf8",
    )
    (DESTINATION / "README.md").write_text(
        "# PDF font assets\n\n"
        "Generated by `python scripts/derive-pdf-fonts.py` from the app's own\n"
        "`@fontsource-variable` packages (OFL-1.1). Each TTF is a static instance of\n"
        "the family/weight/style the Cahier document embeds; `manifest.json` records\n"
        "the source file, byte size and SHA-256. The `*-LICENSE.txt` files are copies\n"
        "of the upstream package licences. Do not hand-edit the binaries.\n",
        encoding="utf8",
    )
    print(f"Derived {len(manifest)} PDF faces in {DESTINATION.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
