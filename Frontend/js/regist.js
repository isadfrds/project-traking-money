// apiRequest sudah ada di js/api.js

// Sudah login? Tidak perlu daftar lagi, langsung ke dashboard.
redirectIfLoggedIn();

const registerForm = document.getElementById("registerForm");
const registerMessage = document.getElementById("registerMessage");
const registerButton = document.getElementById("registerButton");

function showRegisterMessage(message, type = "error") {
    registerMessage.textContent = message;

    registerMessage.classList.remove(
        "hidden",
        "bg-red-50",
        "text-red-700",
        "bg-emerald-50",
        "text-emerald-700"
    );

    if (type === "success") {
        registerMessage.classList.add("bg-emerald-50", "text-emerald-700");
    } else {
        registerMessage.classList.add("bg-red-50", "text-red-700");
    }
}

registerForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const agree = document.getElementById("agree").checked;

    if (!name || !email || !password || !confirmPassword) {
        showRegisterMessage("Semua kolom wajib diisi.");
        return;
    }

    if (password.length < 8) {
        showRegisterMessage("Password minimal 8 karakter.");
        return;
    }

    if (password !== confirmPassword) {
        showRegisterMessage("Konfirmasi password tidak cocok.");
        return;
    }

    if (!agree) {
        showRegisterMessage("Kamu harus menyetujui ketentuan terlebih dahulu.");
        return;
    }

    registerButton.disabled = true;

    try {
        await apiRequest("/register/", {
            method: "POST",
            body: JSON.stringify({
                name,
                email,
                password
            })
        });
        // Setelah daftar, arahkan ke halaman login (tidak langsung masuk dashboard).
        showRegisterMessage("Akun berhasil dibuat. Mengalihkan ke halaman login...", "success");
        setTimeout(() => {
            window.location.replace(
                `login.html?registered=1&email=${encodeURIComponent(email)}`
            );
        }, 900);
    } catch (error) {
        showRegisterMessage(error.message);
        registerButton.disabled = false;
    }
});