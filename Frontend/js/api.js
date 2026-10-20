
const API_BASE = `http://${window.location.hostname || "127.0.0.1"}:8000/api`;

function getCookie(name) {
    const match = document.cookie
        .split("; ")
        .find((row) => row.startsWith(name + "="));

    return match ? decodeURIComponent(match.split("=")[1]) : "";
}

async function apiRequest(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();

    if (method !== "GET" && !getCookie("csrftoken")) {
        await fetch(`${API_BASE}/accounts/csrf/`, {
            credentials: "include"
        });
    }

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCookie("csrftoken"),
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        console.error("API Error:", response.status, data);

        throw new Error(
            data.message ||
            data.error ||
            `Request gagal dengan status ${response.status}.`
        );
    }

    return data;
}
