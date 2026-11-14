"""THROWAWAY: derive static PDF TTF faces from the site's installed WOFF2 fonts.

No font-family map or second font download. Needs fonttools + brotli locally.
"""
import json
import re
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen

inventory = json.loads(Path(sys.argv[1]).read_text(encoding="utf8"))
destination = Path("public/prototype-pdf-fonts")
destination.mkdir(parents=True, exist_ok=True)
sources = {}
for package in Path("node_modules/@fontsource-variable").iterdir():
    if not package.is_dir():
        continue
    for css_path in package.glob("*.css"):
        for block in re.findall(r"@font-face\s*\{([^}]+)\}", css_path.read_text(encoding="utf8")):
            family = re.search(r"font-family:\s*['\"]([^'\"]+)", block)
            style = re.search(r"font-style:\s*(\w+)", block)
            url = re.search(r"url\(([^)]+)\)", block)
            if family and style and url and "-latin-" in url[1] and "-wght-" in url[1]:
                sources[(family[1], style[1])] = package / url[1]

manifest = []
for spec in inventory["fonts"]:
    source = sources.get((spec["family"], spec["style"])) or sources.get((spec["family"], "normal"))
    if not source:
        raise RuntimeError(f"No site font source for {spec}")
    font = TTFont(source)
    if "fvar" in font:
        axes = {axis.axisTag: max(axis.minValue, min(axis.maxValue, spec["weight"])) if axis.axisTag == "wght" else axis.defaultValue for axis in font["fvar"].axes}
        font = instantiateVariableFont(font, axes, inplace=True)
    if spec["style"] == "italic" and "-italic" not in source.name:
        # Match the browser's synthetic oblique when the site has no italic face.
        glyphs = font.getGlyphSet()
        transformed = {}
        for name in font.getGlyphOrder():
            pen = TTGlyphPen(glyphs)
            glyphs[name].draw(TransformPen(pen, (1, 0, .212556, 1, 0, 0)))
            transformed[name] = pen.glyph()
        for name, glyph in transformed.items():
            font["glyf"][name] = glyph
        font["post"].italicAngle = -12
    font.flavor = None
    key = re.sub(r"[^a-zA-Z0-9]+", "-", f"{spec['family']}-{spec['weight']}-{spec['style']}")
    font.save(destination / f"{key}.ttf")
    manifest.append({**spec, "key": key, "url": f"/prototype-pdf-fonts/{key}.ttf"})
(destination / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")
print(f"Derived {len(manifest)} PDF faces from the installed site fonts.")
