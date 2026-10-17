"""Bounded search projection over published territory-reference rows."""

import unicodedata


MAX_TERRITORY_SEARCH_SCAN = 1500


def _normalize(value: str) -> str:
    value = unicodedata.normalize("NFD", value.lower())
    value = "".join(char for char in value if not 0x0300 <= ord(char) <= 0x036F)
    return " ".join(value.replace("œ", "oe").replace("æ", "ae").replace("'", " ")
                  .replace("’", " ").replace("-", " ").split())


def search_territory_rows(rows: list[dict], query: str, limit: int) -> list[dict]:
    """Return candidates through the score/length boundary, preserving base order ties."""
    normalized = _normalize(query)
    scored = []
    for row in rows:
        name = _normalize(row["name"])
        score = 100 if name == normalized else 80 if name.startswith(normalized) else 60 if any(
            word.startswith(normalized) for word in name.split()
        ) else 40 if normalized in name else 0
        if score:
            scored.append((score, row))
    scored.sort(key=lambda item: (-item[0], len(item[1]["name"])))
    if len(scored) <= limit:
        return [row for _, row in scored]
    cutoff_score, cutoff_row = scored[limit - 1]
    cutoff_length = len(cutoff_row["name"])
    return [row for score, row in scored
            if score > cutoff_score or (score == cutoff_score and len(row["name"]) <= cutoff_length)]
