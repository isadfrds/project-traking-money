from django.urls import path

from . import views

urlpatterns = [
    path("transactions/", views.transactions),
    path("transactions/<int:pk>/", views.transaction_detail),
    path("budget/", views.budget),
    path("goals/", views.goals),
    path("goals/<int:pk>/", views.goal_detail),
    path("goals/<int:pk>/deposit/", views.goal_deposit),
    path("goals/<int:pk>/withdraw/", views.goal_withdraw),
    path("reset/", views.reset_all),
    path("restore/", views.restore_all),
]
