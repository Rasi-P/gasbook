"""No uploaded media is stored or served in the optional free demo."""
from django.core.exceptions import PermissionDenied
from django.core.files.storage import Storage


DEMO_IMAGE_MESSAGE = (
    "Image uploads are disabled for this demo. Save without a photo; "
    "the app uses its built-in images and placeholders."
)


class DisabledMediaStorage(Storage):
    """Defense in depth for writes that do not pass through API validation."""

    def _open(self, name, mode="rb"):
        raise FileNotFoundError("Uploaded media is unavailable in this demo.")

    def _save(self, name, content):
        raise PermissionDenied(DEMO_IMAGE_MESSAGE)

    def exists(self, name):
        return False

    def delete(self, name):
        # Never delete a pre-existing file when demo mode is enabled.
        pass

    def url(self, name):
        raise ValueError("Uploaded media is unavailable in this demo.")
