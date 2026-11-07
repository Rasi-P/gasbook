"""Filesystem media with quality-first image processing.

Names are random, so a cached URL never changes meaning and the uploader's filename (which may
identify a person) is not kept. The extension is chosen after processing, since WebP conversion
can change the format.
"""
import posixpath
import uuid

from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage

from .image_processing import MAX_SIDE, prepare_image
from .uploads import MAX_IMAGE_BYTES


class MediaFileSystemStorage(FileSystemStorage):
    def generate_filename(self, filename):
        # Keep the parent's traversal checks, then discard the client-supplied basename.
        folder = posixpath.dirname(super().generate_filename(filename))
        return posixpath.join(folder, uuid.uuid4().hex)

    def _save(self, name, content):
        folder, base = posixpath.split(name)
        if folder.split("/", 1)[0] in MAX_SIDE:
            content.seek(0)
            data, extension = prepare_image(content.read(MAX_IMAGE_BYTES + 1), folder.split("/", 1)[0])
            name = posixpath.join(folder, posixpath.splitext(base)[0] + "." + extension)
            content = ContentFile(data)
        name = super()._save(name, content)
        from .media_lifecycle import request_uploads
        pending = request_uploads.get()
        if pending is not None:
            # Removed after the response if the request's database write never referenced the file.
            pending.append((self, name))
        return name
