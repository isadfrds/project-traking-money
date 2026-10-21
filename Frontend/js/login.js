
const loginForm = document.getElementById("loginForm");
const passwordInput = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");
const loginMessage = document.getElementById("loginMessage");
const loginButton = document.getElementById("loginButton");

togglePassword.addEventListener("click", function () {
    const passwordIsHidden = passwordInput.type === "password";

    passwordInput.type = passwordIsHidden ? "text" : "password";
    togglePassword.textContent = passwordIsHidden ? "Sembunyikan" : "Lihat";
});

function showLoginMessage(message, type = "error") {
    loginMessage.textContent = message;

    loginMessage.classList.remove(
        "hidden",
        "bg-red-50",
        "text-red-700",
        "bg-emerald-50",
        "text-emerald-700"
    );

    if (type === "success") {
        loginMessage.classList.add("bg-emerald-50", "text-emerald-700");
    } else {
        loginMessage.classList.add("bg-red-50", "text-red-700");
    }
}

loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        showLoginMessage("Email dan password wajib diisi.");
        return;
    }

    loginButton.disabled = true;

    try {
        await apiRequest("/login/", {
            method: "POST",
            body: JSON.stringify({ email, password })
        });

        showLoginMessage("Login berhasil. Mengalihkan...", "success");

        window.location.replace("./index.html");
    } catch (error) {
        showLoginMessage(error.message);
        loginButton.disabled = false;
    }
});
