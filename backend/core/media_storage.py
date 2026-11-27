"""ImageKit-backed media. Staff originals are encrypted before leaving Django.

The ImageField stores category/provider-id/object-name (under 100 characters),
so replacement/deletion needs no schema change or provider search. No local cache.
"""
from io import BytesIO
import logging
import re
import time
import uuid
from urllib.parse import quote, urlsplit

from cryptography.fernet import Fernet
from django.conf import settings
from django.core.files.base import File
from django.core.files.storage import Storage
from django.utils.deconstruct import deconstructible
import httpx
from imagekitio import ImageKit

from .uploads import MAX_IMAGE_BYTES, inspect_image

logger = logging.getLogger(__name__)
PREFIXES = {"cylinder-images", "product-images", "staff-images"}
REMOTE_NAME = re.compile(r"(cylinder-images|product-images|staff-images)/([A-Za-z0-9_-]{1,32})/([a-f0-9]{32}\.(?:png|jpg|webp|bin))\Z")
NAMESPACE = "/gasbook-demo"
MAX_REMOTE_BYTES = 4 * ((MAX_IMAGE_BYTES + 128) // 3 + 1)


class MediaUnavailable(Exception):
    def __init__(self):
        super().__init__("Image storage is temporarily unavailable. Your previous image has been kept; reload before retrying.")


@deconstructible
class ImageKitStorage(Storage):
    def client(self):
        # No automatic upload retries: an unknown result must not duplicate files.
        return ImageKit(private_key=settings.IMAGEKIT_PRIVATE_KEY, timeout=10.0, max_retries=0)

    def cipher(self):
        return Fernet(settings.MEDIA_ENCRYPTION_KEY.encode("ascii"))

    def get_available_name(self, name, max_length=None):
        # _save creates a UUID; never probe or overwrite an existing object.
        return name

    def exists(self, name):
        raise NotImplementedError("Remote existence must not be inferred from a name.")

    def _save(self, name, content):
        if settings.DEMO_DISABLE_UPLOADS:
            from django.core.exceptions import PermissionDenied
            raise PermissionDenied("Image uploads are disabled.")
        prefix = name.split("/", 1)[0]
        if prefix not in PREFIXES:
            raise ValueError("Unsupported media category.")
        content.seek(0)
        data = content.read(MAX_IMAGE_BYTES + 1)
        image = inspect_image(data)  # defense in depth for model/Admin writes
        ext = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}[image.format]
        if prefix == "staff-images":
            data, ext = self.cipher().encrypt(data), "bin"
        filename = uuid.uuid4().hex + "." + ext
        folder = NAMESPACE + "/" + prefix
        try:
            with self.client() as client:
                result = client.files.upload(file=data, file_name=filename, folder=folder,
                    use_unique_file_name=False, overwrite_file=False, is_private_file=True)
            if (not result.file_id or not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", result.file_id)
                    or result.file_path != folder + "/" + filename or result.is_private_file is not True):
                raise ValueError("Unexpected upload response")
            name = prefix + "/" + result.file_id + "/" + filename
            from .media_lifecycle import request_uploads
            pending = request_uploads.get()
            if pending is not None:
                pending.append((self, name))
            return name
        except Exception:
            # Provider messages may contain signed URLs/keys. Do not log them.
            logger.warning("media_upload_failed outcome_may_be_unknown")
            raise MediaUnavailable() from None

    def _parts(self, name):
        match = REMOTE_NAME.fullmatch(name)
        if not match:
            # Legacy names are not assumed to exist in this remote library.
            raise FileNotFoundError("Media reference requires migration or replacement.")
        prefix, file_id, filename = match.groups()
        if (prefix == "staff-images") != filename.endswith(".bin"):
            raise FileNotFoundError("Invalid private-media reference.")
        return prefix, file_id, filename

    def _open(self, name, mode="rb"):
        if mode != "rb":
            raise ValueError("Media is read-only through open().")
        prefix, _file_id, filename = self._parts(name)
        try:
            with self.client() as client:
                url = client.helper.build_url(url_endpoint=settings.IMAGEKIT_URL_ENDPOINT,
                    src=NAMESPACE + "/" + prefix + "/" + filename, signed=True, expires_in=60)
            target, endpoint = urlsplit(url), urlsplit(settings.IMAGEKIT_URL_ENDPOINT)
            if (target.scheme != "https" or target.netloc != endpoint.netloc or target.username
                    or target.path != endpoint.path + NAMESPACE + "/" + prefix + "/" + filename):
                raise ValueError("Invalid delivery target")
            started, data = time.monotonic(), bytearray()
            # No redirects, credentials, proxy environment, or provider URLs in responses.
            with httpx.Client(timeout=10.0, follow_redirects=False, trust_env=False) as client:
                with client.stream("GET", url) as response:
                    if response.status_code == 404:
                        raise FileNotFoundError("Image is unavailable.")
                    response.raise_for_status()
                    for chunk in response.iter_bytes(chunk_size=65536):
                        data.extend(chunk)
                        if len(data) > MAX_REMOTE_BYTES or time.monotonic() - started > 15:
                            raise ValueError("Media response exceeded limits")
            data = bytes(data)
            if prefix == "staff-images":
                data = self.cipher().decrypt(data)
            inspect_image(data)
            return File(BytesIO(data), name=name)
        except FileNotFoundError:
            raise
        except Exception:
            logger.warning("media_retrieval_failed")
            raise MediaUnavailable() from None

    def delete(self, name):
        _prefix, file_id, _filename = self._parts(name)
        try:
            with self.client() as client:
                client.files.delete(file_id)
        except Exception as exc:
            if getattr(exc, "status_code", None) != 404:
                raise MediaUnavailable() from None

    def url(self, name):
        # Preserve safe legacy references (including Django Admin's file widget).
        # Retrieval still returns 404 until the old file is explicitly migrated.
        if (name.split("/", 1)[0] not in PREFIXES or "\\" in name
                or any(part in {"", ".", ".."} for part in name.split("/"))):
            raise ValueError("Invalid media reference.")
        return "/media/" + quote(name, safe="/")
