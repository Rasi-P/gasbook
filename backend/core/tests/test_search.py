from decimal import Decimal

from core.models import CustomerProfile, Sale, User
from core.services import user_search_q

from .base import PASSWORD, GasBookTestCase


class CustomerAndSaleSearchTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        qa_user = User.objects.create_user(
            username="qacustomer867693",
            password=PASSWORD,
            role=self.customer_role,
            first_name="QA",
            last_name="customer 867693",
            phone="9000086769",
        )
        self.qa = CustomerProfile.objects.create(user=qa_user)
        self.qa_sale = Sale.objects.create(
            customer=self.qa,
            location=self.shop,
            total_amount=Decimal("900.00"),
            balance_due=Decimal("900.00"),
            payment_mode=Sale.PaymentMode.CREDIT,
            sold_by=self.admin,
        )
        self.other_sale = Sale.objects.create(
            customer=self.customer,
            location=self.shop,
            total_amount=Decimal("100.00"),
            balance_due=Decimal("0"),
            paid_amount=Decimal("100.00"),
            payment_mode=Sale.PaymentMode.CASH,
            sold_by=self.admin,
        )
        self.auth(self.admin)

    def customer_ids(self, term):
        response = self.client.get("/api/customers/", {"search": term} if term is not None else {})
        self.assertEqual(response.status_code, 200, response.data)
        return sorted(row["id"] for row in response.json()["results"])

    def sale_ids(self, term):
        response = self.client.get("/api/sales/", {"search": term})
        self.assertEqual(response.status_code, 200, response.data)
        return sorted(row["id"] for row in response.json()["results"])

    def test_multi_word_search_spans_first_and_last_name(self):
        self.assertEqual(self.customer_ids("QA Customer"), [self.qa.id])
        self.assertEqual(self.customer_ids("customer 867693"), [self.qa.id])
        self.assertEqual(self.customer_ids("  qa   CUSTOMER  "), [self.qa.id])

    def test_username_and_phone_tokens_match(self):
        self.assertEqual(self.customer_ids("qacustomer"), [self.qa.id])
        self.assertEqual(self.customer_ids("90000867"), [self.qa.id])
        self.assertEqual(self.customer_ids("cust1"), [self.customer.id])

    def test_tokens_are_anded(self):
        self.assertEqual(self.customer_ids("QA Nobody"), [])
        self.assertEqual(self.customer_ids("QA 9000000004"), [])  # phone belongs to the other customer

    def test_empty_or_whitespace_search_returns_everything(self):
        everything = sorted([self.qa.id, self.customer.id])
        self.assertEqual(self.customer_ids(None), everything)
        self.assertEqual(self.customer_ids(""), everything)
        self.assertEqual(self.customer_ids("   "), everything)

    def test_sales_search_uses_the_same_rules(self):
        self.assertEqual(self.sale_ids("QA Customer"), [self.qa_sale.id])
        self.assertEqual(self.sale_ids("qacustomer867693"), [self.qa_sale.id])
        self.assertEqual(self.sale_ids("Cust One"), [self.other_sale.id])
        self.assertEqual(self.sale_ids("QA One"), [])

    def test_user_search_q_helper(self):
        self.assertEqual(
            set(User.objects.filter(user_search_q("Staff B")).values_list("username", flat=True)), {"staffb"}
        )
        self.assertEqual(
            set(User.objects.filter(user_search_q("staff")).values_list("username", flat=True)), {"staffa", "staffb"}
        )
        # Empty Q matches everything.
        self.assertEqual(User.objects.filter(user_search_q("")).count(), User.objects.count())
