"""Render/check every publication guard in the semantic read path (issue #984).

The v2 batch contract may turn exactly one classification into a typed item
outcome: ``publication_unavailable(...)``. Every other 503 guard stays a
whole-request failure. This inventory makes that boundary auditable: a new
guard cannot be added, or a fatal guard silently reclassified, without
regenerating the documented table.

Run without arguments to refresh ``api/publication-guard-inventory.md``; use
``--check`` (as the contract test does) to fail on drift.
"""

from __future__ import annotations

import argparse
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "publication-guard-inventory.md"
API_DIR = ROOT
BEGIN = "<!-- BEGIN GENERATED PUBLICATION GUARD INVENTORY -->"
END = "<!-- END GENERATED PUBLICATION GUARD INVENTORY -->"


class _Guards(ast.NodeVisitor):
    def __init__(self, path: Path):
        self.path = path
        self.stack: list[str] = []
        self.rows: list[tuple[str, str, str, str, str]] = []

    def visit_FunctionDef(self, node):
        self.stack.append(node.name)
        self.generic_visit(node)
        self.stack.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    def _function(self):
        return ".".join(self.stack) or "<module>"

    def visit_Raise(self, node):
        call = node.exc
        if (isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
                and call.func.id == "HTTPException" and call.args
                and isinstance(call.args[0], ast.Constant) and call.args[0].value == 503):
            detail = (call.args[1].value if len(call.args) > 1
                      and isinstance(call.args[1], ast.Constant) else "")
            self.rows.append(("fatal", str(self.path.relative_to(ROOT)).replace("\\", "/"),
                              self._function(), "—", detail))
        self.generic_visit(node)

    def visit_Call(self, node):
        func = node.func
        name = func.id if isinstance(func, ast.Name) else (
            func.attr if isinstance(func, ast.Attribute) else None)
        if name == "publication_unavailable" and len(node.args) >= 2:
            family = node.args[0].value if isinstance(node.args[0], ast.Constant) else "?"
            detail = node.args[1].value if isinstance(node.args[1], ast.Constant) else ""
            self.rows.append(("unavailable", str(self.path.relative_to(ROOT)).replace("\\", "/"),
                              self._function(), str(family), detail))
        self.generic_visit(node)


def collect_guards():
    rows = []
    for path in sorted(API_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        visitor = _Guards(path)
        visitor.visit(tree)
        rows.extend(visitor.rows)
    # Stable order: soft outcomes first, then fatal guards by file/function.
    return sorted(rows, key=lambda row: (row[0] != "unavailable", row[1], row[2], row[4]))


def render_inventory(rows) -> str:
    lines = [
        BEGIN,
        "",
        "| Outcome | File | Function | Family | Guard detail |",
        "| --- | --- | --- | --- | --- |",
    ]
    for outcome, path, function, family, detail in rows:
        escaped = detail.replace("|", "\\|")
        lines.append(f"| `{outcome}` | `{path}` | `{function}` | `{family}` | {escaped} |")
    lines.extend(["", END])
    return "\n".join(lines)


def replace_inventory(document: str, generated: str) -> str:
    start = document.index(BEGIN)
    end = document.index(END) + len(END)
    return document[:start] + generated + document[end:]


def check_inventory_file(path=DOC_PATH, rows=None):
    rows = collect_guards() if rows is None else rows
    return replace_inventory(path.read_text(encoding="utf-8"), render_inventory(rows)) == \
        path.read_text(encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the inventory is stale")
    args = parser.parse_args()
    if args.check:
        if not check_inventory_file():
            print("Publication guard inventory is stale; regenerate it without --check.")
            raise SystemExit(1)
        return
    rows = collect_guards()
    document = DOC_PATH.read_text(encoding="utf-8")
    DOC_PATH.write_text(replace_inventory(document, render_inventory(rows)),
                        encoding="utf-8", newline="\n")
    print(f"Updated {DOC_PATH.name} with {len(rows)} guards.")


if __name__ == "__main__":
    main()
