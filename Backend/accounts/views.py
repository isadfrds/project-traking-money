import json

from django.contrib.auth import (
    authenticate,
    login,
    logout,
    update_session_auth_hash,
)
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST


def read_json(request):
    try:
        data = json.loads(request.body or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def user_data(user):
    return {
        "id": user.id,
        "name": user.first_name or user.username,
        "email": user.email,
    }


@ensure_csrf_cookie
@require_GET
def csrf(request):
    return JsonResponse({"message": "CSRF cookie diset."})


@require_POST
def register(request):
    """Buat akun baru. Sengaja TIDAK login otomatis: user diarahkan ke halaman login."""
    data = read_json(request)
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = data.get("password", "")

    if not name or not email or not password:
        return JsonResponse({"message": "Semua kolom wajib diisi."}, status=400)

    try:
        validate_email(email)
    except ValidationError:
        return JsonResponse({"message": "Format email tidak valid."}, status=400)

    if User.objects.filter(username=email).exists():
        return JsonResponse({"message": "Email sudah terdaftar."}, status=400)

    try:
        validate_password(password)
    except ValidationError as error:
        return JsonResponse({"message": " ".join(error.messages)}, status=400)

    user = User.objects.create_user(
        username=email, email=email, password=password, first_name=name[:150]
    )
    return JsonResponse(
        {"message": "Akun berhasil dibuat. Silakan masuk.", "user": user_data(user)},
        status=201,
    )


@require_POST
def login_view(request):
    data = read_json(request)
    email = str(data.get("email", "")).strip().lower()
    password = data.get("password", "")

    user = authenticate(request, username=email, password=password)
    if user is None:
        return JsonResponse({"message": "Email atau password salah."}, status=400)

    login(request, user)
    return JsonResponse({"user": user_data(user)})


@require_POST
def logout_view(request):
    logout(request)
    return JsonResponse({"message": "Berhasil keluar."})


@require_GET
def me(request):
    if not request.user.is_authenticated:
        return JsonResponse({"message": "Belum login."}, status=401)
    return JsonResponse({"user": user_data(request.user)})


@require_POST
def change_password(request):
    if not request.user.is_authenticated:
        return JsonResponse({"message": "Silakan login terlebih dahulu."}, status=401)

    data = read_json(request)
    old_password = data.get("old_password", "")
    new_password = data.get("new_password", "")

    if not request.user.check_password(old_password):
        return JsonResponse({"message": "Password lama salah."}, status=400)

    if old_password == new_password:
        return JsonResponse(
            {"message": "Password baru harus berbeda dari password lama."}, status=400
        )

    try:
        validate_password(new_password, request.user)
    except ValidationError as error:
        return JsonResponse({"message": " ".join(error.messages)}, status=400)

    request.user.set_password(new_password)
    request.user.save()
    # Supaya sesi saat ini tetap login setelah password diganti.
    update_session_auth_hash(request, request.user)
    return JsonResponse({"message": "Password berhasil diubah."})
