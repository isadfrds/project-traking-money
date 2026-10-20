
const $ = (id) => document.getElementById(id);

const state = {
    transactions: [],
    user: null,
    chart: null,
    budget: null,
    previousBudget: null,
    backup: null
};

const UNDO_DURATION = 5000;
let budgetUndoTimer = null;
let resetAllUndoTimer = null;

function formatRupiah(value) {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0
    }).format(Number(value) || 0);
}

function getToday() {
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 10);
}

function showMessage(element, message, success = false) {
    element.textContent = message;
    element.classList.remove(
        "hidden",
        "bg-red-50",
        "text-red-700",
        "bg-emerald-50",
        "text-emerald-700"
    );

    element.classList.add(
        success ? "bg-emerald-50" : "bg-red-50",
        success ? "text-emerald-700" : "text-red-700"
    );
}

function getInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);

    if (!parts.length) return "??";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function showBudgetUndo() {
    clearTimeout(budgetUndoTimer);
    $("budgetUndo").classList.remove("hidden");
    budgetUndoTimer = setTimeout(dismissBudgetUndo, UNDO_DURATION);
}

function showResetAllUndo() {
    clearTimeout(resetAllUndoTimer);
    $("resetAllUndo").classList.remove("hidden");
    resetAllUndoTimer = setTimeout(dismissResetAllUndo, UNDO_DURATION);
}

function dismissBudgetUndo() {
    clearTimeout(budgetUndoTimer);
    $("budgetUndo").classList.add("hidden");
    state.previousBudget = null;
}

function dismissResetAllUndo() {
    clearTimeout(resetAllUndoTimer);
    $("resetAllUndo").classList.add("hidden");
    state.backup = null;
}

function getDateStart(period) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (period === "week") {
        const day = today.getDay();
        today.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
        return today;
    }

    if (period === "month") {
        return new Date(today.getFullYear(), today.getMonth(), 1);
    }

    return null;
}

function isWithinPeriod(dateString, period) {
    if (period === "all") {
        return true;
    }

    const date = new Date(`${dateString}T00:00:00`);
    const start = getDateStart(period);

    return Boolean(start && date >= start && date <= new Date());
}

function getFilteredTransactions() {
    const search = $("searchTransaction").value.trim().toLowerCase();
    const type = $("filterType").value;
    const period = $("filterPeriod").value;
    const startDate = $("filterStartDate").value;
    const endDate = $("filterEndDate").value;

    return state.transactions.filter((transaction) => {
        const name = String(
            transaction.description || transaction.name || ""
        ).toLowerCase();

        const category = String(transaction.category || "").toLowerCase();

        const matchesSearch =
            name.includes(search) || category.includes(search);

        const matchesType =
            type === "all" || transaction.type === type;

        let matchesPeriod = true;

        if (period === "week" || period === "month") {
            matchesPeriod = isWithinPeriod(transaction.date, period);
        } else if (period === "custom") {
            matchesPeriod =
                (!startDate || transaction.date >= startDate) &&
                (!endDate || transaction.date <= endDate);
        }

        return matchesSearch && matchesType && matchesPeriod;
    });
}

function updateSummary() {
    const income = state.transactions
        .filter((item) => item.type === "income")
        .reduce((total, item) => total + Number(item.amount || 0), 0);

    const expense = state.transactions
        .filter((item) => item.type === "expense")
        .reduce((total, item) => total + Number(item.amount || 0), 0);

    const balance = income - expense;

    $("heroBalance").textContent = formatRupiah(balance);
    $("heroIncome").textContent = formatRupiah(income);
    $("heroExpense").textContent = formatRupiah(expense);
    $("totalBalance").textContent = formatRupiah(balance);
    $("totalIncome").textContent = formatRupiah(income);
    $("totalExpense").textContent = formatRupiah(expense);

    const filtered = getFilteredTransactions();

    $("filteredIncome").textContent = formatRupiah(
        filtered
            .filter((item) => item.type === "income")
            .reduce((total, item) => total + Number(item.amount || 0), 0)
    );

    $("filteredExpense").textContent = formatRupiah(
        filtered
            .filter((item) => item.type === "expense")
            .reduce((total, item) => total + Number(item.amount || 0), 0)
    );

    $("transactionCount").textContent = filtered.length;

    updateBudget();
    renderTransactions();
    renderChart();
}

function updateBudget() {
    if (!state.budget) {
        $("budgetPercent").textContent = "0%";
        $("budgetBar").style.width = "0%";
        $("budgetBar").className =
            "h-full rounded-full transition-all bg-emerald-500";
        $("budgetDetail").textContent = "Belum ada anggaran.";
        $("budgetRemaining").textContent = "Sisa: Rp0";
        $("heroBudgetPercent").textContent = "0%";
        $("heroBudgetBar").style.width = "0%";
        $("heroBudgetMessage").textContent = "Atur anggaran untuk memulai.";
        $("budgetAlert").classList.add("hidden");
        return;
    }

    const amount = Number(state.budget.amount);
    const period = state.budget.period;

    const relevantTransactions = state.transactions.filter((item) => {
        if (item.type !== "expense") return false;

        const budgetPeriod =
            period === "weekly" ? "week" : "month";

        return isWithinPeriod(item.date, budgetPeriod);
    });

    const spent = relevantTransactions.reduce(
        (total, item) => total + Number(item.amount || 0),
        0
    );

    const percent = amount > 0
        ? Math.round((spent / amount) * 100)
        : 0;

    const remaining = amount - spent;

    $("budgetPeriod").value = period;
    $("budgetAmount").value = amount;
    $("budgetPercent").textContent = `${percent}%`;
    $("budgetBar").style.width = `${Math.min(percent, 100)}%`;

    $("budgetBar").className =
        `h-full rounded-full transition-all ${
            percent >= 100
                ? "bg-rose-500"
                : percent >= 80
                    ? "bg-amber-500"
                    : "bg-emerald-500"
        }`;

    $("budgetDetail").textContent =
        `Terpakai ${formatRupiah(spent)} dari ${formatRupiah(amount)}`;

    $("budgetRemaining").textContent = remaining >= 0
        ? `Sisa: ${formatRupiah(remaining)}`
        : `Melebihi: ${formatRupiah(Math.abs(remaining))}`;

    $("heroBudgetPercent").textContent = `${percent}%`;
    $("heroBudgetBar").style.width = `${Math.min(percent, 100)}%`;

    $("heroBudgetMessage").textContent = percent >= 100
        ? "Anggaran telah tercapai atau terlampaui."
        : percent >= 80
            ? "Perhatian: pengeluaran sudah mencapai minimal 80% anggaran."
            : "Pengeluaran masih dalam batas anggaran.";

    if (percent >= 80) {
        $("budgetAlert").textContent = percent >= 100
            ? "Perhatian: anggaran sudah tercapai atau terlampaui."
            : "Perhatian: pengeluaran sudah mencapai minimal 80% anggaran.";

        $("budgetAlert").className = percent >= 100
            ? "mt-4 message bg-red-50 text-red-700"
            : "mt-4 message bg-amber-50 text-amber-700";
    } else {
        $("budgetAlert").classList.add("hidden");
    }
}

function renderTransactions() {
    const tbody = $("transactionTableBody");
    const filtered = getFilteredTransactions();

    if (!filtered.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-slate-400 py-10">
                    Belum ada transaksi yang sesuai.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = "";

    filtered
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .forEach((transaction) => {
            const row = document.createElement("tr");

            const nameCell = document.createElement("td");
            nameCell.textContent =
                transaction.description || transaction.name || "-";

            const categoryCell = document.createElement("td");
            categoryCell.textContent = transaction.category || "Lainnya";

            const dateCell = document.createElement("td");
            dateCell.textContent = transaction.date || "-";

            const typeCell = document.createElement("td");
            const typeLabel = document.createElement("span");

            typeLabel.className = transaction.type === "income"
                ? "rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-semibold"
                : "rounded-full bg-rose-50 text-rose-700 px-2.5 py-1 text-xs font-semibold";

            typeLabel.textContent =
                transaction.type === "income" ? "Pemasukan" : "Pengeluaran";

            typeCell.appendChild(typeLabel);

            const amountCell = document.createElement("td");
            amountCell.className = "font-semibold";
            amountCell.textContent =
                `${transaction.type === "income" ? "+" : "-"}${formatRupiah(transaction.amount)}`;

            const actionCell = document.createElement("td");

            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.textContent = "Edit";
            editButton.className = "text-emerald-700 font-semibold mr-3";
            editButton.addEventListener(
                "click",
                () => editTransaction(transaction)
            );

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.textContent = "Hapus";
            deleteButton.className = "text-rose-600 font-semibold";
            deleteButton.addEventListener(
                "click",
                () => deleteTransaction(transaction.id)
            );

            actionCell.append(editButton, deleteButton);
            row.append(
                nameCell,
                categoryCell,
                dateCell,
                typeCell,
                amountCell,
                actionCell
            );

            tbody.appendChild(row);
        });
}

function renderChart() {
    const period = $("chartPeriod").value;

    const filtered = state.transactions.filter((item) =>
        item.type === "expense" &&
        (period === "all" || isWithinPeriod(item.date, period))
    );

    const categories = {};

    filtered.forEach((item) => {
        const category = item.category || "Lainnya";
        categories[category] =
            (categories[category] || 0) + Number(item.amount || 0);
    });

    const labels = Object.keys(categories);
    const values = Object.values(categories);

    $("chartEmpty").classList.toggle("hidden", labels.length > 0);

    if (state.chart) {
        state.chart.destroy();
        state.chart = null;
    }

    state.chart = new Chart($("expenseChart"), {
        type: "doughnut",
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: [
                    "#059669",
                    "#2563eb",
                    "#f59e0b",
                    "#e11d48",
                    "#7c3aed",
                    "#0891b2",
                    "#ea580c",
                    "#64748b",
                    "#84cc16",
                    "#d946ef"
                ],
                borderWidth: 2,
                borderColor: "#ffffff"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom"
                },
                tooltip: {
                    callbacks: {
                        label(context) {
                            return `${context.label}: ${formatRupiah(context.raw)}`;
                        }
                    }
                }
            }
        }
    });
}

async function loadTransactions() {
    try {
        const result = await apiRequest("/finance/transactions/");

        state.transactions = Array.isArray(result)
            ? result
            : result.transactions || result.data || [];

        updateSummary();
    } catch (error) {
        $("transactionTableBody").innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-amber-700 py-10">
                    Gagal memuat transaksi: ${error.message}
                </td>
            </tr>
        `;

        console.error("Gagal memuat transaksi:", error);
    }
}

async function saveTransaction(event) {
    event.preventDefault();

    const id = $("transactionId").value;

    const payload = {
        description: $("transactionName").value.trim(),
        name: $("transactionName").value.trim(),
        type: $("transactionType").value,
        category: $("transactionCategory").value,
        amount: Number($("transactionAmount").value),
        date: $("transactionDate").value
    };

    if (!payload.description || payload.amount <= 0 || !payload.date) {
        showMessage(
            $("transactionMessage"),
            "Lengkapi data dan masukkan nominal yang valid."
        );
        return;
    }

    const button = $("saveTransactionButton");
    button.disabled = true;

    try {
        const path = id
            ? `/finance/transactions/${id}/`
            : "/finance/transactions/";

        await apiRequest(path, {
            method: id ? "PUT" : "POST",
            body: JSON.stringify(payload)
        });

        resetTransactionForm();
        await loadTransactions();

        showMessage(
            $("transactionMessage"),
            id
                ? "Transaksi berhasil diperbarui."
                : "Transaksi berhasil ditambahkan.",
            true
        );
    } catch (error) {
        showMessage($("transactionMessage"), error.message);
    } finally {
        button.disabled = false;
    }
}

function editTransaction(transaction) {
    $("transactionId").value = transaction.id;
    $("transactionName").value =
        transaction.description || transaction.name || "";
    $("transactionType").value = transaction.type;
    $("transactionCategory").value = transaction.category || "Lainnya";
    $("transactionAmount").value = transaction.amount;
    $("transactionDate").value = transaction.date;
    $("transactionFormTitle").textContent = "Edit transaksi";
    $("saveTransactionButton").textContent = "Simpan perubahan";
    $("cancelEditButton").classList.remove("hidden");

    $("transactionForm").scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

function resetTransactionForm() {
    $("transactionForm").reset();
    $("transactionId").value = "";
    $("transactionDate").value = getToday();
    $("transactionFormTitle").textContent = "Tambah transaksi";
    $("saveTransactionButton").textContent = "Simpan transaksi";
    $("cancelEditButton").classList.add("hidden");
}

async function deleteTransaction(id) {
    if (!id || !confirm("Yakin ingin menghapus transaksi ini?")) {
        return;
    }

    try {
        await apiRequest(`/finance/transactions/${id}/`, {
            method: "DELETE"
        });

        await loadTransactions();

        showMessage(
            $("transactionMessage"),
            "Transaksi berhasil dihapus.",
            true
        );
    } catch (error) {
        showMessage($("transactionMessage"), error.message);
    }
}

async function saveBudget(event) {
    event.preventDefault();

    const amount = Number($("budgetAmount").value);
    const period = $("budgetPeriod").value;

    if (!Number.isFinite(amount) || amount <= 0) {
        showMessage(
            $("budgetAlert"),
            "Masukkan nominal anggaran yang valid."
        );
        return;
    }

    try {
        const result = await apiRequest("/finance/budget/", {
            method: "PUT",
            body: JSON.stringify({ amount, period })
        });

        state.budget = result.budget || result;

        dismissBudgetUndo();
        updateSummary();

        showMessage(
            $("budgetAlert"),
            "Anggaran berhasil disimpan.",
            true
        );
    } catch (error) {
        showMessage($("budgetAlert"), error.message);
    }
}

async function loadBudget() {
    try {
        const result = await apiRequest("/finance/budget/");
        state.budget = result.budget || result;
    } catch (error) {
        console.error("Gagal memuat anggaran:", error.message);
        state.budget = null;
    }
}

async function resetBudget() {
    if (!state.budget) {
        showMessage(
            $("budgetAlert"),
            "Belum ada anggaran yang bisa direset."
        );
        return;
    }

    if (!confirm(
        "Reset anggaran ke 0? Kamu punya waktu 5 detik untuk mengurungkannya."
    )) {
        return;
    }

    const previous = { ...state.budget };

    try {
        await apiRequest("/finance/budget/", {
            method: "DELETE"
        });

        state.budget = null;
        $("budgetAmount").value = "";
        updateSummary();

        state.previousBudget = previous;
        showBudgetUndo();
    } catch (error) {
        showMessage($("budgetAlert"), error.message);
    }
}

async function undoBudgetReset() {
    if (!state.previousBudget) {
        return;
    }

    const previous = state.previousBudget;
    clearTimeout(budgetUndoTimer);

    try {
        const result = await apiRequest("/finance/budget/", {
            method: "PUT",
            body: JSON.stringify({
                amount: previous.amount,
                period: previous.period
            })
        });

        state.budget = result.budget || result;

        dismissBudgetUndo();
        updateSummary();

        showMessage(
            $("budgetAlert"),
            "Anggaran berhasil dikembalikan.",
            true
        );
    } catch (error) {
        showMessage($("budgetAlert"), error.message);
    }
}

async function resetAll() {
    if (!state.transactions.length && !state.budget) {
        alert("Tidak ada data yang bisa direset.");
        return;
    }

    if (!confirm(
        "Reset SEMUA data? Semua transaksi dan anggaran akan dihapus. Kamu punya waktu 5 detik untuk mengurungkannya."
    )) {
        return;
    }

    const backup = {
        transactions: state.transactions.map((item) => ({ ...item })),
        budget: state.budget ? { ...state.budget } : null
    };

    try {
        await apiRequest("/finance/reset/", {
            method: "POST",
            body: JSON.stringify({})
        });

        state.transactions = [];
        state.budget = null;

        dismissBudgetUndo();
        $("budgetAmount").value = "";

        resetTransactionForm();
        updateSummary();

        state.backup = backup;
        showResetAllUndo();
    } catch (error) {
        alert("Gagal mereset data: " + error.message);
    }
}

async function undoResetAll() {
    if (!state.backup) {
        return;
    }

    const backup = state.backup;
    clearTimeout(resetAllUndoTimer);

    try {
        await apiRequest("/finance/restore/", {
            method: "POST",
            body: JSON.stringify(backup)
        });

        dismissResetAllUndo();

        await loadBudget();
        await loadTransactions();
    } catch (error) {
        alert("Gagal mengembalikan data: " + error.message);
    }
}

async function loadUser() {
    try {
        const result = await apiRequest("/accounts/me/");

        if (!result) {
            throw new Error("Backend tidak mengembalikan data pengguna.");
        }

        state.user = result.user || result;

        const displayName =
            state.user.name ||
            state.user.email ||
            "Pengguna";

        $("avatarButton").textContent = getInitials(displayName);
        $("menuUserName").textContent = displayName;
        $("menuUserEmail").textContent = state.user.email || "";

        return true;
    } catch (error) {
        console.error("Gagal memeriksa sesi login:", error);
        alert("Pemeriksaan login gagal: " + error.message);
        return false;
    }
}

async function logout() {
    try {
        await apiRequest("/accounts/logout/", {
            method: "POST",
            body: JSON.stringify({})
        });
    } catch (error) {
        console.error("Logout:", error.message);
    }

    window.location.href = "login.html";
}

function resetFilters() {
    $("searchTransaction").value = "";
    $("filterType").value = "all";
    $("filterPeriod").value = "all";
    $("filterStartDate").value = "";
    $("filterEndDate").value = "";
    $("chartPeriod").value = "month";
    $("customDateFilter").classList.add("hidden");

    updateSummary();
}

function exportPdf() {
    const JsPdf = window.jspdf && window.jspdf.jsPDF;

    if (!JsPdf) {
        alert(
            "Library PDF belum termuat. Periksa koneksi internet lalu muat ulang halaman."
        );
        return;
    }

    const transactions = getFilteredTransactions()
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!transactions.length) {
        alert(
            "Tidak ada transaksi untuk diekspor. Periksa filter yang sedang aktif."
        );
        return;
    }

    try {
        const pdf = new JsPdf();
        const rp = (value) =>
            formatRupiah(value).replace(/\u00a0/g, " ");

        const income = transactions
            .filter((item) => item.type === "income")
            .reduce((total, item) => total + Number(item.amount || 0), 0);

        const expense = transactions
            .filter((item) => item.type === "expense")
            .reduce((total, item) => total + Number(item.amount || 0), 0);

        pdf.setFontSize(18);
        pdf.text("Laporan Keuangan MoneyTrack", 14, 20);

        pdf.setFontSize(10);
        pdf.text(`Tanggal ekspor: ${getToday()}`, 14, 29);
        pdf.text(`Jumlah transaksi: ${transactions.length}`, 14, 35);
        pdf.text(`Total pemasukan: ${rp(income)}`, 14, 41);
        pdf.text(`Total pengeluaran: ${rp(expense)}`, 14, 47);
        pdf.text(`Selisih: ${rp(income - expense)}`, 14, 53);

        let y = 65;

        const drawHeader = () => {
            pdf.setFontSize(9);
            pdf.setFont(undefined, "bold");
            pdf.text("Tanggal", 14, y);
            pdf.text("Nama", 38, y);
            pdf.text("Kategori", 98, y);
            pdf.text("Jenis", 130, y);
            pdf.text("Nominal", 196, y, { align: "right" });
            pdf.setFont(undefined, "normal");
            pdf.line(14, y + 2, 196, y + 2);
            y += 8;
        };

        drawHeader();

        transactions.forEach((item) => {
            if (y > 280) {
                pdf.addPage();
                y = 20;
                drawHeader();
            }

            const name = String(
                item.description || item.name || "-"
            ).slice(0, 28);

            const category = String(item.category || "-").slice(0, 16);
            const sign = item.type === "income" ? "+" : "-";

            pdf.text(String(item.date || "-"), 14, y);
            pdf.text(name, 38, y);
            pdf.text(category, 98, y);
            pdf.text(item.type === "income" ? "Masuk" : "Keluar", 130, y);
            pdf.text(`${sign}${rp(item.amount)}`, 196, y, {
                align: "right"
            });

            y += 7;
        });

        pdf.save(`laporan-moneytrack-${getToday()}.pdf`);
    } catch (error) {
        console.error("Gagal membuat PDF:", error);
        alert("Gagal membuat PDF: " + error.message);
    }
}


function setAvatarMenu(show) {
    const menu = $("avatarMenu");
    const button = $("avatarButton");

    if (!menu || !button) return;

    menu.classList.toggle("hidden", !show);
    button.setAttribute("aria-expanded", String(show));
}


async function initializeDashboard() {
    $("currentDate").textContent = new Date().toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric"
    });

    $("transactionDate").value = getToday();

    $("budgetForm").addEventListener("submit", saveBudget);
    $("resetBudgetButton").addEventListener("click", resetBudget);
    $("undoBudgetButton").addEventListener("click", undoBudgetReset);
    $("transactionForm").addEventListener("submit", saveTransaction);
    $("cancelEditButton").addEventListener("click", resetTransactionForm);
    $("logoutButton").addEventListener("click", logout);
    $("downloadPdfButton").addEventListener("click", exportPdf);
    const resetFiltersButton = $("resetFiltersButton");

    if (resetFiltersButton) {
        resetFiltersButton.addEventListener("click", function (event) {
            event.preventDefault();
            resetFilters();

            console.log("Reset filter berhasil diklik");
        });
    } else {
        console.error("Tombol resetFiltersButton tidak ditemukan di HTML");
    }
    $("resetAllButton").addEventListener("click", resetAll);
    $("undoResetAllButton").addEventListener("click", undoResetAll);

    $("budgetUndo").addEventListener("click", (event) => {
        if (event.target.closest("#undoBudgetButton")) return;
        dismissBudgetUndo();
    });

    $("resetAllUndo").addEventListener("click", (event) => {
        if (event.target.closest("#undoResetAllButton")) return;
        dismissResetAllUndo();
    });

    $("avatarButton").addEventListener("click", (event) => {
        event.stopPropagation();
        setAvatarMenu($("avatarMenu").classList.contains("hidden"));
    });

    document.addEventListener("click", (event) => {
        if (!$("avatarMenu").contains(event.target)) {
            setAvatarMenu(false);
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setAvatarMenu(false);
        }
    });

    [
        "searchTransaction",
        "filterType",
        "filterPeriod",
        "filterStartDate",
        "filterEndDate"
    ].forEach((id) => {
        $(id).addEventListener("input", () => {
            $("customDateFilter").classList.toggle(
                "hidden",
                $("filterPeriod").value !== "custom"
            );

            updateSummary();
        });

        $(id).addEventListener("change", updateSummary);
    });

    $("chartPeriod").addEventListener("change", renderChart);

    const loggedIn = await loadUser();

    if (!loggedIn) return;

    await loadBudget();
    await loadTransactions();
}

initializeDashboard();
