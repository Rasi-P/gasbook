from core.models import Booking

from .base import GasBookTestCase


class PageSizeParamTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        for _ in range(25):
            self.make_booking(status=Booking.Status.PENDING)
        self.auth(self.admin)

    def test_default_page_size_is_unchanged(self):
        response = self.client.get("/api/bookings/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["count"], 25)
        self.assertEqual(len(body["results"]), 10)
        self.assertIn("page=2", body["next"])

    def test_page_size_param_is_honoured(self):
        response = self.client.get("/api/bookings/?page_size=5")
        body = response.json()
        self.assertEqual(len(body["results"]), 5)
        self.assertIn("page=2", body["next"])
        self.assertIn("page_size=5", body["next"])
        self.assertIsNone(body["previous"])

        response = self.client.get("/api/bookings/?page_size=200")
        body = response.json()
        self.assertEqual(body["count"], 25)
        self.assertEqual(len(body["results"]), 25)
        self.assertIsNone(body["next"])

    def test_page_size_is_capped_at_200_and_invalid_values_fall_back(self):
        for _ in range(180):
            self.make_booking(status=Booking.Status.PENDING)
        response = self.client.get("/api/bookings/?page_size=999")
        body = response.json()
        self.assertEqual(body["count"], 205)
        self.assertEqual(len(body["results"]), 200)
        self.assertIsNotNone(body["next"])

        response = self.client.get("/api/bookings/?page_size=abc")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 10)

    def test_other_list_endpoints_use_the_same_class(self):
        self.set_stock(self.shop, filled=3, empty=1)
        response = self.client.get("/api/stock/?page_size=200")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 2)
        response = self.client.get("/api/customers/?page_size=1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 1)
