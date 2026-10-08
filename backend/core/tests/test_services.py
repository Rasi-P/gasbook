from decimal import Decimal

from core.exceptions import ApiError
from core.models import Notification
from core.services import clean_reason, notify, parse_money, parse_non_negative_int

from .base import GasBookTestCase


class NotifyTests(GasBookTestCase):
    def test_truncates_title_and_body_with_ellipsis(self):
        booking = self.make_booking()
        note = notify(self.customer_user, booking, "T", "x" * 200, "y" * 400, dedupe=False)
        self.assertEqual(len(note.title), 120)
        self.assertTrue(note.title.endswith("…"))
        self.assertEqual(len(note.body), 300)
        self.assertTrue(note.body.endswith("…"))
        note.refresh_from_db()
        self.assertEqual(len(note.body), 300)

    def test_short_values_untouched(self):
        note = notify(self.customer_user, None, "T", "Hello", "World", dedupe=False)
        self.assertEqual((note.title, note.body), ("Hello", "World"))

    def test_dedupe(self):
        booking = self.make_booking()
        first = notify(self.customer_user, booking, "ORDER_PLACED", "a", "b", dedupe=True)
        self.assertIsNotNone(first)
        self.assertIsNone(notify(self.customer_user, booking, "ORDER_PLACED", "a", "b", dedupe=True))
        self.assertEqual(Notification.objects.filter(booking=booking).count(), 1)
        again = notify(self.customer_user, booking, "ORDER_PLACED", "a", "b", dedupe=False)
        self.assertIsNotNone(again)
        self.assertEqual(Notification.objects.filter(booking=booking).count(), 2)


class CleanReasonTests(GasBookTestCase):
    def assert_api_error(self, fn, code, **expected):
        with self.assertRaises(ApiError) as ctx:
            fn()
        detail = ctx.exception.detail
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(detail["code"], code)
        for key, value in expected.items():
            self.assertEqual(detail[key], value)
        return detail

    def test_required(self):
        for raw in (None, "", "   "):
            self.assert_api_error(lambda: clean_reason(raw, 250), "required", field="reason")

    def test_non_string(self):
        self.assert_api_error(lambda: clean_reason(123, 250), "invalid", field="reason")
        self.assert_api_error(lambda: clean_reason(["x"], 250), "invalid", field="reason")

    def test_max_length_payload(self):
        detail = self.assert_api_error(lambda: clean_reason("x" * 251, 250), "max_length", field="reason", max_length=250)
        self.assertIn("250", detail["detail"])
        self.assertEqual(clean_reason("x" * 250, 250), "x" * 250)

    def test_strips(self):
        self.assertEqual(clean_reason("  too far  ", 200), "too far")


class ParseHelperTests(GasBookTestCase):
    def test_parse_non_negative_int(self):
        self.assertEqual(parse_non_negative_int("3", "f", "F"), 3)
        self.assertEqual(parse_non_negative_int(0, "f", "F"), 0)
        self.assertEqual(parse_non_negative_int(None, "f", "F"), 0)
        self.assertEqual(parse_non_negative_int("", "f", "F"), 0)
        for raw in ("-1", "1.5", True, "abc", -2, 1.5):
            with self.assertRaises(ApiError) as ctx:
                parse_non_negative_int(raw, "empty_collected", "Empty cylinders collected")
            self.assertEqual(ctx.exception.detail["code"], "invalid")
            self.assertEqual(ctx.exception.detail["field"], "empty_collected")

    def test_parse_money(self):
        self.assertEqual(parse_money("12.50", "f", "F"), Decimal("12.50"))
        self.assertEqual(parse_money(10, "f", "F"), Decimal("10"))
        self.assertEqual(parse_money(None, "f", "F"), Decimal("0"))
        for raw in ("abc", "NaN", True, "Infinity"):
            with self.assertRaises(ApiError) as ctx:
                parse_money(raw, "payment_collected", "Collected amount")
            self.assertEqual(ctx.exception.detail["code"], "invalid")
            self.assertEqual(ctx.exception.detail["field"], "payment_collected")
