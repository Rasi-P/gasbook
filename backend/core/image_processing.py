"""Quality-first policy for the stored copy of an uploaded image.

Uploads are already validated by core.uploads. An image is kept byte-for-byte unless it must
change: it needs its EXIF rotation applied, carries metadata (GPS, device) that should not be
published, exceeds its category's size, or is a large opaque PNG that WebP shrinks a lot without
visible loss. Lossy output is produced once, from the decoded original, so quality never degrades
by repetition: an already-processed image passes through unchanged.
"""
from io import BytesIO
import logging
import threading

from PIL import Image, ImageChops, ImageOps, ImageStat

from .uploads import inspect_image

logger = logging.getLogger(__name__)

MAX_SIDE = {"staff-images": 500, "product-images": 1200, "cylinder-images": 1200}
# Shrinking 1254px to 1200px costs sharpness for no practical gain.
SIDE_TOLERANCE = 1.10
CONVERT_MIN_BYTES = 300 * 1024
CONVERT_MIN_SAVING = 0.40
# Visually lossless at normal viewing (about 38.6 dB); anything worse keeps the original.
MAX_RMS_ERROR = 3.0
JPEG_QUALITY = 92
WEBP_QUALITY = 95
EXTENSIONS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
ORIENTATION = 0x0112

# A maximum-size decode needs ~70 MB; one slot keeps a 512 MB instance safe from concurrent uploads.
_slot = threading.BoundedSemaphore(1)


def prepare_image(data, category):
    """Return (bytes, extension) to store for an upload. Raises ValueError if it is not a valid image."""
    image_format = inspect_image(data).format
    try:
        with _slot:
            result = _prepare(data, image_format, MAX_SIDE.get(category))
            if result is not None:
                inspect_image(result[0])
    except Exception:
        # The original already passed validation, so a processing failure must not lose the upload.
        logger.warning("media_processing_skipped format=%s", image_format)
        result = None
    return result or (data, EXTENSIONS[image_format])


def _prepare(data, image_format, limit):
    with Image.open(BytesIO(data), formats=[image_format]) as source:
        if getattr(source, "n_frames", 1) > 1:
            return None  # flattening an animation to one frame would destroy it
        source.load()
        exif = source.getexif()
        oriented = exif.get(ORIENTATION, 1) != 1
        has_metadata = bool(exif) or "xmp" in source.info or "XML:com.adobe.xmp" in source.info
        oversized = bool(limit) and max(source.size) > limit * SIDE_TOLERANCE
        alpha = _has_alpha(source)
        changed = oriented or has_metadata or oversized
        convertible = image_format == "PNG" and len(data) > CONVERT_MIN_BYTES
        if not changed and not convertible:
            return None

        icc = source.info.get("icc_profile")
        picture = ImageOps.exif_transpose(source) if oriented else source
        if changed:
            picture = _normalized(picture, alpha)
        if oversized:
            picture.thumbnail((limit, limit), Image.Resampling.LANCZOS)

        if image_format == "JPEG":
            # Reusing the source's quantization tables re-encodes metadata-only changes with minimal loss.
            # A resized picture is new content, so it gets the intended quality instead.
            keep = picture is source and not oversized and source.mode in ("RGB", "L")
            return _encode(picture, "JPEG", icc, optimize=True, progressive=True,
                           **({"quality": "keep", "subsampling": "keep"} if keep else {"quality": JPEG_QUALITY})), "jpg"
        if image_format == "WEBP":
            lossless = data[12:16] == b"VP8L"
            return _encode(picture, "WEBP", icc, **({"lossless": True} if lossless else {"quality": WEBP_QUALITY})), "webp"
        return _png(picture, icc, alpha, len(data), changed)


def _png(picture, icc, alpha, original_size, changed):
    png = _encode(picture, "PNG", icc, optimize=True) if changed else None
    if alpha:
        webp = _encode(_normalized(picture, True), "WEBP", icc, lossless=True)
    else:
        rgb = _normalized(picture, False)
        webp = _encode(rgb, "WEBP", icc, quality=WEBP_QUALITY)
        with Image.open(BytesIO(webp), formats=["WEBP"]) as decoded:
            if _rms_error(rgb, decoded) > MAX_RMS_ERROR:
                webp = None
    reference = len(png) if png is not None else original_size
    if webp is not None and len(webp) <= reference * (1 - CONVERT_MIN_SAVING):
        return webp, "webp"
    return (png, "png") if png is not None else None


def _has_alpha(image):
    if "transparency" in image.info:
        return True
    if image.mode in ("RGBA", "LA", "PA"):
        return image.getchannel("A").getextrema()[0] < 255
    return False


def _normalized(picture, alpha):
    """Palette and exotic modes resample badly and are not all encodable; convert them once."""
    if picture.mode in ("RGB", "L") or (alpha and picture.mode == "RGBA"):
        return picture
    return picture.convert("RGBA" if alpha else "RGB")


def _rms_error(a, b):
    return max(ImageStat.Stat(ImageChops.difference(a.convert("RGB"), b.convert("RGB"))).rms)


def _encode(picture, image_format, icc, **options):
    if icc:
        options["icc_profile"] = icc
    output = BytesIO()
    picture.save(output, image_format, **options)
    return output.getvalue()
