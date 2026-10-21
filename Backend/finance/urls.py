from django.urls import path
from . import views

urlpatterns = [
    path("transactions/", views.transactions),
    path("transactions/<int:pk>/", views.transaction_detail),
    path("budget/", views.budget),
    path("reset/", views.reset_all),
    path("restore/", views.restore_all),
]