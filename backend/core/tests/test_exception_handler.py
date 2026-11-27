from django.db import DataError, IntegrityError
from django.db.models import ProtectedError
from django.test import override_settings
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from core.exceptions import ApiError, api_exception_handler


class ApiErrorTests(APITestCase):
    def test_api_error_body_keeps_native_types(self):
        exc = ApiError("Nope", code="insufficient_stock", available=1, required=2)
        self.assertEqual(exc.status_code, 400)
        self.assertEqual(exc.detail, {"detail": "Nope", "code": "insufficient_stock", "available": 1, "required": 2})
        self.assertIs(type(exc.detail["available"]), int)
        self.assertEqual(ApiError("x", code="forbidden", status=403).status_code, 403)

    def test_handler_maps_db_errors_directly(self):
        response = api_exception_handler(DataError("too long"), {})
        self.assertEqual((response.status_code, response.data["code"]), (400, "invalid_data"))
        response = api_exception_handler(IntegrityError("dup"), {})
        self.assertEqual((response.status_code, response.data["code"]), (409, "conflict"))
        response = api_exception_handler(ProtectedError("p", set()), {})
        self.assertEqual((response.status_code, response.data["code"]), (409, "protected"))
        self.assertIsNone(api_exception_handler(RuntimeError("boom"), {}))

    def test_handler_normalises_detail_list_and_always_sets_code(self):
        response = api_exception_handler(ValidationError({"detail": "Customer profile is required."}), {})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "Customer profile is required.")
        self.assertEqual(response.data["code"], "invalid")
        # an explicit code is preserved
        response = api_exception_handler(ValidationError({"detail": ["x"], "code": "custom"}), {})
        self.assertEqual((response.data["detail"], response.data["code"]), ("x", "custom"))


@override_settings(ROOT_URLCONF="core.tests.urls_errors")
class ExceptionHandlerEndToEndTests(APITestCase):
    def test_data_error_is_json_400(self):
        response = self.client.get("/test-errors/data/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response["Content-Type"], "application/json")
        self.assertEqual(response.json(), {"detail": "One of the submitted values is too long or invalid.", "code": "invalid_data"})

    def test_integrity_error_is_json_409(self):
        response = self.client.get("/test-errors/integrity/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "conflict")

    def test_protected_error_is_json_409(self):
        response = self.client.get("/test-errors/protected/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "protected")

    def test_field_validation_error_gains_detail_and_code(self):
        response = self.client.get("/test-errors/field-validation/")
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertEqual(body["phone"], ["Phone number must contain only digits."])
        self.assertEqual(body["detail"], "Phone number must contain only digits.")
        self.assertEqual(body["code"], "invalid")

    def test_detail_keyed_validation_error_is_string_with_code(self):
        response = self.client.get("/test-errors/detail-validation/")
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertEqual(body["detail"], "Customer profile is required to place an order.")
        self.assertEqual(body["code"], "invalid")

    def test_list_validation_error_becomes_dict(self):
        response = self.client.get("/test-errors/list-validation/")
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertEqual(body["detail"], "Not enough filled stock.")
        self.assertEqual(body["code"], "invalid")
        self.assertEqual(body["non_field_errors"], ["Not enough filled stock."])
