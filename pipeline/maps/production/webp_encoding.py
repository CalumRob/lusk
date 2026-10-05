"""Pinned, pipeline-local WebP RGB quality 80 encoder and decoded QA."""
from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile


WEBP_ENCODING_CONTRACT = {
    "format": "webp",
    "encoder": "Pillow",
    "encoder_version": "12.3.0",
    "rgb_mode": "lossy",
    "lossless": False,
    "quality": 80,
    "method": 4,
    "exact": True,
    "alpha_mode": "lossless",
    "alpha_quality": 100,
}


def _pillow():
    """Load only the pipeline-owned wheel directory; never mutate QGIS/global packages."""
    site = Path(__file__).with_name(".runtime") / "site-packages"
    if site.is_dir() and str(site) not in sys.path:
        sys.path.insert(0, str(site))
    try:
        import PIL
        from PIL import Image, features
    except ImportError as error:
        raise RuntimeError(
            "Pillow WebP encoder is not installed in the pipeline runtime; "
            "run install_webp_encoder.ps1") from error
    if PIL.__version__ != WEBP_ENCODING_CONTRACT["encoder_version"]:
        raise RuntimeError(f"Pillow {WEBP_ENCODING_CONTRACT['encoder_version']} is required; found {PIL.__version__}")
    try:
        Path(PIL.__file__).resolve().relative_to(site.resolve())
    except ValueError as error:
        raise RuntimeError("WebP encoding must use the pipeline-local Pillow runtime") from error
    if not features.check("webp"):
        raise RuntimeError("pipeline Pillow runtime has no WebP encoder support")
    return Image


def require_webp_encoder() -> None:
    """Fail early before approval verification or shared/full map preparation."""
    _pillow()


def _decoded_webp(path: str | Path):
    path = Path(path)
    try:
        data = path.read_bytes()
    except OSError as error:
        raise ValueError(f"missing or unreadable WebP artifact: {path}: {error}") from error
    if (len(data) < 20 or data[:4] != b"RIFF" or data[8:12] != b"WEBP"
            or int.from_bytes(data[4:8], "little") != len(data) - 8):
        raise ValueError(f"invalid or truncated WebP container: {path}")
    Image = _pillow()
    try:
        with Image.open(path) as source:
            if source.format != "WEBP":
                raise ValueError(f"artifact is not WebP: {path}")
            source.load()
            return source.copy()
    except (OSError, SyntaxError) as error:
        raise ValueError(f"WebP decoder rejected artifact: {path}: {error}") from error


def validate_webp(path: str | Path, profile):
    """Decode the complete container and enforce canonical dimensions/channel/alpha rules."""
    image = _decoded_webp(path)
    if image.size != tuple(profile.size):
        raise ValueError(f"{profile.name} WebP dimensions {image.size} != {profile.size}")
    if profile.transparent_outside:
        if image.mode != "RGBA":
            raise ValueError(f"{profile.name} WebP must decode with RGBA alpha")
        alpha = image.getchannel("A").tobytes()
        if not any(value == 0 for value in alpha) or not any(value == 255 for value in alpha):
            raise ValueError(f"{profile.name} WebP must contain transparent and opaque alpha samples")
    elif image.mode != "RGB":
        raise ValueError(f"{profile.name} WebP must decode as opaque RGB")
    return image


def encode_qimage(image, destination: str | Path, *, preserve_alpha: bool) -> Path:
    """Atomically encode a QImage; independently prove alpha losslessness before publication."""
    destination = Path(destination)
    if destination.exists() or destination.is_dir():
        raise ValueError(f"WebP encoder destination must be a new file path: {destination}")
    if image.isNull():
        raise ValueError("cannot encode a null QImage")
    Image = _pillow()
    from qgis.PyQt.QtGui import QImage

    rgba = image.convertToFormat(QImage.Format_RGBA8888)
    pointer = rgba.bits()
    pointer.setsize(rgba.sizeInBytes())
    data = bytes(pointer)
    row_bytes = rgba.width() * 4
    stride = rgba.bytesPerLine()
    if stride < row_bytes or len(data) < stride * rgba.height():
        raise ValueError("QImage RGBA buffer is incomplete")
    data = b"".join(data[y * stride:y * stride + row_bytes] for y in range(rgba.height()))
    source = Image.frombytes("RGBA", (rgba.width(), rgba.height()), data)
    source_alpha = source.getchannel("A").tobytes()
    if preserve_alpha:
        encoded = source
    else:
        if any(value != 255 for value in source_alpha):
            raise ValueError("opaque inspection WebP received non-opaque source pixels")
        encoded = source.convert("RGB")

    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{destination.stem}-", suffix=".tmp.webp",
        dir=destination.parent)
    os.close(fd)
    temporary = Path(temp_name)
    try:
        options = {key: WEBP_ENCODING_CONTRACT[key] for key in
            ("quality", "method", "exact", "alpha_quality")}
        options["lossless"] = False
        encoded.save(temporary, format="WEBP", **options)
        decoded = validate_webp(temporary,
            type("EncoderProfile", (), {"name": "inline" if preserve_alpha else "inspection",
                "size": (rgba.width(), rgba.height()), "transparent_outside": preserve_alpha})())
        if preserve_alpha and decoded.getchannel("A").tobytes() != source_alpha:
            raise ValueError("WebP encoder changed the source alpha channel")
        os.replace(temporary, destination)
        return destination
    finally:
        temporary.unlink(missing_ok=True)
