// Komponen UI kecil yang dipakai bersama: toast, dialog konfirmasi, dialog nominal.

function formatRupiah(value) {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0
    }).format(Number(value) || 0).replace(/\u00a0/g, "");
}

function makeEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function toast(message, type = "success") {
    let host = document.getElementById("toastHost");

    if (!host) {
        host = makeEl(
            "div",
            "fixed z-[100] left-4 right-4 top-4 sm:left-auto sm:right-6 sm:top-6 sm:w-96 flex flex-col gap-2 pointer-events-none"
        );
        host.id = "toastHost";
        host.setAttribute("aria-live", "polite");
        document.body.appendChild(host);
    }

    const colors = {
        success: "bg-emerald-600 text-white",
        error: "bg-rose-600 text-white",
        info: "bg-slate-800 text-white"
    };

    const item = makeEl(
        "div",
        `pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium shadow-lg transition duration-300 opacity-0 -translate-y-2 ${colors[type] || colors.info}`,
        message
    );
    item.setAttribute("role", type === "error" ? "alert" : "status");
    host.appendChild(item);

    requestAnimationFrame(() => {
        item.classList.remove("opacity-0", "-translate-y-2");
    });

    const remove = () => {
        item.classList.add("opacity-0");
        setTimeout(() => item.remove(), 300);
    };

    item.addEventListener("click", remove);
    setTimeout(remove, type === "error" ? 5000 : 3200);
}

// Dasar dialog: kembalikan { overlay, box, close }.
function openDialog(titleText, onClose) {
    const previousFocus = document.activeElement;
    const overlay = makeEl(
        "div",
        "fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4"
    );
    const box = makeEl(
        "div",
        "w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
    );
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.appendChild(makeEl("h3", "text-lg font-bold text-slate-900 mb-2", titleText));
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close(result) {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
        if (previousFocus && previousFocus.focus) previousFocus.focus();
        onClose(result);
    }

    function onKey(event) {
        if (event.key === "Escape") close(null);
    }

    document.addEventListener("keydown", onKey);
    overlay.addEventListener("mousedown", (event) => {
        if (event.target === overlay) close(null);
    });

    return { overlay, box, close };
}

function dialogButtons(cancelText, confirmText, danger) {
    const row = makeEl("div", "flex gap-3 mt-6");
    const cancel = makeEl(
        "button",
        "flex-1 rounded-xl border border-slate-200 py-3 font-semibold text-slate-600 hover:bg-slate-50",
        cancelText
    );
    cancel.type = "button";

    const confirm = makeEl(
        "button",
        `flex-1 rounded-xl py-3 font-semibold text-white ${danger ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`,
        confirmText
    );
    confirm.type = "button";

    row.append(cancel, confirm);
    return { row, cancel, confirm };
}

function confirmDialog({ title, message, confirmText = "Ya", cancelText = "Batal", danger = false }) {
    return new Promise((resolve) => {
        const dialog = openDialog(title, (result) => resolve(result === true));
        dialog.box.appendChild(makeEl("p", "text-sm leading-6 text-slate-500", message));

        const buttons = dialogButtons(cancelText, confirmText, danger);
        buttons.cancel.addEventListener("click", () => dialog.close(false));
        buttons.confirm.addEventListener("click", () => dialog.close(true));
        dialog.box.appendChild(buttons.row);
        buttons.confirm.focus();
    });
}

// Minta nominal. Hasil: angka, atau null kalau dibatalkan.
function askAmount({ title, message, max, confirmText = "Simpan" }) {
    return new Promise((resolve) => {
        const dialog = openDialog(title, (result) =>
            resolve(typeof result === "number" ? result : null)
        );

        if (message) {
            dialog.box.appendChild(makeEl("p", "text-sm leading-6 text-slate-500 mb-4", message));
        }

        const input = makeEl(
            "input",
            "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
        );
        input.type = "number";
        input.min = "1";
        input.step = "1";
        input.inputMode = "numeric";
        input.placeholder = "Nominal (Rp)";

        const preview = makeEl("p", "text-xs text-slate-400 mt-2 min-h-[1rem]");
        const err = makeEl("p", "text-sm text-rose-600 mt-2 hidden");

        input.addEventListener("input", () => {
            preview.textContent = Number(input.value) > 0 ? formatRupiah(input.value) : "";
            err.classList.add("hidden");
        });

        const buttons = dialogButtons("Batal", confirmText, false);

        function submit() {
            const value = Number(input.value);
            let problem = "";

            if (!Number.isInteger(value) || value <= 0) {
                problem = "Masukkan nominal bilangan bulat lebih dari 0.";
            } else if (max !== undefined && value > max) {
                problem = `Nominal melebihi batas (${formatRupiah(Math.max(max, 0))}).`;
            }

            if (problem) {
                err.textContent = problem;
                err.classList.remove("hidden");
                return;
            }

            dialog.close(value);
        }

        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                submit();
            }
        });

        buttons.cancel.addEventListener("click", () => dialog.close(null));
        buttons.confirm.addEventListener("click", submit);

        dialog.box.append(input, preview, err, buttons.row);
        input.focus();
    });
}
