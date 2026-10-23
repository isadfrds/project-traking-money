import json

from django.contrib.auth.models import User
from django.test import TestCase

from .models import Goal, Transaction


class FinanceBase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("a@x.com", "a@x.com", "Passw0rd!xyz")
        self.other = User.objects.create_user("b@x.com", "b@x.com", "Passw0rd!xyz")
        self.client.login(username="a@x.com", password="Passw0rd!xyz")

    def post(self, path, data=None, method="post"):
        return getattr(self.client, method)(
            f"/api/{path}", json.dumps(data or {}), content_type="application/json"
        )

    def tx(self, tx_type, amount, name="x", day="2026-10-01"):
        return self.post(
            "transactions/",
            {"description": name, "type": tx_type, "category": "Lainnya",
             "amount": amount, "date": day},
        )

    def balance(self):
        from .views import get_balance
        return int(get_balance(self.user))


class BalanceRuleTests(FinanceBase):
    def test_expense_larger_than_balance_is_rejected(self):
        self.assertEqual(self.tx("income", 1_000_000).status_code, 201)
        res = self.tx("expense", 2_000_000)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Rp1.000.000", res.json()["message"])
        self.assertEqual(self.balance(), 1_000_000)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_expense_equal_to_balance_is_allowed(self):
        self.tx("income", 1_000_000)
        self.assertEqual(self.tx("expense", 1_000_000).status_code, 201)
        self.assertEqual(self.balance(), 0)

    def test_expense_with_zero_balance_rejected(self):
        res = self.tx("expense", 1)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Rp0", res.json()["message"])

    def test_edit_expense_cannot_overdraw(self):
        self.tx("income", 1_000_000)
        tx_id = self.tx("expense", 400_000).json()["id"]
        res = self.post(
            f"transactions/{tx_id}/",
            {"description": "x", "type": "expense", "category": "Lainnya",
             "amount": 1_000_001, "date": "2026-10-01"},
            method="put",
        )
        self.assertEqual(res.status_code, 400)
        ok = self.post(
            f"transactions/{tx_id}/",
            {"description": "x", "type": "expense", "category": "Lainnya",
             "amount": 1_000_000, "date": "2026-10-01"},
            method="put",
        )
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(self.balance(), 0)

    def test_edit_income_to_lower_cannot_overdraw(self):
        inc = self.tx("income", 1_000_000).json()["id"]
        self.tx("expense", 800_000)
        res = self.post(
            f"transactions/{inc}/",
            {"description": "x", "type": "income", "category": "Gaji",
             "amount": 500_000, "date": "2026-10-01"},
            method="put",
        )
        self.assertEqual(res.status_code, 400)

    def test_cannot_delete_income_that_was_spent(self):
        inc = self.tx("income", 1_000_000).json()["id"]
        self.tx("expense", 800_000)
        res = self.post(f"transactions/{inc}/", method="delete")
        self.assertEqual(res.status_code, 400)
        self.assertTrue(Transaction.objects.filter(pk=inc).exists())

    def test_can_delete_expense_and_unspent_income(self):
        inc = self.tx("income", 1_000_000).json()["id"]
        exp = self.tx("expense", 800_000).json()["id"]
        self.assertEqual(self.post(f"transactions/{exp}/", method="delete").status_code, 200)
        self.assertEqual(self.post(f"transactions/{inc}/", method="delete").status_code, 200)

    def test_legacy_negative_balance_can_still_be_fixed(self):
        # data lama yang sudah minus: menghapus pengeluaran tidak boleh diblokir
        Transaction.objects.create(user=self.user, description="old", type="expense",
                                   category="x", amount=500, date="2026-10-01")
        exp = Transaction.objects.first().id
        self.assertEqual(self.post(f"transactions/{exp}/", method="delete").status_code, 200)

    def test_validation(self):
        self.assertEqual(self.tx("income", 0).status_code, 400)
        self.assertEqual(self.tx("income", -5).status_code, 400)
        self.assertEqual(self.tx("income", 10.5).status_code, 400)
        self.assertEqual(self.tx("income", "abc").status_code, 400)
        self.assertEqual(self.tx("income", 10**15).status_code, 400)
        self.assertEqual(self.tx("transfer", 5).status_code, 400)

    def test_users_are_isolated(self):
        self.tx("income", 1_000_000)
        Transaction.objects.create(user=self.other, description="o", type="income",
                                   category="x", amount=9, date="2026-10-01")
        listed = self.client.get("/api/transactions/").json()["transactions"]
        self.assertEqual(len(listed), 1)
        other_id = Transaction.objects.filter(user=self.other).first().id
        self.assertEqual(self.post(f"transactions/{other_id}/", method="delete").status_code, 404)

    def test_requires_login(self):
        self.client.logout()
        self.assertEqual(self.client.get("/api/transactions/").status_code, 401)
        self.assertEqual(self.client.get("/api/goals/").status_code, 401)


class GoalTests(FinanceBase):
    def make_goal(self, target=5_000_000):
        return self.post("goals/", {"name": "Laptop", "target_amount": target}).json()["id"]

    def test_deposit_withdraw_delete_flow(self):
        self.tx("income", 1_000_000)
        gid = self.make_goal()

        res = self.post(f"goals/{gid}/deposit/", {"amount": 600_000})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["saved_amount"], 600_000)
        self.assertEqual(self.balance(), 400_000)

        # tidak bisa setor lebih dari saldo
        over = self.post(f"goals/{gid}/deposit/", {"amount": 400_001})
        self.assertEqual(over.status_code, 400)
        self.assertIn("Rp400.000", over.json()["message"])

        # tidak bisa tarik lebih dari dana target
        self.assertEqual(self.post(f"goals/{gid}/withdraw/", {"amount": 600_001}).status_code, 400)
        res = self.post(f"goals/{gid}/withdraw/", {"amount": 100_000})
        self.assertEqual(res.json()["saved_amount"], 500_000)
        self.assertEqual(self.balance(), 500_000)

        listed = self.client.get("/api/goals/").json()["goals"]
        self.assertEqual(listed[0]["saved_amount"], 500_000)

        # hapus target -> dana kembali ke saldo
        self.assertEqual(self.post(f"goals/{gid}/", method="delete").status_code, 200)
        self.assertEqual(self.balance(), 1_000_000)
        self.assertEqual(Transaction.objects.filter(goal__isnull=False).count(), 0)

    def test_goal_transactions_are_locked(self):
        self.tx("income", 1_000_000)
        gid = self.make_goal()
        self.post(f"goals/{gid}/deposit/", {"amount": 100_000})
        tx_id = Transaction.objects.get(goal_id=gid).id
        self.assertEqual(self.post(f"transactions/{tx_id}/", method="delete").status_code, 400)

    def test_cannot_touch_other_users_goal(self):
        g = Goal.objects.create(user=self.other, name="x", target_amount=10)
        self.tx("income", 100)
        self.assertEqual(self.post(f"goals/{g.id}/deposit/", {"amount": 5}).status_code, 404)
        self.assertEqual(self.post(f"goals/{g.id}/", method="delete").status_code, 404)

    def test_goal_validation(self):
        self.assertEqual(self.post("goals/", {"name": "", "target_amount": 10}).status_code, 400)
        self.assertEqual(self.post("goals/", {"name": "a", "target_amount": 0}).status_code, 400)


class ResetRestoreTests(FinanceBase):
    def test_reset_and_restore_roundtrip_with_goals(self):
        self.tx("income", 2_000_000)
        gid = self.post("goals/", {"name": "HP", "target_amount": 3_000_000}).json()["id"]
        self.post(f"goals/{gid}/deposit/", {"amount": 700_000})
        self.post("budget/", {"period": "biweekly", "amount": 500_000}, method="put")

        backup = {
            "transactions": self.client.get("/api/transactions/").json()["transactions"],
            "goals": self.client.get("/api/goals/").json()["goals"],
            "budget": self.client.get("/api/budget/").json()["budget"],
        }
        self.assertEqual(backup["budget"]["period"], "biweekly")

        self.assertEqual(self.post("reset/").status_code, 200)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(Goal.objects.count(), 0)

        self.assertEqual(self.post("restore/", backup).status_code, 200)
        self.assertEqual(self.balance(), 1_300_000)
        goal = self.client.get("/api/goals/").json()["goals"][0]
        self.assertEqual(goal["saved_amount"], 700_000)

    def test_restore_rejects_negative_balance(self):
        bad = {"transactions": [
            {"description": "x", "type": "expense", "category": "a",
             "amount": 100, "date": "2026-10-01"}]}
        self.assertEqual(self.post("restore/", bad).status_code, 400)

    def test_restore_ignores_garbage_goal_id(self):
        data = {"transactions": [
            {"description": "x", "type": "income", "category": "a",
             "amount": 100, "date": "2026-10-01", "goal_id": [1, 2]}]}
        self.assertEqual(self.post("restore/", data).status_code, 200)


class BudgetTests(FinanceBase):
    def test_all_periods_accepted(self):
        for period in ("weekly", "biweekly", "monthly"):
            res = self.post("budget/", {"period": period, "amount": 100000}, method="put")
            self.assertEqual(res.status_code, 200)
        self.assertEqual(self.post("budget/", {"period": "yearly", "amount": 1}, method="put").status_code, 400)
