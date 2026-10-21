from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def health(request):
    """Cek cepat bahwa backend hidup (dipakai juga untuk health check hosting)."""
    return JsonResponse({"status": "ok", "service": "MoneyTrack API"})


urlpatterns = [
    path("", health),
    path("api/health/", health),
    path("admin/", admin.site.urls),
    path("api/", include("accounts.urls")),
    path("api/", include("finance.urls")),
]
