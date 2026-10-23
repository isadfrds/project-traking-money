import json
from datetime import date
from decimal import Decimal, InvalidOperation
from functools import wraps

from django.contrib.auth import get_user_model
from django.db import transaction as db_transaction
from django.db.models import Case, DecimalField, F, Q, Sum, Value, When
from django.db.models.functions import Coalesce
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect

from .models import Budget, Goal, Transaction

VALID_TYPES = {"income", "expense"}
VALID_PERIODS = {"weekly", "biweekly", "monthly"}
MAX_AMOUNT = Decimal("999999999999")  # < 1 triliun, aman untuk max_digits=14
MAX_GOALS = 50
MONEY = DecimalField(max_digits=20, decimal_places=0)


# --------------------------------------------------------------------------
# Helper umum
# --------------------------------------------------------------------------
def read_json(request):
    try:
        data = json.loads(request.body or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def error(message, status=400):
    return JsonResponse({"message": message}, status=status)


def rupiah(value):
    return "Rp" + f"{int(value):,}".replace(",", ".")


def api(*methods):
    """Wajib login + batasi method + proteksi CSRF."""

    def decorator(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return error("Silakan login terlebih dahulu.", 401)
            if request.method not in methods:
                return error("Method tidak diizinkan.", 405)
            return view(request, *args, **kwargs)

        return csrf_protect(wrapper)

    return decorator


def parse_amount(value, label="Nominal"):
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None, f"{label} tidak valid."

    if (
        not amount.is_finite()
        or amount <= 0
        or amount != amount.to_integral_value()
    ):
        return None, f"{label} harus bilangan bulat lebih dari 0."

    if amount > MAX_AMOUNT:
        return None, f"{label} terlalu besar."

    return amount, None


# --------------------------------------------------------------------------
# Saldo
# --------------------------------------------------------------------------
def signed(tx_type, amount):
    return amount if tx_type == "income" else -amount


def get_balance(user):
    """Saldo = total pemasukan - total pengeluaran (termasuk setoran target)."""
    totals = Transaction.objects.filter(user=user).aggregate(
        income=Coalesce(
            Sum("amount", filter=Q(type="income")),
            Value(0),
            output_field=MONEY,
        ),
        expense=Coalesce(
            Sum("amount", filter=Q(type="expense")),
            Value(0),
            output_field=MONEY,
        ),
    )
    return Decimal(totals["income"]) - Decimal(totals["expense"])


def lock_user(request):
    """Kunci baris user selama transaksi database, supaya dua request yang
    datang bersamaan tidak bisa sama-sama lolos cek saldo."""
    return get_user_model().objects.select_for_update().get(pk=request.user.pk)


def overdraws(before, after):
    """True kalau perubahan membuat saldo minus (atau memperparah saldo yang
    sudah minus dari data lama)."""
    return after < 0 and after < before


def insufficient_message(balance):
    return f"Saldo tidak cukup. Sisa saldo kamu {rupiah(max(balance, 0))}."


# --------------------------------------------------------------------------
# Serializer & parser
# --------------------------------------------------------------------------
def transaction_data(t):
    return {
        "id": t.id,
        "description": t.description,
        "name": t.description,
        "type": t.type,
        "category": t.category,
        "amount": int(t.amount),
        "date": t.date.isoformat(),
        "goal_id": t.goal_id,
    }


def budget_data(item):
    return {"period": item.period, "amount": int(item.amount)}


def goals_queryset(user):
    """Goal + jumlah terkumpul (setoran - tarikan) dalam satu query."""
    saved = Coalesce(
        Sum(
            Case(
                When(transactions__type="expense", then=F("transactions__amount")),
                When(transactions__type="income", then=-F("transactions__amount")),
                default=Value(0),
                output_field=MONEY,
            )
        ),
        Value(0),
        output_field=MONEY,
    )
    return Goal.objects.filter(user=user).annotate(saved=saved)


def goal_data(goal):
    return {
        "id": goal.id,
        "name": goal.name,
        "target_amount": int(goal.target_amount),
        "saved_amount": int(goal.saved),
    }


def parse_transaction(data):
    description = str(data.get("description") or data.get("name") or "").strip()
    tx_type = data.get("type")
    category = str(data.get("category") or "Lainnya").strip()[:50] or "Lainnya"

    if not description:
        return None, "Nama transaksi wajib diisi."

    if tx_type not in VALID_TYPES:
        return None, "Jenis transaksi tidak valid."

    amount, err = parse_amount(data.get("amount"))
    if err:
        return None, err

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
    if period not in VALID_PERIODS:
        return None, "Periode anggaran tidak valid."

    amount, err = parse_amount(data.get("amount"), "Nominal anggaran")
    if err:
        return None, err

    return {"period": period, "amount": amount}, None


def parse_goal(data):
    if not isinstance(data, dict):
        return None, "Data target tidak valid."

    name = str(data.get("name") or "").strip()
    if not name:
        return None, "Nama target wajib diisi."

    amount, err = parse_amount(data.get("target_amount"), "Nominal target")
    if err:
        return None, err

    return {"name": name[:100], "target_amount": amount}, None


# --------------------------------------------------------------------------
# Transaksi
# --------------------------------------------------------------------------
GOAL_LOCKED = (
    "Transaksi ini dibuat dari target tabungan. "
    "Kelola lewat bagian Target tabungan."
)


@api("GET", "POST")
def transactions(request):
    if request.method == "GET":
        items = Transaction.objects.filter(user=request.user).order_by("-date", "-id")
        return JsonResponse({"transactions": [transaction_data(i) for i in items]})

    parsed, err = parse_transaction(read_json(request))
    if err:
        return error(err)

    with db_transaction.atomic():
        lock_user(request)
        before = get_balance(request.user)
        after = before + signed(parsed["type"], parsed["amount"])

        if overdraws(before, after):
            return error(insufficient_message(before))

        item = Transaction.objects.create(user=request.user, **parsed)

    return JsonResponse(transaction_data(item), status=201)


@api("PUT", "DELETE")
def transaction_detail(request, pk):
    parsed = None

    if request.method == "PUT":
        parsed, err = parse_transaction(read_json(request))
        if err:
            return error(err)

    with db_transaction.atomic():
        lock_user(request)

        item = Transaction.objects.filter(pk=pk, user=request.user).first()
        if item is None:
            return error("Transaksi tidak ditemukan.", 404)

        if item.goal_id:
            return error(GOAL_LOCKED)

        before = get_balance(request.user)
        without_item = before - signed(item.type, item.amount)

        if request.method == "PUT":
            after = without_item + signed(parsed["type"], parsed["amount"])

            if overdraws(before, after):
                return error(insufficient_message(without_item))

            for field, value in parsed.items():
                setattr(item, field, value)
            item.save()
            return JsonResponse(transaction_data(item))

        # DELETE
        if overdraws(before, without_item):
            return error(
                "Transaksi ini tidak bisa dihapus karena saldo kamu akan "
                "menjadi minus."
            )

        item.delete()

    return JsonResponse({"message": "Transaksi berhasil dihapus."})


# --------------------------------------------------------------------------
# Anggaran
# --------------------------------------------------------------------------
@api("GET", "PUT", "DELETE")
def budget(request):
    if request.method == "GET":
        item = Budget.objects.filter(user=request.user).first()
        return JsonResponse({"budget": budget_data(item) if item else None})

    if request.method == "PUT":
        parsed, err = parse_budget(read_json(request))
        if err:
            return error(err)

        item, _ = Budget.objects.update_or_create(user=request.user, defaults=parsed)
        return JsonResponse({"budget": budget_data(item)})

    Budget.objects.filter(user=request.user).delete()
    return JsonResponse({"budget": None})


# --------------------------------------------------------------------------
# Target tabungan
# --------------------------------------------------------------------------
@api("GET", "POST")
def goals(request):
    if request.method == "GET":
        items = goals_queryset(request.user)
        return JsonResponse({"goals": [goal_data(g) for g in items]})

    parsed, err = parse_goal(read_json(request))
    if err:
        return error(err)

    with db_transaction.atomic():
        lock_user(request)

        if Goal.objects.filter(user=request.user).count() >= MAX_GOALS:
            return error(f"Maksimal {MAX_GOALS} target tabungan.")

        goal = Goal.objects.create(user=request.user, **parsed)

    goal.saved = 0
    return JsonResponse(goal_data(goal), status=201)


@api("DELETE")
def goal_detail(request, pk):
    """Hapus target. Semua setoran/tarikannya ikut dihapus, jadi dana yang
    terkumpul otomatis kembali ke saldo."""
    with db_transaction.atomic():
        lock_user(request)

        goal = Goal.objects.filter(pk=pk, user=request.user).first()
        if goal is None:
            return error("Target tidak ditemukan.", 404)

        goal.delete()

    return JsonResponse({"message": "Target dihapus. Dana yang terkumpul kembali ke saldo."})


@api("POST")
def goal_deposit(request, pk):
    amount, err = parse_amount(read_json(request).get("amount"))
    if err:
        return error(err)

    with db_transaction.atomic():
        lock_user(request)

        goal = Goal.objects.filter(pk=pk, user=request.user).first()
        if goal is None:
            return error("Target tidak ditemukan.", 404)

        balance = get_balance(request.user)
        if amount > balance:
            return error(insufficient_message(balance))

        Transaction.objects.create(
            user=request.user,
            description=f"Setor ke target: {goal.name}"[:150],
            type="expense",
            category="Tabungan",
            amount=amount,
            date=timezone.localdate(),
            goal=goal,
        )

    return JsonResponse(goal_data(goals_queryset(request.user).get(pk=pk)))


@api("POST")
def goal_withdraw(request, pk):
    amount, err = parse_amount(read_json(request).get("amount"))
    if err:
        return error(err)

    with db_transaction.atomic():
        lock_user(request)

        goal = goals_queryset(request.user).filter(pk=pk).first()
        if goal is None:
            return error("Target tidak ditemukan.", 404)

        if amount > goal.saved:
            return error(f"Dana di target ini hanya {rupiah(goal.saved)}.")

        Transaction.objects.create(
            user=request.user,
            description=f"Tarik dari target: {goal.name}"[:150],
            type="income",
            category="Tabungan",
            amount=amount,
            date=timezone.localdate(),
            goal=goal,
        )

    return JsonResponse(goal_data(goals_queryset(request.user).get(pk=pk)))


# --------------------------------------------------------------------------
# Reset & pulihkan
# --------------------------------------------------------------------------
@api("POST")
def reset_all(request):
    with db_transaction.atomic():
        lock_user(request)
        Goal.objects.filter(user=request.user).delete()  # ikut hapus transaksi target
        Transaction.objects.filter(user=request.user).delete()
        Budget.objects.filter(user=request.user).delete()

    return JsonResponse({"message": "Semua data berhasil direset."})


@api("POST")
def restore_all(request):
    data = read_json(request)
    items = data.get("transactions", [])
    goal_items = data.get("goals", [])
    budget_data_in = data.get("budget")

    if not isinstance(items, list) or len(items) > 5000:
        return error("Data pemulihan tidak valid.")

    if not isinstance(goal_items, list) or len(goal_items) > MAX_GOALS:
        return error("Data target pemulihan tidak valid.")

    # --- validasi semuanya dulu sebelum menyentuh database
    goals_parsed = []  # (id_lama, data)
    for raw in goal_items:
        if not isinstance(raw, dict):
            return error("Data target pemulihan tidak valid.")
        parsed, err = parse_goal(raw)
        if err:
            return error(err)
        goals_parsed.append((raw.get("id"), parsed))

    old_goal_ids = {old_id for old_id, _ in goals_parsed if isinstance(old_id, int)}

    rows = []  # (data transaksi, id_goal_lama)
    for raw in items:
        if not isinstance(raw, dict):
            return error("Data transaksi pemulihan tidak valid.")
        parsed, err = parse_transaction(raw)
        if err:
            return error(err)

        goal_old_id = raw.get("goal_id")
        if not isinstance(goal_old_id, int) or goal_old_id not in old_goal_ids:
            goal_old_id = None
        rows.append((parsed, goal_old_id))

    budget_defaults = None
    if budget_data_in is not None:
        budget_defaults, err = parse_budget(budget_data_in)
        if err:
            return error(err)

    # --- saldo & dana target hasil pemulihan tidak boleh minus
    balance = sum((signed(p["type"], p["amount"]) for p, _ in rows), Decimal(0))
    if balance < 0:
        return error("Data pemulihan membuat saldo minus, jadi dibatalkan.")

    saved_per_goal = {}
    for parsed, goal_old_id in rows:
        if goal_old_id is not None:
            saved_per_goal[goal_old_id] = saved_per_goal.get(
                goal_old_id, Decimal(0)
            ) - signed(parsed["type"], parsed["amount"])
    if any(v < 0 for v in saved_per_goal.values()):
        return error("Data target pemulihan tidak konsisten.")

    with db_transaction.atomic():
        lock_user(request)

        Goal.objects.filter(user=request.user).delete()
        Transaction.objects.filter(user=request.user).delete()
        Budget.objects.filter(user=request.user).delete()

        goal_map = {}
        for old_id, parsed in goals_parsed:
            goal_map[old_id] = Goal.objects.create(user=request.user, **parsed)

        Transaction.objects.bulk_create(
            [
                Transaction(
                    user=request.user,
                    goal=goal_map.get(goal_old_id) if goal_old_id is not None else None,
                    **parsed,
                )
                for parsed, goal_old_id in rows
            ]
        )

        if budget_defaults is not None:
            Budget.objects.update_or_create(user=request.user, defaults=budget_defaults)

    return JsonResponse({"message": "Data berhasil dipulihkan."})
