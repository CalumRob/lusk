"""Verify the three-mode PDF grid against its shared-tooltip-model receipt."""
import json
from pathlib import Path
import fitz

root = Path("E:/Temp/opencode/cahier-sandbox-pdf")
receipt = json.loads((root / "rennes-aedar-equipment-explorer-receipt.json").read_text(encoding="utf8"))
document = fitz.open(root / "rennes-aedar-equipment-explorer.pdf")
assert len(document) == 1
page = document[0]
words = page.get_text("words")
normalize = lambda text: "".join(text.split())
assert not page.get_image_info(), "Expected vector charts and real text, not screenshots"
assert receipt["territoryFirst"]
assert receipt["pages"][0]["occupiedHeight"] <= receipt["pageContentHeight"] + .001
assert abs(receipt["scale"] - (page.rect.width - 64) / receipt["desktopWidth"]) < .0001, "Extra whole-page shrinking"
assert receipt["tooltipTables"][0]["selectedModes"] == receipt["tooltipTables"][1]["selectedModes"]

checked = 0
for table, header in zip(receipt["tooltipTables"], ["Temps", "Statistique"], strict=True):
    assert len(table["selectedModes"]) == 3
    axis_header = next(word for word in words if word[4] == header)
    column_headers = sorted([word for word in words if abs(word[1] - axis_header[1]) < 3
        and word[4] in {"Rennes", "Groupe¹", "Rang"}], key=lambda word: word[0])
    assert len(column_headers) == 3 * len(table["selectedModes"]), "Missing or broken column labels"
    cuts = list(dict.fromkeys(row["cut"] for row in table["rows"]))
    for cut in cuts:
        cut_boxes = [box for box in page.search_for(cut) if box.y0 > axis_header[1]
            and abs(box.x0 - axis_header[0]) < 2]
        assert len(cut_boxes) == 1, (header, cut, cut_boxes)
        line = cut_boxes[0]
        for mode_index, key in enumerate(table["selectedModes"]):
            row = next(row for row in table["rows"] if row["cut"] == cut and row["seriesKey"] == key)
            for offset, expected in enumerate([row["value"], row["comparison"]["value"], row["comparison"]["rank"] or "—"]):
                column = mode_index * 3 + offset
                left = column_headers[column][0] - .4
                right = column_headers[column + 1][0] - .4 if column + 1 < len(column_headers) else page.rect.width - 32
                text = page.get_textbox(fitz.Rect(left, line.y0 - 1, right, line.y1 + 1))
                assert normalize(text) == normalize(expected), (header, cut, key, offset, expected, text)
                checked += 1

assert checked == 135
separators = {round(path["rect"].x0, 1) for path in page.get_drawings()
    if path["rect"].width < .01 and path["rect"].height > 2 and path["rect"].y0 > page.rect.height / 2}
assert len(separators) == 2, "Expected two vertical boundaries between three mode groups"
assert any(link.get("uri") == receipt["url"] for link in page.get_links())
(root / "verification.json").write_text(json.dumps({"pages": 1, "modes": 3,
    "verified_numeric_cells": checked, "vertical_boundaries": len(separators),
    "extra_downscaling": False}, indent=2), encoding="utf8")
print(f"PASS: {checked} values/reference/rank cells in their correct mode/cut columns; three modes; vertical separators; one A4.")
