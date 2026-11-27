from .base import GasBookTestCase


class ReportsDateValidationTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.auth(self.admin)

    def test_inverted_range_is_400_invalid_range(self):
        response = self.client.get("/api/reports/", {"start": "2026-10-08", "end": "2026-10-01"})
        self.assertEqual(response.status_code, 400, response.data)
        body = response.json()
        self.assertEqual(body["detail"], "Start date must be on or before end date.")
        self.assertEqual(body["code"], "invalid_range")
        self.assertEqual((body["start"], body["end"]), ("2026-10-08", "2026-10-01"))

    def test_malformed_dates_are_400_invalid_date(self):
        for params in ({"start": "foo"}, {"end": "2026-13-45"}, {"start": "08/10/2026", "end": "2026-10-08"}):
            response = self.client.get("/api/reports/", params)
            self.assertEqual(response.status_code, 400, (params, response.data))
            self.assertEqual(response.json(), {"detail": "Invalid date. Use YYYY-MM-DD.", "code": "invalid_date"})

    def test_valid_ranges_still_return_200(self):
        response = self.client.get("/api/reports/", {"start": "2026-10-01", "end": "2026-10-01"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["range"], {"start": "2026-10-01", "end": "2026-10-01"})

        response = self.client.get("/api/reports/", {"start": "2026-09-01", "end": "2026-10-08"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["range"], {"start": "2026-09-01", "end": "2026-10-08"})

        # No params: defaults to today.
        response = self.client.get("/api/reports/")
        self.assertEqual(response.status_code, 200, response.data)

    def test_reports_remain_admin_only(self):
        self.auth(self.staff_a)
        response = self.client.get("/api/reports/", {"start": "2026-10-08", "end": "2026-10-01"})
        self.assertEqual(response.status_code, 403)
