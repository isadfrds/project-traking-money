from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView

urlpatterns = [
    path("", RedirectView.as_view(url="/app/login.html")),
    path("admin/", admin.site.urls),
    path("api/", include("accounts.urls")),
    path("api/", include("finance.urls")),
]

