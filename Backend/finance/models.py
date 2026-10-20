from django.conf import settings
from django.db import models


class Transaction(models.Model):
    TYPE_CHOICES = [
        ("income", "Pemasukan"),
        ("expense", "Pengeluaran"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="transactions",
    )
    description = models.CharField(max_length=150)
    type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    category = models.CharField(max_length=50, default="Lainnya")
    amount = models.DecimalField(max_digits=14, decimal_places=0)
    date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"{self.description} ({self.type}) - {self.amount}"



class Budget(models.Model):
    PERIOD_CHOICES = [
        ("weekly", "Mingguan"),
        ("biweekly", "Dua Mingguan"),
        ("monthly", "Bulanan"),
    ]

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="budget",
    )
    period = models.CharField(max_length=10, choices=PERIOD_CHOICES, default="monthly")
    amount = models.DecimalField(max_digits=14, decimal_places=0)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Budget {self.user} - {self.period}: {self.amount}"
