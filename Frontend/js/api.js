// Lokal (Live Server): API Django di port 8000 pada host yang sama dengan halaman ini
// (host harus sama, mis. 127.0.0.1 dengan 127.0.0.1, supaya cookie login terkirim).
// Online (Vercel): API di alamat yang sama (/api). Vercel meneruskan /api/* ke backend
// lewat rewrites di vercel.json, jadi cookie login & CSRF tetap satu domain.
const IS_LOCAL = ["127.0.0.1", "localhost"].includes(window.location.hostname);
const API_BASE = IS_LOCAL
    ? `https://project-traking-money-t7rp.vercel.app/api`
    : "/api";

function getCookie(name) {
    const match = document.cookie
        .split("; ")
        .find((row) => row.startsWith(name + "="));

    return match ? decodeURIComponent(match.split("=")[1]) : "";
}

class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.name = "ApiError";
        this.status = status; // 0 = tidak bisa terhubung ke server
    }
}

async function apiFetch(url, options, timeout) {
    const controller = new AbortController();
    const timer = timeout ? setTimeout(() => controller.abort(), timeout) : null;

    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        throw new ApiError(
            error.name === "AbortError"
                ? "Server tidak merespons. Coba lagi sebentar."
                : "Tidak bisa terhubung ke server. Periksa koneksi internet.",
            0
        );
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function apiRequest(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const { timeout, ...fetchOptions } = options;

    // Pastikan cookie CSRF ada sebelum request yang mengubah data
    if (method !== "GET" && !getCookie("csrftoken")) {
        const csrfResponse = await apiFetch(
            `${API_BASE}/csrf/`,
            { credentials: "include" },
            timeout
        );

        if (!csrfResponse.ok) {
            throw new ApiError("Gagal mendapatkan token keamanan.", csrfResponse.status);
        }
    }

    const headers = {
        "Content-Type": "application/json",
        ...(fetchOptions.headers || {})
    };

    if (method !== "GET") {
        const token = getCookie("csrftoken");

        if (token) {
            headers["X-CSRFToken"] = token;
        }
    }

    const response = await apiFetch(
        `${API_BASE}${path}`,
        { ...fetchOptions, credentials: "include", headers },
        timeout
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        // Sesi habis di tengah pemakaian -> halaman bisa bereaksi (lihat index.js)
        const isAuthCall = path.startsWith("/login/") || path.startsWith("/me/");

        if (response.status === 401 && !isAuthCall && typeof window.onSessionExpired === "function") {
            window.onSessionExpired();
        }

        throw new ApiError(
            data.message ||
            data.error ||
            `Request gagal dengan status ${response.status}.`,
            response.status
        );
    }

    return data;
}

// Halaman login & daftar: kalau sudah login, langsung masuk dashboard.
// Kalau belum (atau server tidak merespons), form ditampilkan seperti biasa.
async function redirectIfLoggedIn() {
    try {
        await apiRequest("/me/", { timeout: 6000 });
        window.location.replace("index.html");
        return true;
    } catch (error) {
        return false;
    } finally {
        document.documentElement.classList.remove("checking");
    }
}
