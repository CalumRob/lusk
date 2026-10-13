"""Native selected AEDAR legends; tick rounding never changes classification."""


def tick_label(value, boundaries):
    width = (float(boundaries[-1]) - float(boundaries[0])) / (len(boundaries) - 1)
    if width > 1:
        return f"{round(value):,}".replace(",", "\u202f")
    return (f"{value:.1f}".rstrip("0").rstrip(".") or "0").replace(".", ",")


def draw_legend(adapter, image, feature):
    """Preserve the two selected native layouts, including the car-only mean marker."""
    from qgis.PyQt.QtGui import QColor, QFont, QPainter
    from inspection_plate import MAP_FURNITURE_GREEN
    scale, colors = feature["_scale"], feature["palette"]
    lo, hi = scale["min"], scale["max"]
    painter = QPainter(image)
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.setPen(MAP_FURNITURE_GREEN)
    painter.setFont(adapter._map_font(14, QFont.DemiBold))
    painter.drawText(84, 2150, feature["legend_label"])
    left, width, top, height = 84, 680, 2178, 20
    segment = width / len(colors)
    for index, color in enumerate(colors):
        # The selected loss ramp overlaps segments by one pixel; the car ramp
        # has exact contiguous rectangles. Keep both rasterizations unchanged.
        segment_width = round(segment) if feature["mode"] == "car" else round(segment) + 1
        painter.fillRect(round(left + index * segment), top, segment_width, height, QColor(color))
    painter.setPen(MAP_FURNITURE_GREEN)
    painter.setFont(adapter._map_font(12, QFont.DemiBold))
    metrics = painter.fontMetrics()
    for value in scale["breaks"]:
        x = round(left + width * (value - lo) / (hi - lo))
        painter.drawLine(x, top + height, x, top + height + 7)
        text = tick_label(value, feature["scale_breaks"])
        text_width = metrics.horizontalAdvance(text)
        painter.drawText(max(left, min(x - text_width // 2, left + width - text_width)), 2228, text)
    if feature["mode"] == "car":
        mean = feature["regional_mean"]
        x = round(left + width * (mean - lo) / (hi - lo))
        painter.drawLine(x, top - 7, x, top + height + 7)
        for y, text in ((2256, f"{mean:.1f}".replace(".", ",")), (2282, "Moy. Bretagne")):
            painter.drawText(x - metrics.horizontalAdvance(text) // 2, y, text)
    painter.end()
