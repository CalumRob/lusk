"""Validated shared physical presentation defaults for native map families."""
from dataclasses import dataclass
from math import isfinite
from collections.abc import Mapping
@dataclass(frozen=True)
class CartographicPolicy:
    frame_margin_ratio: float = 0.08
    inspection_surface: str = "ocsge-selected-cs"
    water: str = "sea-colour"
    inline_surface: str = "paper-only"

    def __post_init__(self):
        if (isinstance(self.frame_margin_ratio, bool) or
                not isinstance(self.frame_margin_ratio, (int, float)) or
                not isfinite(self.frame_margin_ratio) or not 0 <= self.frame_margin_ratio < 1):
            raise ValueError("frame margin ratio must be in [0, 1)")
        if not all(isinstance(value, str) and value for value in
                   (self.inspection_surface, self.water, self.inline_surface)):
            raise ValueError("cartographic surface declarations must be non-empty strings")

    def framing(self):
        return {"shape": "square-circular-frame", "margin_ratio": self.frame_margin_ratio}

    def ground(self, *, inline=True):
        result = {"inspection_surface": self.inspection_surface, "water": self.water}
        if inline:
            result["inline_surface"] = self.inline_surface
        return result

    def contract(self):
        return {"frame_margin_ratio": self.frame_margin_ratio,
                "inspection_surface": self.inspection_surface,
                "water": self.water, "inline_surface": self.inline_surface}

    def profile_contract(self, profile):
        fields = ("frame_margin_ratio", "inline_surface", "water") if profile == "inline" else (
            "frame_margin_ratio", "inspection_surface", "water")
        return {key: self.contract()[key] for key in fields}


SHARED_CARTOGRAPHIC_POLICY = CartographicPolicy()
_ALLOWED_OVERRIDES = frozenset({"frame_margin_ratio", "inspection_surface", "water", "inline_surface"})


def family_policy(declaration=None):
    """Resolve a small, validated physical-policy override from a family contract."""
    if declaration is None:
        declaration = {}
    if not isinstance(declaration, Mapping):
        raise ValueError("family cartographic policy must be an object")
    unknown = set(declaration) - _ALLOWED_OVERRIDES
    if unknown:
        raise ValueError(f"unknown cartographic policy overrides: {sorted(unknown)}")
    values = {name: getattr(SHARED_CARTOGRAPHIC_POLICY, name) for name in _ALLOWED_OVERRIDES}
    values.update(declaration)
    return CartographicPolicy(**values)
