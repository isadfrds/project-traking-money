import json

from django.contrib.auth.models import User
from django.test import Client, TestCase


class AuthTests(TestCase):
    def post(self, path, data):
        return self.client.post(f"/api/{path}", json.dumps(data), content_type="application/json")

    def test_register_does_not_log_in(self):
        res = self.post("register/", {"name": "Budi", "email": "Budi@X.com", "password": "Passw0rd!xyz"})
        self.assertEqual(res.status_code, 201)
        self.assertTrue(User.objects.filter(username="budi@x.com").exists())
        # sesudah daftar harus BELUM login
        self.assertEqual(self.client.get("/api/me/").status_code, 401)

    def test_login_then_me_stays_logged_in(self):
        User.objects.create_user("a@x.com", "a@x.com", "Passw0rd!xyz", first_name="Ani")
        self.assertEqual(self.post("login/", {"email": "a@x.com", "password": "salah"}).status_code, 400)
        self.assertEqual(self.post("login/", {"email": "A@x.com", "password": "Passw0rd!xyz"}).status_code, 200)
        me = self.client.get("/api/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["user"]["name"], "Ani")
        # lama sesi = 30 hari
        self.assertEqual(self.client.session.get_expiry_age(), 60 * 60 * 24 * 30)

    def test_duplicate_and_weak_password(self):
        User.objects.create_user("a@x.com", "a@x.com", "Passw0rd!xyz")
        self.assertEqual(self.post("register/", {"name": "A", "email": "a@x.com", "password": "Passw0rd!xyz"}).status_code, 400)
        self.assertEqual(self.post("register/", {"name": "A", "email": "n@x.com", "password": "123"}).status_code, 400)
        self.assertEqual(self.post("register/", {"name": "A", "email": "bukan-email", "password": "Passw0rd!xyz"}).status_code, 400)

    def test_change_password(self):
        User.objects.create_user("a@x.com", "a@x.com", "Passw0rd!xyz")
        self.client.login(username="a@x.com", password="Passw0rd!xyz")
        self.assertEqual(self.post("change-password/", {"old_password": "x", "new_password": "Baru!Pass9876"}).status_code, 400)
        self.assertEqual(self.post("change-password/", {"old_password": "Passw0rd!xyz", "new_password": "Passw0rd!xyz"}).status_code, 400)
        self.assertEqual(self.post("change-password/", {"old_password": "Passw0rd!xyz", "new_password": "Baru!Pass9876"}).status_code, 200)
        # sesi tetap login
        self.assertEqual(self.client.get("/api/me/").status_code, 200)
        self.assertTrue(Client().login(username="a@x.com", password="Baru!Pass9876"))

    def test_csrf_enforced_on_finance_writes(self):
        User.objects.create_user("a@x.com", "a@x.com", "Passw0rd!xyz")
        strict = Client(enforce_csrf_checks=True)
        strict.login(username="a@x.com", password="Passw0rd!xyz")
        res = strict.post("/api/transactions/", json.dumps({}), content_type="application/json")
        self.assertEqual(res.status_code, 403)
