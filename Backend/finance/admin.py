from django.contrib import admin

from .models import Budget, Goal, Transaction


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ("description", "user", "type", "category", "amount", "date")
    list_filter = ("type", "category")
    search_fields = ("description", "user__email")


@admin.register(Budget)
class BudgetAdmin(admin.ModelAdmin):
    list_display = ("user", "period", "amount")


@admin.register(Goal)
class GoalAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "target_amount", "created_at")
