
import json
from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import transaction as db_transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect

from .models import Budget, Transaction

VALID_TYPES = {"income", "expense"}
VALID_PERIODS = {"weekly", "biweekly", "monthly"}


def read_json(request):
    try:
        return json.loads(request.body or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def unauthorized():
    return JsonResponse(
        {"message": "Silakan login terlebih dahulu."},
        status=401
    )


def transaction_data(t):
    return {
        "id": t.id,
        "description": t.description,
        "name": t.description,
        "type": t.type,
        "category": t.category,
        "amount": int(t.amount),
        "date": t.date.isoformat(),
    }


def parse_transaction(data):
    description = str(
        data.get("description") or data.get("name") or ""
    ).strip()

    tx_type = data.get("type")
    category = str(data.get("category") or "Lainnya").strip()[:50]

    if not description:
        return None, "Nama transaksi wajib diisi."

    if tx_type not in VALID_TYPES:
        return None, "Jenis transaksi tidak valid."

    try:
        amount = Decimal(str(data.get("amount")))
    except (InvalidOperation, TypeError, ValueError):
        return None, "Nominal tidak valid."

    if (
        not amount.is_finite()
        or amount <= 0
        or amount != amount.to_integral_value()
    ):
        return None, "Nominal harus bilangan bulat lebih dari 0."

    try:
        tx_date = date.fromisoformat(str(data.get("date")))
    except (ValueError, TypeError):
        return None, "Tanggal tidak valid."

    return {
        "description": description[:150],
        "type": tx_type,
        "category": category,
        "amount": amount,
        "date": tx_date,
    }, None


def parse_budget(data):
    if not isinstance(data, dict):
        return None, "Data anggaran tidak valid."

    period = data.get("period")

    try:
        amount = Decimal(str(data.get("amount")))
    except (InvalidOperation, TypeError, ValueError):
        return None, "Nominal anggaran tidak valid."

    if period not in VALID_PERIODS:
        return None, "Periode anggaran tidak valid."

    if (
        not amount.is_finite()
        or amount <= 0
        or amount != amount.to_integral_value()
    ):
        return None, "Nominal anggaran harus bilangan bulat lebih dari 0."

    return {
        "period": period,
        "amount": amount,
    }, None


@csrf_protect
def transactions(request):
    if not request.user.is_authenticated:
        return unauthorized()

    if request.method == "GET":
        items = Transaction.objects.filter(
            user=request.user
        ).order_by("-date", "-id")

        return JsonResponse({
            "transactions": [
                transaction_data(item) for item in items
            ]
        })

    if request.method == "POST":
        parsed, error = parse_transaction(read_json(request))

        if error:
            return JsonResponse({"message": error}, status=400)

        item = Transaction.objects.create(
            user=request.user,
            **parsed
        )

        return JsonResponse(transaction_data(item), status=201)

    return JsonResponse(
        {"message": "Method tidak diizinkan."},
        status=405
    )


@csrf_protect
def transaction_detail(request, pk):
    if not request.user.is_authenticated:
        return unauthorized()

    try:
        item = Transaction.objects.get(
            pk=pk,
            user=request.user
        )
    except Transaction.DoesNotExist:
        return JsonResponse(
            {"message": "Transaksi tidak ditemukan."},
            status=404
        )

    if request.method == "PUT":
        parsed, error = parse_transaction(read_json(request))

        if error:
            return JsonResponse({"message": error}, status=400)

        for field, value in parsed.items():
            setattr(item, field, value)

        item.save()

        return JsonResponse(transaction_data(item))

    if request.method == "DELETE":
        item.delete()

        return JsonResponse({
            "message": "Transaksi berhasil dihapus."
        })

    return JsonResponse(
        {"message": "Method tidak diizinkan."},
        status=405
    )


@csrf_protect
def budget(request):
    if not request.user.is_authenticated:
        return unauthorized()

    if request.method == "GET":
        item = Budget.objects.filter(
            user=request.user
        ).first()

        if item is None:
            return JsonResponse({"budget": None})

        return JsonResponse({
            "budget": {
                "period": item.period,
                "amount": int(item.amount),
            }
        })

    if request.method == "PUT":
        parsed, error = parse_budget(read_json(request))

        if error:
            return JsonResponse({"message": error}, status=400)

        item, _ = Budget.objects.update_or_create(
                        user=request.user,
                        defaults=parsed
                    )

        return JsonResponse({
            "budget": {
                "period": item.period,
                "amount": int(item.amount),
            }
        })

    if request.method == "DELETE":
        Budget.objects.filter(user=request.user).delete()

        return JsonResponse({"budget": None})

    return JsonResponse(
        {"message": "Method tidak diizinkan."},
        status=405
    )


@csrf_protect
def reset_all(request):
    if not request.user.is_authenticated:
        return unauthorized()

    if request.method != "POST":
        return JsonResponse(
            {"message": "Method tidak diizinkan."},
            status=405
        )

    with db_transaction.atomic():
        Transaction.objects.filter(user=request.user).delete()
        Budget.objects.filter(user=request.user).delete()

    return JsonResponse({
        "message": "Semua data berhasil direset."
    })


@csrf_protect
def restore_all(request):
    if not request.user.is_authenticated:
        return unauthorized()

    if request.method != "POST":
        return JsonResponse(
            {"message": "Method tidak diizinkan."},
            status=405
        )

    data = read_json(request)
    items = data.get("transactions", [])
    budget_data = data.get("budget")

    if not isinstance(items, list) or len(items) > 5000:
        return JsonResponse(
            {"message": "Data pemulihan tidak valid."},
            status=400
        )

    rows = []

    for item in items:
        if not isinstance(item, dict):
            return JsonResponse(
                {"message": "Data transaksi pemulihan tidak valid."},
                status=400
            )

        parsed, error = parse_transaction(item)

        if error:
            return JsonResponse({"message": error}, status=400)

        rows.append(
            Transaction(user=request.user, **parsed)
        )

    budget_defaults = None

    if budget_data is not None:
        budget_defaults, error = parse_budget(budget_data)

        if error:
            return JsonResponse({"message": error}, status=400)

    with db_transaction.atomic():
        Transaction.objects.filter(user=request.user).delete()
        Budget.objects.filter(user=request.user).delete()

        Transaction.objects.bulk_create(rows)

        if budget_defaults is not None:
            Budget.objects.update_or_create(
                user=request.user,
                defaults=budget_defaults
            )

    return JsonResponse({
        "message": "Data berhasil dipulihkan."
    })
