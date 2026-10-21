// Lokal (Live Server): API Django di port 8000 pada host yang sama dengan halaman ini
// (host harus sama, mis. 127.0.0.1 dengan 127.0.0.1, supaya cookie login terkirim).
// Online (Vercel): API di alamat yang sama (/api). Vercel meneruskan /api/* ke backend
// lewat rewrites di vercel.json, jadi cookie login & CSRF tetap satu domain.
const IS_LOCAL = ["127.0.0.1", "localhost"].includes(window.location.hostname);
const API_BASE = IS_LOCAL
    ? `http://${window.location.hostname}:8000/api`
    : "/api";

function getCookie(name) {
    const match = document.cookie
        .split("; ")
        .find((row) => row.startsWith(name + "="));

    return match ? decodeURIComponent(match.split("=")[1]) : "";
}

async function apiRequest(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();

    // Pastikan cookie CSRF ada sebelum request yang mengubah data
    if (method !== "GET" && !getCookie("csrftoken")) {
        const csrfResponse = await fetch(`${API_BASE}/csrf/`, {
            credentials: "include"
        });

        if (!csrfResponse.ok) {
            throw new Error("Gagal mendapatkan token keamanan.");
        }
    }

    const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {})
    };

    if (method !== "GET") {
        const token = getCookie("csrftoken");

        if (token) {
            headers["X-CSRFToken"] = token;
        }
    }

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        credentials: "include",
        headers
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.message ||
            data.error ||
            `Request gagal dengan status ${response.status}.`
        );
    }

    return data;
}