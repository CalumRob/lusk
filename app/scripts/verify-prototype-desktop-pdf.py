"""Artifact regression checks for the local Rennes desktop-PDF experiment."""
import json
from pathlib import Path
from urllib.parse import urlsplit
import fitz

root = Path("E:/Temp/opencode/cahier-desktop-pdf")
receipt = json.loads((root / "receipt.json").read_text(encoding="utf8"))
inventory = json.loads((root / "inventory.json").read_text(encoding="utf8"))
manifest = json.loads(Path("public/prototype-pdf-fonts/manifest.json").read_text(encoding="utf8"))
url = urlsplit(receipt["url"])
home = f"{url.scheme}://{url.netloc}/"
wordmark = next(face for face in manifest if face["family"] == "Newsreader Variable" and face["style"] == "italic")
loaded = {face["style"] for face in inventory["loadedFaces"] if face["family"] == wordmark["family"]}
assert wordmark["sourceStyle"] in loaded, "Wordmark uses a face the website did not load"

document = fitz.open(root / "rennes-desktop-epci.pdf")
assert len(document) == len(receipt["pages"]) == 4
report = []
for index, page in enumerate(document):
    text = page.get_text()
    links = page.get_links()
    assert "Retrouvez les cartes et explorez les données sur" in text
    expected_context = receipt["pages"][index].get("showsComparisonContext", True)
    assert ("¹ Groupe comparé :" in text) == expected_context
    assert any(link.get("uri") == home and link["from"].y0 < 90 for link in links), "Wordmark homepage link missing"
    assert any(link.get("uri") == home and link["from"].y0 > page.rect.height - 80 for link in links), "Footer invitation link missing"
    assert any(link.get("uri") == receipt["url"] for link in links), "Territory page link missing"
    assert abs(page.rect.width - 595.28) < .1 and abs(page.rect.height - 841.89) < .1
    refs = [link for link in links if link["kind"] == fitz.LINK_GOTO]
    for link in refs:
        assert link["page"] == index and link["to"].y > page.rect.height - 80, "Comparison marker targets the wrong page/footer"
    sections = receipt["pages"][index]["sections"]
    if any(key in sections for key in ["aedar-access", "aedar-equipment-explorer"]):
        assert refs, "Comparison legend lacks its footer-reference link"
        assert any(path["dashes"] and path["dashes"] != "[] 0" and abs(path["rect"].width - 18 * receipt["scale"]) < .05 and path["rect"].height < .05 for path in page.get_drawings()), "Comparison legend line is solid/missing"
    if "aedar-car-overview" in sections:
        assert len(refs) == 2, "Scalar comparison captions need footer markers too"
    assert len(page.get_image_info()) == [1, 4, 0, 0][index], "Rasterized text/figures or missing maps"
    assert receipt["pages"][index]["centeringInset"] >= 0
    report.append({"page": index + 1, "text_characters": len(text), "footer_references": len(refs), "links": len(links)})

(root / "regression-checks.json").write_text(json.dumps(report, indent=2), encoding="utf8")
print("PASS: actual font face, homepage/territory/CTA links, footer markers, dashed legend, A4/section layout, selectable text.")
