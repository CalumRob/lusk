"""Render/check the public route and request-schema inventory from FastAPI OpenAPI."""

import argparse
from pathlib import Path
import re
import sys

from api.main import app


DOC_PATH = Path(__file__).resolve().parents[1] / "ENDPOINTS.md"
BEGIN = "<!-- BEGIN GENERATED API REQUEST INVENTORY -->"
END = "<!-- END GENERATED API REQUEST INVENTORY -->"
METHODS = ("get", "put", "post", "delete", "options", "head", "patch", "trace")
_REF = re.compile(r"^#/components/schemas/([^/]+)$")


def _constraints(schema):
    nullable_alternatives = schema.get("anyOf", schema.get("oneOf", []))
    non_null = [item for item in nullable_alternatives if item.get("type") != "null"]
    if len(non_null) == 1:
        schema = {**non_null[0], **{key: value for key, value in schema.items()
                                   if key not in {"anyOf", "oneOf"}}}
    values = []
    for key, label in (
        ("minLength", "min chars"),
        ("maxLength", "max chars"),
        ("minimum", "min"),
        ("maximum", "max"),
        ("exclusiveMinimum", "exclusive min"),
        ("exclusiveMaximum", "exclusive max"),
        ("minItems", "min items"),
        ("maxItems", "max items"),
        ("pattern", "pattern"),
    ):
        if key in schema:
            values.append(f"{label}: `{schema[key]}`")
    if "enum" in schema:
        values.append("one of " + ", ".join(f"`{item}`" for item in schema["enum"]))
    if "const" in schema:
        values.append(f"const: `{schema['const']}`")
    if "default" in schema:
        values.append(f"default: `{schema['default']}`")
    return values


def _schema_type(schema):
    if "$ref" in schema:
        match = _REF.match(schema["$ref"])
        return match.group(1) if match else schema["$ref"]
    if "oneOf" in schema or "anyOf" in schema:
        alternatives = schema.get("oneOf", schema.get("anyOf", []))
        labels = [_schema_type(item) for item in alternatives if item.get("type") != "null"]
        if len(labels) == 1:
            return labels[0]
        return "one of " + " / ".join(labels)
    if schema.get("type") == "array":
        return f"array of {_schema_type(schema.get('items', {}))}"
    return schema.get("type", "object")


def _describe_schema(schema):
    parts = [_schema_type(schema)]
    parts.extend(_constraints(schema))
    return "; ".join(parts)


def _walk_refs(value):
    if isinstance(value, dict):
        ref = value.get("$ref")
        match = _REF.match(ref) if ref else None
        if match:
            yield match.group(1)
        for child in value.values():
            yield from _walk_refs(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_refs(child)


def _request_models(schema):
    components = schema.get("components", {}).get("schemas", {})
    found = set()
    # Request-model inventory should include only models reachable from request
    # bodies; parameter refs and response models are deliberately not expanded.
    pending = []
    for path_item in schema.get("paths", {}).values():
        for method, operation in path_item.items():
            if method in METHODS and "requestBody" in operation:
                pending.extend(_walk_refs(operation["requestBody"]))
    ordered = []
    while pending:
        name = pending.pop(0)
        if name in found or name not in components:
            continue
        found.add(name)
        ordered.append(name)
        pending.extend(_walk_refs(components[name]))
    return ordered, components


def render_inventory(schema):
    lines = [
        BEGIN,
        "## Generated route and request-schema inventory",
        "",
        "Generated from `api.main:app.openapi()` by",
        "`python -m api.scripts.generate_endpoint_inventory`. This inventory is",
        "the authoritative source for exact methods, paths, parameter schemas,",
        "request-body requiredness, and request-model property constraints. It",
        "intentionally does not duplicate response/business vocabularies; follow",
        "the linked resource contracts and the operation notes below.",
        "",
        "| Method | Path | Operation | Parameters | Request body |",
        "| --- | --- | --- | --- | --- |",
    ]

    for path, path_item in schema.get("paths", {}).items():
        for method in METHODS:
            operation = path_item.get(method)
            if operation is None:
                continue
            params = []
            for parameter in operation.get("parameters", []):
                required = "required" if parameter.get("required") else "optional"
                detail = _describe_schema(parameter.get("schema", {}))
                params.append(
                    f"`{parameter['name']}` ({parameter.get('in')}, {required}: {detail})"
                )
            body = operation.get("requestBody")
            if body:
                content = body.get("content", {}).get("application/json", {})
                body_schema = content.get("schema", {})
                body_required = "required" if body.get("required") else "optional"
                body_label = _schema_type(body_schema)
                body_text = f"{body_required} request body: `{body_label}`"
            else:
                body_schema = {}
                body_text = "—"
            summary = operation.get("summary", "")
            lines.append(
                f"| `{method.upper()}` | `{path}` | {summary} | "
                f"{'<br>'.join(params) if params else '—'} | {body_text} |"
            )

    models, components = _request_models(schema)
    if models:
        lines.extend(("", "### Request-model properties", ""))
        lines.append(
            "These are the model fields reachable from request bodies, including "
            "nested and discriminated-union members. `required` is per model; "
            "array/string/numeric bounds and defaults come from OpenAPI."
        )
        lines.extend(("", "| Model | Property | Required? | Schema |", "| --- | --- | --- | --- |"))
        for name in models:
            model = components[name]
            required_properties = set(model.get("required", []))
            properties = model.get("properties", {})
            if not properties:
                lines.append(f"| `{name}` | — | — | {_describe_schema(model)} |")
                continue
            for property_name, property_schema in properties.items():
                required = "yes" if property_name in required_properties else "no"
                lines.append(
                    f"| `{name}` | `{property_name}` | {required} | "
                    f"{_describe_schema(property_schema)} |"
                )
    lines.extend(("", END))
    return "\n".join(lines)


def replace_inventory(document, generated):
    start = document.find(BEGIN)
    end = document.find(END)
    if start < 0 or end < start:
        raise ValueError(f"Missing or malformed generated inventory markers: {BEGIN} / {END}")
    end += len(END)
    return document[:start] + generated + document[end:]


def check_inventory_file(path=DOC_PATH, schema=None):
    document = Path(path).read_text(encoding="utf-8")
    generated = render_inventory(schema if schema is not None else app.openapi())
    try:
        return replace_inventory(document, generated) == document
    except ValueError:
        return False


def write_inventory(path=DOC_PATH, schema=None):
    path = Path(path)
    document = path.read_text(encoding="utf-8")
    generated = render_inventory(schema if schema is not None else app.openapi())
    path.write_text(replace_inventory(document, generated), encoding="utf-8", newline="\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if ENDPOINTS.md is stale")
    args = parser.parse_args(argv)
    if args.check:
        if not check_inventory_file():
            print("API request inventory is stale; regenerate it without --check.", file=sys.stderr)
            return 1
        print("API request inventory matches FastAPI OpenAPI.")
        return 0
    write_inventory()
    print(f"Updated {DOC_PATH.relative_to(Path.cwd())} from FastAPI OpenAPI.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
