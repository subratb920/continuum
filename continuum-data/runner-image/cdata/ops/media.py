"""Images and audio: the dataset's shared media folder, reading files, and hashes.

Media files live once per dataset, at ``datasets/<datasetId>/media/<ab>/<sha256>.<ext>``,
named by their content. A version's rows hold that path (relative to the
dataset folder) in their ``image`` or ``audio`` column, so a clean-up step that
only drops rows never copies a file, and two versions share what they have
in common.
"""

from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path
from typing import Optional

from .. import protocol
from ..protocol import CdataError

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
AUDIO_EXT = {".wav", ".flac", ".mp3", ".ogg", ".oga", ".opus", ".m4a"}
IMAGE_FORMATS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "BMP": ".bmp", "GIF": ".gif", "TIFF": ".tif"}


def require(kind: str) -> None:
    """A clear message when this runner image was built without the picture or sound libraries."""
    try:
        if kind == "image":
            import PIL.Image  # noqa: F401
        else:
            import numpy  # noqa: F401
            import soundfile  # noqa: F401
    except ImportError:
        what = "pictures (Pillow)" if kind == "image" else "sound (NumPy and soundfile)"
        raise CdataError("MEDIA_NOT_INSTALLED", f"This runner can't read {what} yet. Rebuild the runner image with its full requirements.txt.")


def kind_of(name: str) -> Optional[str]:
    ext = os.path.splitext(name.lower())[1]
    if ext in IMAGE_EXT:
        return "image"
    if ext in AUDIO_EXT:
        return "audio"
    return None


def dataset_dir(version_rel: str) -> Path:
    """``datasets/<id>/<version>`` → the dataset's folder (where ``media/`` lives)."""
    parts = Path(version_rel).parts
    if len(parts) < 3 or parts[-3] != "datasets":
        raise CdataError("BAD_OUTPUT", "Media datasets must be written under datasets/<id>/<version>.")
    return protocol.resolve(str(Path(*parts[:-1])), "output")


def put(ds_dir: Path, data: bytes, ext: str) -> str:
    """Stores bytes in the media folder (once) and returns their path relative to the dataset."""
    digest = hashlib.sha256(data).hexdigest()
    rel = f"media/{digest[:2]}/{digest}{ext}"
    full = ds_dir / rel
    if not full.exists():
        full.parent.mkdir(parents=True, exist_ok=True)
        tmp = full.with_name(f".{full.name}.tmp-{os.getpid()}")
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, full)
    return rel


def resolve(ds_dir: Path, rel: str) -> Path:
    return protocol.resolve_in(ds_dir, rel, "media path")


# ---------- images ----------


def image_info(data: bytes) -> Optional[dict]:
    """Width, height, format and colour mode, or None when the image can't be read."""
    from PIL import Image

    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            return {"width": im.width, "height": im.height, "format": im.format, "mode": im.mode}
    except Exception:  # noqa: BLE001
        return None


def dhash(path: Path) -> Optional[int]:
    """A 64-bit difference hash: alike images get hashes a few bits apart."""
    from PIL import Image

    try:
        with Image.open(path) as im:
            g = im.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
            px = list(g.getdata())
    except Exception:  # noqa: BLE001
        return None
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | (px[row * 9 + col] > px[row * 9 + col + 1])
    return bits


# ---------- audio ----------


def audio_info(data: bytes) -> Optional[dict]:
    """Sample rate, duration (seconds) and channels, or None when it can't be read."""
    import soundfile as sf

    try:
        info = sf.info(io.BytesIO(data))
    except Exception:  # noqa: BLE001
        return None
    if not info.samplerate or info.frames <= 0:
        return None
    return {"sample_rate": int(info.samplerate), "duration": round(info.frames / info.samplerate, 3), "channels": int(info.channels), "format": info.format}


def read_audio(path: Path):
    import soundfile as sf

    return sf.read(str(path), dtype="float32", always_2d=True)


def write_audio(samples, rate: int, fmt: str = "flac") -> bytes:
    import soundfile as sf

    buf = io.BytesIO()
    sf.write(buf, samples, rate, format=fmt.upper(), subtype="PCM_16")
    return buf.getvalue()


def resample(samples, rate: int, target: int):
    """Linear resampling (numpy), good enough for speech and sound clips."""
    import numpy as np

    if rate == target:
        return samples
    n = int(round(samples.shape[0] * target / rate))
    if n <= 1:
        return samples[:1]
    old = np.linspace(0.0, 1.0, num=samples.shape[0], endpoint=False)
    new = np.linspace(0.0, 1.0, num=n, endpoint=False)
    return np.stack([np.interp(new, old, samples[:, c]) for c in range(samples.shape[1])], axis=1).astype("float32")
