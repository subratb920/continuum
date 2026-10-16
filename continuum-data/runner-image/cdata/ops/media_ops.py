"""Clean-up steps for images and audio (D3): resize, resample, augment.

New files go into the dataset's media folder (named by their content), and
the rows point at them; files that a step doesn't change are not copied.
"""

from __future__ import annotations

import io
import random

import polars as pl

from .. import protocol
from ..protocol import CdataError, ParamError, Progress, fmt_int, get_param
from . import media
from ._version import add_flag, read_version, write_version


def _need(v, kind):
    if v.modality != kind or kind not in v.df.columns:
        raise ParamError(f"This step works on {'images' if kind == 'image' else 'audio'} only.", "WRONG_KIND")
    media.require(kind)


# ---------- resize ----------

MODES = ("fit", "pad", "crop", "stretch")


def _resized(path, size, mode, fmt, quality):
    from PIL import Image, ImageOps

    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        keep_grey = im.mode in ("L", "1", "I;16")
        im = im.convert("L" if keep_grey else "RGB")
        if mode == "stretch":
            out = im.resize((size, size), Image.Resampling.LANCZOS)
        elif mode == "crop":
            out = ImageOps.fit(im, (size, size), Image.Resampling.LANCZOS)
        elif mode == "pad":
            out = ImageOps.pad(im, (size, size), Image.Resampling.LANCZOS, color=0 if keep_grey else (0, 0, 0))
        else:  # fit: the longer side becomes size, the shape is kept
            out = im.copy()
            out.thumbnail((size, size), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        out.save(buf, format=fmt, **({"quality": quality, "optimize": True} if fmt == "JPEG" else {"optimize": True}))
        return buf.getvalue(), out.width, out.height, ".jpg" if fmt == "JPEG" else ".png"


def run_resize(params: dict) -> None:
    v = read_version(params)
    _need(v, "image")
    size = get_param(params, "size", int, 224)
    if not 8 <= size <= 2048:
        raise ParamError("size must be between 8 and 2048 pixels.")
    mode = get_param(params, "mode", str, "crop")
    if mode not in MODES:
        raise ParamError(f"mode must be one of {', '.join(MODES)}.")
    fmt_name = get_param(params, "format", str, "jpeg")
    if fmt_name not in ("jpeg", "png"):
        raise ParamError("format must be 'jpeg' or 'png'.")
    fmt = "JPEG" if fmt_name == "jpeg" else "PNG"
    quality = get_param(params, "quality", int, 90)
    ds = v.path.parent
    done: dict = {}
    new_paths, widths, heights, failed = [], [], [], 0
    progress = Progress("files", v.df.height)
    for i, (rel, w, h) in enumerate(v.df.select("image", "width", "height").iter_rows(), 1):
        if rel not in done:
            try:
                data, nw, nh, ext = _resized(media.resolve(ds, rel), size, mode, fmt, quality)
                done[rel] = (media.put(ds, data, ext), nw, nh)
            except Exception:  # noqa: BLE001
                done[rel] = None
        got = done[rel]
        if got is None:
            failed += 1
            new_paths.append(None)
            widths.append(None)
            heights.append(None)
        else:
            new_paths.append(got[0])
            widths.append(got[1])
            heights.append(got[2])
        progress.update(i)
    progress.finish()
    df = v.df.with_columns(pl.Series("image", new_paths, pl.String), pl.Series("width", widths, pl.Int64), pl.Series("height", heights, pl.Int64))
    df = df.filter(pl.col("image").is_not_null())
    how = {"crop": "edges cut to fill the square", "pad": "black bars to fill the square", "stretch": "stretched to the square"}.get(mode, "")
    notes = [f"Every picture is now {size} × {size} pixels ({how}), saved as {fmt_name.upper()}."]
    if mode == "fit":
        notes = [f"The longest side of every image is now {size} pixels; shapes are kept. Saved as {fmt_name.upper()}."]
    if failed:
        notes.append(f"{fmt_int(failed)} images could not be read and were left out.")
    protocol.log(f"Resized {fmt_int(len([x for x in done.values() if x]))} images.")
    write_version(v, df, params, op="resize", removed=failed, changed=df.height, notes=notes)


# ---------- resample ----------


def run_resample(params: dict) -> None:
    import numpy as np

    v = read_version(params)
    _need(v, "audio")
    rate = get_param(params, "sampleRate", int, 16000)
    if not 4000 <= rate <= 96000:
        raise ParamError("sampleRate must be between 4,000 and 96,000.")
    mono = get_param(params, "mono", bool, True)
    fmt = get_param(params, "format", str, "flac")
    if fmt not in ("flac", "wav"):
        raise ParamError("format must be 'flac' or 'wav'.")
    ds = v.path.parent
    done: dict = {}
    progress = Progress("files", v.df.height)
    out_rows = []
    failed = 0
    for i, row in enumerate(v.df.select("audio", "sample_rate", "channels").iter_rows(), 1):
        rel, sr, ch = row
        if rel not in done:
            try:
                samples, src_rate = media.read_audio(media.resolve(ds, rel))
                if mono and samples.shape[1] > 1:
                    samples = samples.mean(axis=1, keepdims=True)
                samples = np.clip(media.resample(samples, src_rate, rate), -1.0, 1.0)
                data = media.write_audio(samples, rate, fmt)
                done[rel] = (media.put(ds, data, "." + fmt), rate, int(samples.shape[1]), round(samples.shape[0] / rate, 3))
            except Exception:  # noqa: BLE001
                done[rel] = None
        got = done[rel]
        failed += got is None
        out_rows.append(got or (None, None, None, None))
        progress.update(i)
    progress.finish()
    df = v.df.with_columns(
        pl.Series("audio", [r[0] for r in out_rows], pl.String),
        pl.Series("sample_rate", [r[1] for r in out_rows], pl.Int64),
        pl.Series("channels", [r[2] for r in out_rows], pl.Int64),
        pl.Series("duration", [r[3] for r in out_rows], pl.Float64),
    ).filter(pl.col("audio").is_not_null())
    notes = [f"Every clip is now {fmt_int(rate)} samples a second{', one channel' if mono else ''}, saved as {fmt.upper()}."]
    if failed:
        notes.append(f"{fmt_int(failed)} clips could not be read and were left out.")
    write_version(v, df, params, op="resample", removed=failed, changed=df.height, notes=notes)


# ---------- augment ----------


def _augment_image(path, rng, flip, rotate, brightness, crop):
    from PIL import Image, ImageEnhance

    with Image.open(path) as im:
        fmt = im.format or "PNG"
        im = im.convert("L" if im.mode in ("L", "1") else "RGB")
        changes = []
        if flip and rng.random() < 0.5:
            im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            changes.append("flipped")
        if rotate:
            deg = rng.uniform(-rotate, rotate)
            im = im.rotate(deg, resample=Image.Resampling.BILINEAR, fillcolor=0 if im.mode == "L" else (0, 0, 0))
            changes.append(f"turned {deg:+.0f}°")
        if brightness:
            f = 1 + rng.uniform(-brightness, brightness)
            im = ImageEnhance.Brightness(im).enhance(f)
            changes.append("lighter" if f > 1 else "darker")
        if crop:
            w, h = im.size
            cw, ch = int(w * (1 - rng.uniform(0, crop))), int(h * (1 - rng.uniform(0, crop)))
            x, y = rng.randint(0, w - cw), rng.randint(0, h - ch)
            im = im.crop((x, y, x + cw, y + ch)).resize((w, h), Image.Resampling.BILINEAR)
            changes.append("cropped")
        buf = io.BytesIO()
        out_fmt = "JPEG" if fmt == "JPEG" else "PNG"
        im.save(buf, format=out_fmt, **({"quality": 90} if out_fmt == "JPEG" else {}))
        return buf.getvalue(), im.width, im.height, ".jpg" if out_fmt == "JPEG" else ".png"


def _augment_audio(path, rng, noise, gain, speed):
    import numpy as np

    samples, rate = media.read_audio(path)
    if speed:
        f = 1 + rng.uniform(-speed, speed)
        samples = media.resample(samples, int(rate * f), rate)  # faster or slower, pitch with it
    if gain:
        samples = samples * (1 + rng.uniform(-gain, gain))
    if noise:
        samples = samples + np.random.default_rng(rng.randint(0, 2**31)).normal(0, noise, samples.shape).astype("float32")
    samples = np.clip(samples, -1.0, 1.0)
    return media.write_audio(samples, rate, "flac"), rate, samples.shape[1], round(samples.shape[0] / rate, 3)


def run_augment(params: dict) -> None:
    v = read_version(params)
    kind = v.modality
    if kind not in ("image", "audio"):
        raise ParamError("Augment works on images and audio.", "WRONG_KIND")
    media.require(kind)
    copies = get_param(params, "copies", int, 1)
    if not 1 <= copies <= 5:
        raise ParamError("copies must be between 1 and 5.")
    rng = random.Random(get_param(params, "seed", int, 42))
    df = v.df
    has_split = "_split" in df.columns and df["_split"].null_count() < df.height
    pool = df.filter(pl.col("_split").fill_null("train") == "train") if has_split else df
    pool = pool.filter(~pl.col("_flags").list.contains("augmented"))
    ds = v.path.parent
    new_rows, failed = [], 0
    progress = Progress("files", pool.height * copies)
    k = 0
    for row in pool.iter_rows(named=True):
        for c in range(copies):
            k += 1
            try:
                if kind == "image":
                    data, w, h, ext = _augment_image(media.resolve(ds, row["image"]), rng, get_param(params, "flip", bool, True),
                                                     float(get_param(params, "rotate", (int, float), 10)), float(get_param(params, "brightness", (int, float), 0.2)),
                                                     float(get_param(params, "crop", (int, float), 0.1)))
                    extra = {"image": media.put(ds, data, ext), "width": w, "height": h}
                else:
                    data, sr, ch, dur = _augment_audio(media.resolve(ds, row["audio"]), rng, float(get_param(params, "noise", (int, float), 0.003)),
                                                       float(get_param(params, "gain", (int, float), 0.2)), float(get_param(params, "speed", (int, float), 0.1)))
                    extra = {"audio": media.put(ds, data, ".flac"), "sample_rate": sr, "channels": ch, "duration": dur}
            except Exception:  # noqa: BLE001
                failed += 1
                continue
            new = {**row, **extra, "_id": f"{row['_id']}-a{c + 1}", "_flags": list(row["_flags"] or []) + ["augmented"]}
            new_rows.append(new)
            progress.update(k)
    progress.finish()
    if not new_rows:
        raise CdataError("NOTHING_MADE", "No new examples could be made.")
    added = pl.DataFrame(new_rows, schema=df.schema)
    out = pl.concat([df, added])
    notes = [f"Added {fmt_int(added.height)} changed copies ({copies} per row), marked 'augmented'."]
    notes.append("Only train rows were copied; validation and test keep the real examples." if has_split else "Split before augmenting, or a copy could end up in test.")
    if failed:
        notes.append(f"{fmt_int(failed)} files could not be changed.")
    write_version(v, out, params, op="augment", changed=added.height, notes=notes)
