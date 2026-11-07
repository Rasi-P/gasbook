"""Delete replaced files only after commit; failed cleanup never undoes a save."""
from contextvars import ContextVar
import hashlib
import logging
from django.db import transaction
from django.db.models.signals import pre_save, post_save, post_delete
from django.dispatch import receiver
from .models import CylinderType, Product, StaffProfile

logger = logging.getLogger(__name__)
MEDIA_MODELS = (CylinderType, Product, StaffProfile)
request_uploads = ContextVar("request_uploads", default=None)


def delete_after_commit(storage, name, using="default"):
    if not name:
        return
    transaction.on_commit(lambda: cleanup_unreferenced(storage, name, using), using=using, robust=True)


def cleanup_unreferenced(storage, name, using="default"):
    try:
        # Covers legacy shared references and uploads whose database write rolled back.
        if any(model.objects.using(using).filter(image=name).exists() for model in MEDIA_MODELS):
            return
        storage.delete(name)
    except Exception:
        logger.warning("media_cleanup_pending reference_sha256=%s", hashlib.sha256(name.encode()).hexdigest())


@receiver(pre_save)
def remember_image(sender, instance, using, raw=False, **kwargs):
    if sender not in MEDIA_MODELS or raw:
        return
    instance._previous_image = sender.objects.using(using).filter(pk=instance.pk).values_list("image", flat=True).first() if instance.pk else None


@receiver(post_save)
def replaced_image(sender, instance, using, raw=False, **kwargs):
    if sender not in MEDIA_MODELS or raw:
        return
    previous = getattr(instance, "_previous_image", None)
    if previous and previous != instance.image.name:
        delete_after_commit(instance.image.storage, previous, using)


@receiver(post_delete)
def removed_image(sender, instance, using, **kwargs):
    if sender in MEDIA_MODELS:
        delete_after_commit(instance.image.storage, instance.image.name, using)
