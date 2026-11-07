"""Staff photos are visible to their owner and business administrators only."""
def may_view_staff_image(user, profile):
    return bool(user and user.is_authenticated and user.is_active
        and not getattr(user, "must_change_password", False)
        and (user.is_superuser or getattr(getattr(user, "role", None), "code", "") == "admin"
             or user.pk == profile.user_id))
