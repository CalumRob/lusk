"""The approved engraved inspection-plate compositor.

The glyph masks, ink relief, title clearances, network ordering, furniture and
footer below are direct ports of the validated prototype implementations.
Network selection and map-ground construction remain outside this module.
"""
from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from functools import lru_cache

import numpy as np
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from qgis.PyQt.QtCore import QByteArray, QPointF, QRect, QRectF, Qt
from qgis.PyQt.QtGui import (
    QColor,
    QFont,
    QFontDatabase,
    QFontInfo,
    QFontMetricsF,
    QImage,
    QPainter,
    QPainterPath,
    QPen,
    QTransform,
)
from qgis.PyQt.QtSvg import QSvgRenderer

from map_ground import geometry_mask


OUTPUT_SIZE = 2400
_DESIGN_REFERENCE_SIZE = 3200
_pixel = lambda value: round(value * OUTPUT_SIZE / _DESIGN_REFERENCE_SIZE)
INK_COLOUR = QColor("#273A37")
PRIMARY_GREEN = QColor("#57726F")
SUBTITLE_GREEN = PRIMARY_GREEN
MAP_FURNITURE_GREEN = QColor("#4B746E")
TITLE_SIZE = _pixel(166)
TITLE_WEIGHT = 600
TITLE_TRACKING_EM = -0.01
TITLE_TOP = _pixel(120)
TITLE_LEFT_MARGIN = _pixel(100)
TITLE_WORDMARK_GAP = _pixel(72)
TITLE_MAX_WIDTH = _pixel(2400)
TITLE_BACKING_PADDING_X = _pixel(18)
TITLE_BACKING_PADDING_Y = _pixel(12)
SUBTITLE_SIZE = _pixel(100)
SUBTITLE_WEIGHT = 700
SUBTITLE_TOP = _pixel(352)
WORDMARK_TEXT = "lusk"
WORDMARK_TRACKING_EM = -0.01
WORDMARK_WEIGHT = 600
WORDMARK_WIDTH = _pixel(250)
WORDMARK_RIGHT_MARGIN = _pixel(100)
WORDMARK_TOP = _pixel(100)
WORDMARK_SHEAR = -0.25
WORDMARK_OPACITY = 0.30
TITLE_OPACITY = 0.55
TEXT_BAND_PADDING_X = _pixel(34)
TEXT_BAND_PADDING_Y = _pixel(22)
TEXTURE_OPACITY = 0.50
ENGRAVED_TITLE = "deep-ink"
FOOTER_HEIGHT = _pixel(128)
FOOTER_INSET_X = _pixel(72)
FOOTER_SIZE = _pixel(38)
SOURCE_SIZE = _pixel(30)
SOURCE_METHOD_GAP = _pixel(96)
NORTH_ARROW_SVG_NAME = "NorthArrow_11.svg"
NORTH_ARROW_HEIGHT = _pixel(92)
NORTH_ARROW_RIGHT_INSET = _pixel(96)
FURNITURE_GAP = _pixel(32)
FURNITURE_SAFE_PADDING_X = _pixel(26)
FURNITURE_SAFE_PADDING_Y = _pixel(20)


@dataclass(frozen=True)
class Engraving:
    slug: str
    label: str
    body_depth: float
    highlight_strength: float
    shadow_strength: float
    edge_offset: int


@dataclass(frozen=True)
class PreparedTitle:
    runs: tuple[tuple[QPainterPath, QColor, float, bool], ...]
    backings: tuple[QRect, ...]
    subtitle_path: QPainterPath
    subtitle_mask: np.ndarray
    wordmark_path: QPainterPath


TITLE_RELIEF = Engraving("ink-deep", "Deeper cut · ink at 55%", 0.065, 0.100, 0.130, _pixel(3))
STATIC_FACE_CACHE: dict[tuple[str, int], str] = {}


def _pixels(image: QImage) -> np.ndarray:
    pointer = image.bits()
    pointer.setsize(image.sizeInBytes())
    return np.frombuffer(pointer, dtype=np.uint8).reshape(
        image.height(), image.bytesPerLine() // 4, 4
    )[:, : image.width(), :]


def _set_static_names(font: TTFont, family: str, weight: int) -> None:
    style = {
        400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold",
        800: "ExtraBold", 900: "Black",
    }.get(weight, "Regular")
    names = {
        1: family, 2: style, 3: f"{family} {style} production",
        4: f"{family} {style}", 6: f"{family.replace(' ', '')}-{style}",
        16: family, 17: style,
    }
    table = font["name"]
    table.names = [record for record in table.names if record.nameID not in names]
    for platform, encoding, language in ((3, 1, 0x409), (1, 0, 0)):
        for name_id, value in names.items():
            table.setName(value, name_id, platform, encoding, language)
    font["OS/2"].usWeightClass = weight
    font["OS/2"].fsSelection &= ~((1 << 5) | (1 << 6))
    if weight >= 700:
        font["OS/2"].fsSelection |= 1 << 5
    elif weight == 400:
        font["OS/2"].fsSelection |= 1 << 6
    font["head"].macStyle = (font["head"].macStyle & ~1) | (1 if weight >= 700 else 0)


def _load_static_face(slug: str, weight: int, assets: Path, temporary: Path) -> str:
    cache_key = (slug, weight)
    if cache_key in STATIC_FACE_CACHE:
        return STATIC_FACE_CACHE[cache_key]
    font_path = assets / "fonts" / f"{slug}-latin-wght-normal.woff2"
    if not font_path.is_file():
        raise RuntimeError(f"Missing required production font: {font_path}")
    font = TTFont(str(font_path))
    if "fvar" in font:
        axes = {axis.axisTag: axis.defaultValue for axis in font["fvar"].axes}
        if "wght" in axes:
            axis = next(axis for axis in font["fvar"].axes if axis.axisTag == "wght")
            if not axis.minValue <= weight <= axis.maxValue:
                raise ValueError(f"{slug} does not support required weight {weight}")
            axes["wght"] = weight
        font = instantiateVariableFont(font, axes, inplace=False)
    font.flavor = None
    family = {
        "mozilla-headline": "Mozilla Headline",
        "mozilla-text": "Mozilla Text",
        "newsreader": "Newsreader",
    }[slug]
    _set_static_names(font, family, weight)
    output = temporary / f"{slug}-{weight}.ttf"
    font.save(str(output))
    font_id = QFontDatabase.addApplicationFont(str(output))
    families = QFontDatabase.applicationFontFamilies(font_id) if font_id >= 0 else []
    if not families:
        raise RuntimeError(f"Qt could not load required production font: {font_path}")
    STATIC_FACE_CACHE[cache_key] = families[0]
    return families[0]


def _font(family: str, size: int, weight: int = 400, tracking_em: float = 0) -> QFont:
    weights = {
        100: QFont.Thin, 200: QFont.ExtraLight, 300: QFont.Light,
        400: QFont.Normal, 500: QFont.Medium, 600: QFont.DemiBold,
        700: QFont.Bold, 800: QFont.ExtraBold, 900: QFont.Black,
    }
    if weight not in weights:
        raise ValueError(f"Unsupported CSS font weight: {weight}")
    result = QFont(family)
    result.setPixelSize(size)
    result.setWeight(weights[weight])
    result.setLetterSpacing(QFont.AbsoluteSpacing, tracking_em * size)
    if QFontInfo(result).family() != family:
        raise RuntimeError(f"Qt substituted {QFontInfo(result).family()} for {family}")
    return result


def _text_path(text: str, font: QFont) -> QPainterPath:
    path = QPainterPath()
    metrics = QFontMetricsF(font)
    path.addText(QPointF(0, metrics.ascent()), font, text)
    path.setFillRule(Qt.WindingFill)
    return path


def _glyph_coverage(path: QPainterPath) -> np.ndarray:
    mask = QImage(OUTPUT_SIZE, OUTPUT_SIZE, QImage.Format_RGBA8888)
    mask.fill(Qt.transparent)
    painter = QPainter(mask)
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.setPen(Qt.NoPen)
    painter.setBrush(QColor("white"))
    painter.drawPath(path)
    painter.end()
    return _pixels(mask)[:, :, 3].astype(np.float32) / 255.0


def _rectangles_coverage(rectangles: tuple[QRectF | QRect, ...]) -> np.ndarray:
    path = QPainterPath()
    for rectangle in rectangles:
        path.addRect(QRectF(rectangle))
    return _glyph_coverage(path)


def _shift(array: np.ndarray, dx: int, dy: int) -> np.ndarray:
    result = np.zeros_like(array)
    height, width = array.shape
    source_left, source_right = max(0, -dx), min(width, width - dx)
    source_top, source_bottom = max(0, -dy), min(height, height - dy)
    target_left, target_right = max(0, dx), min(width, width + dx)
    target_top, target_bottom = max(0, dy), min(height, height + dy)
    result[target_top:target_bottom, target_left:target_right] = array[
        source_top:source_bottom, source_left:source_right
    ]
    return result


@lru_cache(maxsize=4)
def _paper_texture_luminance(texture_path: str, mtime_ns: int) -> np.ndarray:
    texture = QImage(texture_path)
    if texture.isNull():
        raise RuntimeError(f"Could not load approved paper texture: {texture_path}")
    edge = min(texture.width(), texture.height())
    square = texture.copy(
        (texture.width() - edge) // 2, (texture.height() - edge) // 2, edge, edge
    ).scaled(OUTPUT_SIZE, OUTPUT_SIZE, Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
    gray = square.convertToFormat(QImage.Format_Grayscale8).convertToFormat(QImage.Format_RGBA8888)
    return _pixels(gray)[:, :, 0].astype(np.float32) / 255.0


def apply_engraved_ink(
    image: QImage,
    texture_luminance: np.ndarray,
    glyph_mask: np.ndarray,
    colour: QColor,
    fill_opacity: float,
    treatment: Engraving | None,
) -> QImage:
    """Prototype's texture-multiplied ink with carved, inset edge relief."""
    image = image.copy().convertToFormat(QImage.Format_RGBA8888)
    rgba = _pixels(image)
    rgb = rgba[:, :, :3].astype(np.float32)
    grain = 1.0 - TEXTURE_OPACITY * (1.0 - texture_luminance)
    pigment = np.array([colour.red(), colour.green(), colour.blue()], dtype=np.float32)
    coverage = glyph_mask * fill_opacity
    rgb = rgb * (1.0 - coverage[:, :, None]) + pigment[None, None, :] * grain[:, :, None] * coverage[:, :, None]
    if treatment is not None:
        offset = treatment.edge_offset
        light_edge = np.clip(glyph_mask - _shift(glyph_mask, -offset, -offset), 0, 1)
        dark_edge = np.clip(glyph_mask - _shift(glyph_mask, offset, offset), 0, 1)
        relief_grain = 0.78 + 0.44 * texture_luminance
        light = light_edge * treatment.highlight_strength * relief_grain
        shadow = dark_edge * treatment.shadow_strength * relief_grain
        rgb += (255.0 - rgb) * light[:, :, None]
        rgb *= 1.0 - shadow[:, :, None]
    rgba[:, :, :3] = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    return image


def _desaturate_masked_area(image: QImage, mask: np.ndarray, land_mask: np.ndarray) -> QImage:
    image = image.copy().convertToFormat(QImage.Format_RGBA8888)
    rgba = _pixels(image)
    rgb = rgba[:, :, :3].astype(np.float32)
    gray = np.sum(rgb * np.array([0.2126, 0.7152, 0.0722]), axis=2)
    coverage = (np.clip(mask, 0, 1) * np.clip(land_mask, 0, 1))[:, :, None]
    rgba[:, :, :3] = np.clip(np.rint(rgb * (1 - coverage) + gray[:, :, None] * coverage), 0, 255).astype(np.uint8)
    return image


def _draw_flat_glyphs(image: QImage, path: QPainterPath, colour: QColor, opacity: float) -> QImage:
    painter = QPainter(image)
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.setRenderHint(QPainter.TextAntialiasing, True)
    painter.setOpacity(opacity)
    painter.setPen(Qt.NoPen)
    painter.setBrush(colour)
    painter.drawPath(path)
    painter.end()
    return image


def _draw_paper_backings(image: QImage, rectangles: tuple[QRect, ...], texture_luminance: np.ndarray) -> np.ndarray:
    backing_mask = np.zeros((OUTPUT_SIZE, OUTPUT_SIZE), dtype=np.float32)
    if not rectangles:
        return backing_mask
    paper = QColor("#F8FBFB")
    painter = QPainter(image)
    painter.setPen(Qt.NoPen)
    painter.setBrush(paper)
    for rectangle in rectangles:
        painter.drawRect(rectangle)
    painter.end()
    rgba = _pixels(image)
    paper_rgb = np.array([paper.red(), paper.green(), paper.blue()], dtype=np.float32)
    for rectangle in rectangles:
        left, top = max(0, rectangle.left()), max(0, rectangle.top())
        right = min(OUTPUT_SIZE, rectangle.left() + rectangle.width())
        bottom = min(OUTPUT_SIZE, rectangle.top() + rectangle.height())
        if left >= right or top >= bottom:
            continue
        backing_mask[top:bottom, left:right] = 1.0
        grain = 1.0 - TEXTURE_OPACITY * (1.0 - texture_luminance[top:bottom, left:right])
        rgba[top:bottom, left:right, :3] = np.clip(
            np.rint(paper_rgb[None, None, :] * grain[:, :, None]), 0, 255
        ).astype(np.uint8)
        rgba[top:bottom, left:right, 3] = 255
    return backing_mask


def _keep_original_network_color_over_text(
    networks: QImage,
    glyph_mask: np.ndarray,
    outside_land_mask: np.ndarray,
    excluded_mask: np.ndarray,
) -> QImage:
    image = networks.copy().convertToFormat(QImage.Format_RGBA8888)
    rgba = _pixels(image)
    rgb = rgba[:, :, :3].astype(np.float32)
    line_alpha = rgba[:, :, 3].astype(np.float32) / 255.0
    line_alpha *= 1.0 - excluded_mask
    outside_coverage = outside_land_mask * (1.0 - glyph_mask)
    gray = np.sum(rgb * np.array([0.2126, 0.7152, 0.0722]), axis=2)
    rgb = rgb * (1.0 - outside_coverage[:, :, None]) + gray[:, :, None] * outside_coverage[:, :, None]
    rgba[:, :, :3] = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    rgba[:, :, 3] = np.clip(np.rint(line_alpha * 255), 0, 255).astype(np.uint8)
    return image


def _prepare_title(
    mode_runs: tuple[tuple[str, QColor, float, bool], ...],
    territory_label: str,
    assets: Path,
    temporary: Path,
) -> tuple[PreparedTitle, str, str]:
    title_family = _load_static_face("mozilla-headline", TITLE_WEIGHT, assets, temporary)
    headline_bold = _load_static_face("mozilla-headline", SUBTITLE_WEIGHT, assets, temporary)
    wordmark_family = _load_static_face("newsreader", WORDMARK_WEIGHT, assets, temporary)
    title_font = _font(title_family, TITLE_SIZE, TITLE_WEIGHT, TITLE_TRACKING_EM)
    metrics = QFontMetricsF(title_font)
    cursor_x = 0.0
    unpositioned = []
    for text, colour, opacity, solid in mode_runs:
        path = _text_path(text, title_font)
        path.translate(cursor_x, 0)
        unpositioned.append((path, colour, opacity, solid))
        cursor_x += metrics.horizontalAdvance(text)
    combined = QPainterPath()
    for path, _, _, _ in unpositioned:
        combined.addPath(path)
    title_x = TITLE_LEFT_MARGIN - combined.boundingRect().left()
    reference_text = mode_runs[0][0].strip().split()[0]
    title_y = TITLE_TOP - _text_path(reference_text, title_font).boundingRect().top()
    translated = QTransform.fromTranslate(title_x, title_y)
    title_bounds = translated.map(combined).boundingRect()
    max_width = OUTPUT_SIZE - WORDMARK_RIGHT_MARGIN - WORDMARK_WIDTH - TITLE_WORDMARK_GAP - TITLE_LEFT_MARGIN
    if title_bounds.width() > max_width:
        raise RuntimeError(f"Inspection title width {title_bounds.width():.0f}px exceeds {max_width}px")
    runs = tuple((translated.map(path), colour, opacity, solid) for path, colour, opacity, solid in unpositioned)
    backings = tuple(
        path.boundingRect().adjusted(-TITLE_BACKING_PADDING_X, -TITLE_BACKING_PADDING_Y,
                                     TITLE_BACKING_PADDING_X, TITLE_BACKING_PADDING_Y).toAlignedRect()
        for path, _, _, solid in runs if solid
    )

    subtitle = _text_path(territory_label, _font(headline_bold, SUBTITLE_SIZE, SUBTITLE_WEIGHT))
    bounds = subtitle.boundingRect()
    subtitle.translate(TITLE_LEFT_MARGIN - bounds.left(), SUBTITLE_TOP - bounds.top())
    wordmark = _text_path(WORDMARK_TEXT, _font(wordmark_family, _pixel(100), WORDMARK_WEIGHT, WORDMARK_TRACKING_EM))
    wordmark = QTransform().shear(WORDMARK_SHEAR, 0).map(wordmark)
    wordmark_bounds = wordmark.boundingRect()
    if wordmark_bounds.width() <= 0:
        raise RuntimeError("Newsreader produced empty wordmark glyphs")
    wordmark.translate(-wordmark_bounds.left(), -wordmark_bounds.top())
    wordmark = QTransform.fromScale(WORDMARK_WIDTH / wordmark_bounds.width(), WORDMARK_WIDTH / wordmark_bounds.width()).map(wordmark)
    wordmark.translate(OUTPUT_SIZE - WORDMARK_RIGHT_MARGIN - WORDMARK_WIDTH, WORDMARK_TOP)
    prepared = PreparedTitle(runs, backings, subtitle, _glyph_coverage(subtitle), wordmark)
    return prepared, title_family, wordmark_family


def _source_citation(metadata_dir: Path, mode: str) -> str:
    mobility = json.loads((metadata_dir / "theme_mobilite.json").read_text(encoding="utf-8"))["source_records"]
    milieus = json.loads((metadata_dir / "theme_milieux.json").read_text(encoding="utf-8"))["source_records"]
    osm = mobility["osm_reseaux"]
    ocsge = next(record for key, record in milieus.items() if key.startswith("ocsge_artificialisation_"))

    def credit(record: dict) -> str:
        licence = str(record["licence"])
        if "—" not in licence:
            raise RuntimeError(f"Expected a source attribution in licence: {licence}")
        return licence.split("—", 1)[1].strip()

    ocsge_credit = f"{ocsge['publisher']} · OCS-GE"
    if mode == "bike":
        geovelo = mobility["amenagements_cyclables"]
        return f"{geovelo['publisher']} · {credit(geovelo)} · {ocsge_credit}"
    return f"{credit(osm)} · {ocsge_credit}"


def _scale_bar_spec(extent: QgsRectangle) -> tuple[str, float]:
    target_step = extent.width() * 0.10
    if target_step >= 1000:
        unit, value = "km", target_step / 1000
    else:
        unit, value = "m", target_step
    if value <= 0:
        raise ValueError("Scale-bar target must be positive")
    magnitude = 10 ** int(np.floor(np.log10(value)))
    normalized = value / magnitude
    leading = 5 if normalized >= 5 else 2 if normalized >= 2 else 1
    return unit, leading * magnitude


def _map_furniture_layout(extent: QgsRectangle, scale_spec: tuple[str, float]):
    unit, units_per_segment = scale_spec
    scale_width = round(units_per_segment * (1000 if unit == "km" else 1) * 2 / extent.width() * OUTPUT_SIZE)
    arrow_width = round(NORTH_ARROW_HEIGHT * 61.000001 / 76.826002)
    baseline = OUTPUT_SIZE - FOOTER_HEIGHT - _pixel(92)
    arrow = QRect(OUTPUT_SIZE - NORTH_ARROW_RIGHT_INSET - arrow_width,
                  baseline - NORTH_ARROW_HEIGHT, arrow_width, NORTH_ARROW_HEIGHT)
    right = arrow.left() - FURNITURE_GAP
    left = right - scale_width
    safe_left, safe_top = left - FURNITURE_SAFE_PADDING_X, arrow.top() - FURNITURE_SAFE_PADDING_Y
    safe_right, safe_bottom = arrow.right() + FURNITURE_SAFE_PADDING_X, baseline + _pixel(42) + FURNITURE_SAFE_PADDING_Y
    clear = QRect(safe_left, safe_top, safe_right - safe_left + 1, safe_bottom - safe_top + 1)
    return arrow, clear, left, right, baseline, f"{units_per_segment * 2:g} {unit}"


def _draw_map_furniture(image: QImage, extent: QgsRectangle, scale_spec: tuple[str, float], assets: Path, text_family: str) -> QRect:
    arrow, clear, left, right, baseline, label = _map_furniture_layout(extent, scale_spec)
    svg_path = assets / "north-arrow" / NORTH_ARROW_SVG_NAME
    if not svg_path.is_file():
        raise RuntimeError(f"Missing promoted north-arrow asset: {svg_path}")
    svg = svg_path.read_text(encoding="utf-8")
    colour = MAP_FURNITURE_GREEN.name()
    renderer = QSvgRenderer(QByteArray(svg.replace("param(fill)", colour).replace("param(outline)", colour).encode("utf-8")))
    if not renderer.isValid():
        raise RuntimeError(f"Approved NorthArrow_11.svg did not render: {svg_path}")
    painter = QPainter(image)
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.setRenderHint(QPainter.TextAntialiasing, True)
    painter.setOpacity(0.78)
    painter.setPen(QPen(MAP_FURNITURE_GREEN, _pixel(3), Qt.SolidLine, Qt.FlatCap))
    painter.drawLine(left, baseline, right, baseline)
    for position in (left, (left + right) // 2, right):
        painter.drawLine(position, baseline - _pixel(8), position, baseline + _pixel(8))
    painter.setPen(MAP_FURNITURE_GREEN)
    painter.setFont(_font(text_family, _pixel(26), 400))
    painter.drawText(QRect(left - _pixel(2), baseline + _pixel(10), _pixel(48), _pixel(30)),
                     Qt.AlignLeft | Qt.AlignVCenter, "0")
    painter.drawText(QRect(right - _pixel(150), baseline + _pixel(10), _pixel(150), _pixel(30)),
                     Qt.AlignRight | Qt.AlignVCenter, label)
    renderer.render(painter, QRectF(arrow))
    painter.end()
    return clear


def _compose_map_layers(
    ground: QImage,
    boundaries: QImage,
    networks: QImage,
    outside_land: QgsGeometry,
    land_mask: np.ndarray,
    extent: QgsRectangle,
    title: PreparedTitle,
    scale_spec: tuple[str, float],
    assets: Path,
    text_family: str,
    furniture_clear: QRect,
    desaturate_outside_land: bool = True,
) -> QImage:
    image = ground.copy().convertToFormat(QImage.Format_RGBA8888)
    painter = QPainter(image)
    painter.drawImage(0, 0, boundaries)
    painter.end()
    if desaturate_outside_land:
        from map_ground import desaturate_outside_image
        desaturate_outside_image(image, outside_land, extent, OUTPUT_SIZE, OUTPUT_SIZE)

    wordmark = QPainterPath(title.wordmark_path)
    wordmark_mask = _glyph_coverage(wordmark)
    wordmark_clear = wordmark.boundingRect().adjusted(-TEXT_BAND_PADDING_X, -TEXT_BAND_PADDING_Y,
                                                       TEXT_BAND_PADDING_X, TEXT_BAND_PADDING_Y).toAlignedRect()
    title_path = QPainterPath()
    for path, _, _, _ in title.runs:
        title_path.addPath(path)
    title_band = title_path.boundingRect().adjusted(-TEXT_BAND_PADDING_X, -TEXT_BAND_PADDING_Y,
                                                    TEXT_BAND_PADDING_X, TEXT_BAND_PADDING_Y)
    subtitle_band = title.subtitle_path.boundingRect().adjusted(-TEXT_BAND_PADDING_X, -TEXT_BAND_PADDING_Y,
                                                                TEXT_BAND_PADDING_X, TEXT_BAND_PADDING_Y)
    furniture_band_mask = np.maximum(_rectangles_coverage((title_band, subtitle_band)),
                                     _rectangles_coverage((wordmark_clear,)))
    image = _desaturate_masked_area(image, furniture_band_mask, land_mask)
    texture_path = assets / "texture" / "qgis-hub-paper-texture-cc0.jpg"
    texture_luminance = _paper_texture_luminance(
        str(texture_path.resolve()), texture_path.stat().st_mtime_ns
    )
    backing_mask = _draw_paper_backings(image, title.backings, texture_luminance)
    image = _draw_flat_glyphs(image, title.subtitle_path, SUBTITLE_GREEN, 1.0)

    title_mask = np.zeros((OUTPUT_SIZE, OUTPUT_SIZE), dtype=np.float32)
    solid_title_mask = np.zeros_like(title_mask)
    for path, colour, opacity, solid in title.runs:
        ink_mask = _glyph_coverage(path)
        title_mask = np.maximum(title_mask, ink_mask)
        if solid:
            solid_title_mask = np.maximum(solid_title_mask, ink_mask)
            image = _draw_flat_glyphs(image, path, colour, opacity)
        else:
            image = apply_engraved_ink(image, texture_luminance, ink_mask, colour, opacity, TITLE_RELIEF)
    image = apply_engraved_ink(image, texture_luminance, wordmark_mask, PRIMARY_GREEN, WORDMARK_OPACITY, TITLE_RELIEF)
    furniture_clear = _draw_map_furniture(image, extent, scale_spec, assets, text_family)

    outside_land_mask = geometry_mask(outside_land, extent, OUTPUT_SIZE)
    annotation_mask = _rectangles_coverage((furniture_clear,))
    network_free = np.maximum(furniture_band_mask, annotation_mask)
    network_free = (network_free > 0).astype(np.float32)
    overlay = _keep_original_network_color_over_text(
        networks,
        np.maximum(title_mask, wordmark_mask),
        outside_land_mask,
        np.maximum.reduce((network_free, solid_title_mask, backing_mask)),
    )
    painter = QPainter(image)
    painter.drawImage(0, 0, overlay)
    painter.end()
    return image


def _draw_footer(image: QImage, mode: str, family_regular: str, family_semibold: str,
                 citation: str, footer: tuple[str, str] | None) -> None:
    source_text = f"Sources : {citation}"
    source_font = _font(family_regular, SOURCE_SIZE, 400)
    source_metrics = QFontMetricsF(source_font)
    source_width = source_metrics.horizontalAdvance(source_text)
    available = OUTPUT_SIZE - 2 * FOOTER_INSET_X
    lead_font = body_font = None
    lead_metrics = body_metrics = None
    if footer is not None:
        lead_text, body_text = footer
        lead_font = _font(family_semibold, FOOTER_SIZE, 600)
        body_font = _font(family_regular, FOOTER_SIZE, 400)
        lead_metrics, body_metrics = QFontMetricsF(lead_font), QFontMetricsF(body_font)
        method_width = lead_metrics.horizontalAdvance(lead_text) + body_metrics.horizontalAdvance(body_text)
        if method_width + SOURCE_METHOD_GAP + source_width > available:
            raise RuntimeError(f"{mode} method ({method_width:.0f}px) and source citation do not fit")
    elif source_width > available:
        raise RuntimeError(f"{mode} citation is too wide for the approved footer")
    strip = QRect(0, OUTPUT_SIZE - FOOTER_HEIGHT, OUTPUT_SIZE, FOOTER_HEIGHT)
    painter = QPainter(image)
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.setPen(Qt.NoPen)
    painter.setBrush(QColor("#FFFFFF"))
    painter.drawRect(strip)
    painter.setPen(QPen(QColor("#D4DEDB"), _pixel(2)))
    painter.drawLine(0, strip.top(), OUTPUT_SIZE, strip.top())
    baseline = strip.top() + round((FOOTER_HEIGHT - source_metrics.height()) / 2) + round(source_metrics.ascent())
    if footer is not None:
        lead_text, body_text = footer
        x = FOOTER_INSET_X
        painter.setPen(INK_COLOUR)
        painter.setFont(lead_font)
        painter.drawText(x, baseline, lead_text)
        x += round(lead_metrics.horizontalAdvance(lead_text))
        painter.setFont(body_font)
        painter.drawText(x, baseline, body_text)
    painter.setPen(QColor("#566663"))
    painter.setFont(source_font)
    painter.drawText(OUTPUT_SIZE - FOOTER_INSET_X - round(source_width), baseline, source_text)
    painter.end()


def compose_inspection(
    ground: QImage,
    networks: QImage,
    boundaries: QImage,
    outside_land: QgsGeometry,
    land_mask: np.ndarray,
    extent: QgsRectangle,
    territory_label: str,
    mode_runs: tuple[tuple[str, QColor, float, bool], ...],
    content: dict,
    assets: str | Path,
    metadata_dir: str | Path,
    scale_spec: tuple[str, float],
    desaturate_outside_land: bool = True,
) -> QImage:
    """Produce the native 2400px inspection profile at the existing layout scale."""
    if ground.size().width() != OUTPUT_SIZE or ground.size().height() != OUTPUT_SIZE:
        raise ValueError("Inspection composition requires a 2400×2400 ground render")
    assets = Path(assets)
    with tempfile.TemporaryDirectory(prefix="lusk-inspection-fonts-") as temp_name:
        temp = Path(temp_name)
        title, _, _ = _prepare_title(mode_runs, territory_label, assets, temp)
        family_regular = _load_static_face("mozilla-text", 400, assets, temp)
        family_semibold = _load_static_face("mozilla-text", 600, assets, temp)
        _load_static_face("mozilla-text", 700, assets, temp)
        image = _compose_map_layers(
            ground, boundaries, networks, outside_land, land_mask, extent, title,
            scale_spec, assets, family_regular, QRect(), desaturate_outside_land,
        )
        citation = _source_citation(Path(metadata_dir), content["mode"])
        _draw_footer(image, content["mode"], family_regular, family_semibold, citation,
                     content.get("footer"))
    return image
