// Bergantung pada api.js (apiRequest) dan ui.js (toast, confirmDialog, askAmount, formatRupiah).

const $ = (id) => document.getElementById(id);

const PAGE_SIZE = 10;
const UNDO_DURATION = 5000;

const EXPENSE_CATEGORIES = [
    "Makanan", "Transportasi", "Pendidikan", "Belanja",
    "Tagihan", "Hiburan", "Kesehatan", "Lainnya"
];
const INCOME_CATEGORIES = ["Gaji", "Bonus", "Hadiah", "Usaha", "Lainnya"];

const state = {
    user: null,
    transactions: [],
    goals: [],
    budget: null,
    previousBudget: null,
    backup: null,
    page: 1,
    pieChart: null,
    trendChart: null
};

let budgetUndoTimer = null;
let resetAllUndoTimer = null;

// ---------------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------------
function pad(number) {
    return String(number).padStart(2, "0");
}

function toISODate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getToday() {
    return toISODate(new Date());
}

const isGoalTransaction = (item) => Boolean(item.goal_id);
const signedAmount = (item) =>
    item.type === "income" ? Number(item.amount) : -Number(item.amount);
const sumAmount = (items) =>
    items.reduce((total, item) => total + Number(item.amount || 0), 0);

// Saldo = semua pemasukan - semua pengeluaran (termasuk setoran ke target).
// Aturan ini sama persis dengan yang dipakai backend.
function getBalance() {
    return state.transactions.reduce((total, item) => total + signedAmount(item), 0);
}

function showMessage(element, message, success = false) {
    if (!element) return;

    element.textContent = message;
    element.classList.remove(
        "hidden", "bg-red-50", "text-red-700", "bg-emerald-50", "text-emerald-700"
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

// ---------------------------------------------------------------------------
// Periode & filter (semua perbandingan tanggal memakai teks ISO YYYY-MM-DD,
// jadi aman dari masalah zona waktu)
// ---------------------------------------------------------------------------
function getPeriodStart(period) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (period === "week" || period === "weekly") {
        const day = today.getDay();
        today.setDate(today.getDate() - (day === 0 ? 6 : day - 1)); // Senin
        return toISODate(today);
    }

    if (period === "biweekly") {
        today.setDate(today.getDate() - 13); // 14 hari terakhir termasuk hari ini
        return toISODate(today);
    }

    if (period === "month" || period === "monthly") {
        return toISODate(new Date(today.getFullYear(), today.getMonth(), 1));
    }

    return null;
}

function isWithinPeriod(dateString, period) {
    if (period === "all") return true;

    const start = getPeriodStart(period);

    return Boolean(start && dateString >= start && dateString <= getToday());
}

function getFilteredTransactions() {
    const search = $("searchTransaction").value.trim().toLowerCase();
    const type = $("filterType").value;
    const period = $("filterPeriod").value;
    const startDate = $("filterStartDate").value;
    const endDate = $("filterEndDate").value;

    return state.transactions.filter((item) => {
        const name = String(item.description || item.name || "").toLowerCase();
        const category = String(item.category || "").toLowerCase();

        if (search && !name.includes(search) && !category.includes(search)) return false;
        if (type !== "all" && item.type !== type) return false;

        if (period === "week" || period === "month") {
            return isWithinPeriod(item.date, period);
        }

        if (period === "custom") {
            return (!startDate || item.date >= startDate) &&
                (!endDate || item.date <= endDate);
        }

        return true;
    });
}

function getSortedFiltered() {
    return getFilteredTransactions()
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

// ---------------------------------------------------------------------------
// Ringkasan
// ---------------------------------------------------------------------------
function updateTotals() {
    // Setoran/tarikan target bukan pemasukan/pengeluaran "sungguhan",
    // jadi tidak dihitung di total & grafik. Efeknya tetap masuk ke saldo.
    const regular = state.transactions.filter((item) => !isGoalTransaction(item));
    const income = sumAmount(regular.filter((item) => item.type === "income"));
    const expense = sumAmount(regular.filter((item) => item.type === "expense"));
    const saved = state.goals.reduce((total, goal) => total + goal.saved_amount, 0);
    const balance = getBalance();

    $("heroBalance").textContent = formatRupiah(balance);
    $("heroIncome").textContent = formatRupiah(income);
    $("heroExpense").textContent = formatRupiah(expense);
    $("totalBalance").textContent = formatRupiah(balance);
    $("totalIncome").textContent = formatRupiah(income);
    $("totalExpense").textContent = formatRupiah(expense);
    $("totalSaved").textContent = formatRupiah(saved);
}

function updateFilteredSummary() {
    const filtered = getFilteredTransactions().filter((item) => !isGoalTransaction(item));

    $("filteredIncome").textContent = formatRupiah(
        sumAmount(filtered.filter((item) => item.type === "income"))
    );
    $("filteredExpense").textContent = formatRupiah(
        sumAmount(filtered.filter((item) => item.type === "expense"))
    );
    $("transactionCount").textContent = getFilteredTransactions().length;
}

const PERIOD_LABELS = {
    weekly: "minggu ini",
    biweekly: "14 hari terakhir",
    monthly: "bulan ini"
};

function updateBudget() {
    if (!state.budget) {
        $("budgetPercent").textContent = "0%";
        $("budgetBar").style.width = "0%";
        $("budgetBar").className = "h-full rounded-full transition-all bg-emerald-500";
        $("budgetDetail").textContent = "Belum ada anggaran.";
        $("budgetRemaining").textContent = "Sisa: Rp0";
        return;
    }

    const amount = Number(state.budget.amount);
    const period = state.budget.period;

    const spent = sumAmount(
        state.transactions.filter(
            (item) =>
                item.type === "expense" &&
                !isGoalTransaction(item) &&
                isWithinPeriod(item.date, period)
        )
    );

    const percent = amount > 0 ? Math.round((spent / amount) * 100) : 0;
    const remaining = amount - spent;

    $("budgetPeriod").value = period;
    $("budgetAmount").value = amount;
    $("budgetPercent").textContent = `${percent}%`;
    $("budgetBar").style.width = `${Math.min(percent, 100)}%`;
    $("budgetBar").className =
        `h-full rounded-full transition-all ${
            percent >= 100 ? "bg-rose-500" : percent >= 80 ? "bg-amber-500" : "bg-emerald-500"
        }`;

    $("budgetDetail").textContent =
        `Terpakai ${formatRupiah(spent)} dari ${formatRupiah(amount)} (${PERIOD_LABELS[period] || period})`;

    $("budgetRemaining").textContent = remaining >= 0
        ? `Sisa: ${formatRupiah(remaining)}`
        : `Melebihi: ${formatRupiah(Math.abs(remaining))}`;

    const alertBox = $("budgetAlert");

    if (percent >= 80) {
        alertBox.textContent = percent >= 100
            ? "Perhatian: anggaran sudah tercapai atau terlampaui."
            : "Perhatian: pengeluaran sudah mencapai minimal 80% anggaran.";
        alertBox.className = percent >= 100
            ? "mt-4 message bg-red-50 text-red-700"
            : "mt-4 message bg-amber-50 text-amber-700";
    } else {
        alertBox.classList.add("hidden");
    }
}

// ---------------------------------------------------------------------------
// Daftar transaksi (tabel di desktop, kartu di HP) + pagination
// ---------------------------------------------------------------------------
function typeLabelFor(item) {
    if (isGoalTransaction(item)) {
        return item.type === "expense" ? "Setoran target" : "Tarikan target";
    }
    return item.type === "income" ? "Pemasukan" : "Pengeluaran";
}

function badgeClass(item) {
    if (isGoalTransaction(item)) {
        return "rounded-full bg-amber-50 text-amber-700 px-2.5 py-1 text-xs font-semibold whitespace-nowrap";
    }
    return item.type === "income"
        ? "rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
        : "rounded-full bg-rose-50 text-rose-700 px-2.5 py-1 text-xs font-semibold whitespace-nowrap";
}

function amountText(item) {
    return `${item.type === "income" ? "+" : "-"}${formatRupiah(item.amount)}`;
}

function actionButtons(item, size) {
    const wrap = makeEl("div", size === "card" ? "flex gap-2" : "");

    if (isGoalTransaction(item)) {
        wrap.appendChild(makeEl("span", "text-xs text-slate-400", "Kelola lewat Target tabungan"));
        return wrap;
    }

    const edit = makeEl(
        "button",
        size === "card"
            ? "flex-1 rounded-lg border border-slate-200 py-2 text-sm font-semibold text-emerald-700"
            : "text-emerald-700 font-semibold mr-3",
        "Edit"
    );
    edit.type = "button";
    edit.addEventListener("click", () => editTransaction(item));

    const remove = makeEl(
        "button",
        size === "card"
            ? "flex-1 rounded-lg border border-slate-200 py-2 text-sm font-semibold text-rose-600"
            : "text-rose-600 font-semibold",
        "Hapus"
    );
    remove.type = "button";
    remove.addEventListener("click", () => deleteTransaction(item));

    wrap.append(edit, remove);
    return wrap;
}

function renderTransactions() {
    const list = getSortedFiltered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    state.page = Math.min(Math.max(state.page, 1), pages);

    const slice = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    const tbody = $("transactionTableBody");
    const cards = $("transactionCards");

    tbody.replaceChildren();
    cards.replaceChildren();

    if (!slice.length) {
        const emptyText = "Belum ada transaksi yang sesuai.";
        const row = makeEl("tr");
        const cell = makeEl("td", "text-center text-slate-400 py-10", emptyText);
        cell.colSpan = 6;
        row.appendChild(cell);
        tbody.appendChild(row);
        cards.appendChild(makeEl("p", "text-center text-sm text-slate-400 py-10", emptyText));
    }

    slice.forEach((item) => {
        // --- baris tabel
        const row = makeEl("tr");
        const nameCell = makeEl("td", "", item.description || item.name || "-");
        const categoryCell = makeEl("td", "", item.category || "Lainnya");
        const dateCell = makeEl("td", "whitespace-nowrap", item.date || "-");
        const typeCell = makeEl("td");
        typeCell.appendChild(makeEl("span", badgeClass(item), typeLabelFor(item)));
        const amountCell = makeEl("td", "font-semibold whitespace-nowrap", amountText(item));
        const actionCell = makeEl("td");
        actionCell.appendChild(actionButtons(item, "row"));
        row.append(nameCell, categoryCell, dateCell, typeCell, amountCell, actionCell);
        tbody.appendChild(row);

        // --- kartu (HP)
        const card = makeEl("article", "rounded-2xl border border-slate-100 bg-white p-4 shadow-sm");
        const top = makeEl("div", "flex items-start justify-between gap-3");
        const left = makeEl("div", "min-w-0");
        left.appendChild(makeEl("p", "font-semibold text-slate-800 break-words", item.description || item.name || "-"));
        left.appendChild(makeEl("p", "text-xs text-slate-400 mt-1", `${item.category || "Lainnya"} • ${item.date || "-"}`));
        const amount = makeEl(
            "p",
            `font-bold whitespace-nowrap ${item.type === "income" ? "text-emerald-600" : "text-rose-600"}`,
            amountText(item)
        );
        top.append(left, amount);

        const bottom = makeEl("div", "flex items-center justify-between gap-3 mt-3");
        bottom.appendChild(makeEl("span", badgeClass(item), typeLabelFor(item)));
        const actions = actionButtons(item, "card");
        if (!isGoalTransaction(item)) actions.classList.add("w-44");
        bottom.appendChild(actions);

        card.append(top, bottom);
        cards.appendChild(card);
    });

    $("pageInfo").textContent = `Halaman ${state.page} dari ${pages}`;
    $("prevPageButton").disabled = state.page <= 1;
    $("nextPageButton").disabled = state.page >= pages;
}

function refreshFiltered() {
    updateFilteredSummary();
    renderTransactions();
}

// ---------------------------------------------------------------------------
// Grafik
// ---------------------------------------------------------------------------
const CHART_COLORS = [
    "#059669", "#2563eb", "#f59e0b", "#e11d48", "#7c3aed",
    "#0891b2", "#ea580c", "#64748b", "#84cc16", "#d946ef"
];

function renderCharts() {
    if (typeof Chart === "undefined") return; // CDN gagal dimuat

    renderCategoryChart();
    renderTrendChart();
}

function renderCategoryChart() {
    const period = $("chartPeriod").value;
    const categories = {};

    state.transactions
        .filter(
            (item) =>
                item.type === "expense" &&
                !isGoalTransaction(item) &&
                isWithinPeriod(item.date, period)
        )
        .forEach((item) => {
            const category = item.category || "Lainnya";
            categories[category] = (categories[category] || 0) + Number(item.amount || 0);
        });

    const labels = Object.keys(categories);

    $("chartEmpty").classList.toggle("hidden", labels.length > 0);

    if (state.pieChart) state.pieChart.destroy();

    state.pieChart = new Chart($("expenseChart"), {
        type: "doughnut",
        data: {
            labels,
            datasets: [{
                data: Object.values(categories),
                backgroundColor: CHART_COLORS,
                borderWidth: 2,
                borderColor: "#ffffff"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: "bottom" },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.label}: ${formatRupiah(context.raw)}`
                    }
                }
            }
        }
    });
}

function renderTrendChart() {
    const months = [];
    const now = new Date();

    for (let i = 5; i >= 0; i -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
            key: `${date.getFullYear()}-${pad(date.getMonth() + 1)}`,
            label: date.toLocaleDateString("id-ID", { month: "short", year: "2-digit" }),
            income: 0,
            expense: 0
        });
    }

    state.transactions
        .filter((item) => !isGoalTransaction(item))
        .forEach((item) => {
            const month = months.find((entry) => entry.key === String(item.date).slice(0, 7));
            if (month) month[item.type] += Number(item.amount || 0);
        });

    const hasData = months.some((month) => month.income || month.expense);
    $("trendEmpty").classList.toggle("hidden", hasData);

    if (state.trendChart) state.trendChart.destroy();

    state.trendChart = new Chart($("trendChart"), {
        type: "bar",
        data: {
            labels: months.map((month) => month.label),
            datasets: [
                { label: "Pemasukan", data: months.map((m) => m.income), backgroundColor: "#10b981", borderRadius: 6 },
                { label: "Pengeluaran", data: months.map((m) => m.expense), backgroundColor: "#f43f5e", borderRadius: 6 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: "bottom" },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${formatRupiah(context.raw)}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (value) =>
                            value >= 1000000 ? `${value / 1000000} jt` : value >= 1000 ? `${value / 1000} rb` : value
                    }
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Muat data
// ---------------------------------------------------------------------------
function refreshAll() {
    updateTotals();
    updateBudget();
    updateAmountHint();
    renderGoals();
    refreshFiltered();
    renderCharts();
}

async function loadTransactions() {
    const result = await apiRequest("/transactions/");
    state.transactions = Array.isArray(result) ? result : result.transactions || [];
}

async function loadGoals() {
    const result = await apiRequest("/goals/");
    state.goals = result.goals || [];
}

async function loadBudget() {
    const result = await apiRequest("/budget/");
    state.budget = result.budget || null;
}

async function reloadMoney() {
    // Dipanggil setelah aksi yang mengubah saldo.
    await Promise.all([loadTransactions(), loadGoals()]);
    refreshAll();
}

// ---------------------------------------------------------------------------
// Form transaksi
// ---------------------------------------------------------------------------
function fillCategories(type, selected) {
    const select = $("transactionCategory");
    const options = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const list = selected && !options.includes(selected) ? [...options, selected] : options;

    select.replaceChildren(
        ...list.map((name) => {
            const option = makeEl("option", "", name);
            option.value = name;
            return option;
        })
    );

    select.value = selected && list.includes(selected) ? selected : list[0];
}

// Saldo yang tersedia untuk form: saldo dikurangi efek transaksi yang sedang diedit.
function availableForForm() {
    const id = $("transactionId").value;
    let balance = getBalance();

    if (id) {
        const original = state.transactions.find((item) => String(item.id) === id);
        if (original) balance -= signedAmount(original);
    }

    return balance;
}

function updateAmountHint() {
    const hint = $("amountHint");
    const amount = Number($("transactionAmount").value);
    const parts = [];

    if (amount > 0) parts.push(formatRupiah(amount));

    if ($("transactionType").value === "expense") {
        parts.push(`Saldo tersedia ${formatRupiah(Math.max(availableForForm(), 0))}`);
    }

    hint.textContent = parts.join(" • ");

    const tooMuch = $("transactionType").value === "expense" && amount > availableForForm();
    hint.classList.toggle("text-rose-600", tooMuch);
    hint.classList.toggle("text-slate-400", !tooMuch);
}

async function saveTransaction(event) {
    event.preventDefault();

    const id = $("transactionId").value;
    const type = $("transactionType").value;
    const amount = Number($("transactionAmount").value);
    const description = $("transactionName").value.trim();
    const date = $("transactionDate").value;

    if (!description || !Number.isInteger(amount) || amount <= 0 || !date) {
        showMessage($("transactionMessage"), "Lengkapi data dan masukkan nominal bilangan bulat yang valid.");
        return;
    }

    // Cek cepat di sisi browser. Backend tetap yang menentukan (tidak bisa dilewati).
    if (type === "expense") {
        const available = availableForForm();

        if (amount > available) {
            showMessage(
                $("transactionMessage"),
                `Saldo tidak cukup. Sisa saldo kamu ${formatRupiah(Math.max(available, 0))}.`
            );
            return;
        }
    }

    const payload = {
        description,
        type,
        category: $("transactionCategory").value,
        amount,
        date
    };

    const button = $("saveTransactionButton");
    button.disabled = true;

    try {
        await apiRequest(id ? `/transactions/${id}/` : "/transactions/", {
            method: id ? "PUT" : "POST",
            body: JSON.stringify(payload)
        });

        resetTransactionForm();
        await reloadMoney();

        $("transactionMessage").classList.add("hidden");
        toast(id ? "Transaksi berhasil diperbarui." : "Transaksi berhasil ditambahkan.");
    } catch (error) {
        showMessage($("transactionMessage"), error.message);
    } finally {
        button.disabled = false;
    }
}

function editTransaction(item) {
    $("transactionId").value = item.id;
    $("transactionName").value = item.description || item.name || "";
    $("transactionType").value = item.type;
    fillCategories(item.type, item.category || "Lainnya");
    $("transactionAmount").value = item.amount;
    $("transactionDate").value = item.date;
    $("transactionFormTitle").textContent = "Edit transaksi";
    $("saveTransactionButton").textContent = "Simpan perubahan";
    $("cancelEditButton").classList.remove("hidden");
    $("transactionMessage").classList.add("hidden");
    updateAmountHint();

    $("transactionForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetTransactionForm() {
    $("transactionForm").reset();
    $("transactionId").value = "";
    $("transactionDate").value = getToday();
    fillCategories($("transactionType").value);
    $("transactionFormTitle").textContent = "Tambah transaksi";
    $("saveTransactionButton").textContent = "Simpan transaksi";
    $("cancelEditButton").classList.add("hidden");
    updateAmountHint();
}

async function deleteTransaction(item) {
    const ok = await confirmDialog({
        title: "Hapus transaksi?",
        message: `"${item.description || item.name}" (${amountText(item)}) akan dihapus.`,
        confirmText: "Hapus",
        danger: true
    });

    if (!ok) return;

    try {
        await apiRequest(`/transactions/${item.id}/`, { method: "DELETE" });
        await reloadMoney();
        toast("Transaksi berhasil dihapus.");
    } catch (error) {
        toast(error.message, "error");
    }
}

// ---------------------------------------------------------------------------
// Anggaran
// ---------------------------------------------------------------------------
function showBudgetUndo() {
    clearTimeout(budgetUndoTimer);
    $("budgetUndo").classList.remove("hidden");
    budgetUndoTimer = setTimeout(dismissBudgetUndo, UNDO_DURATION);
}

function dismissBudgetUndo() {
    clearTimeout(budgetUndoTimer);
    $("budgetUndo").classList.add("hidden");
    state.previousBudget = null;
}

async function saveBudget(event) {
    event.preventDefault();

    const amount = Number($("budgetAmount").value);
    const period = $("budgetPeriod").value;

    if (!Number.isInteger(amount) || amount <= 0) {
        showMessage($("budgetAlert"), "Masukkan nominal anggaran bilangan bulat yang valid.");
        return;
    }

    try {
        const result = await apiRequest("/budget/", {
            method: "PUT",
            body: JSON.stringify({ amount, period })
        });

        state.budget = result.budget;
        dismissBudgetUndo();
        updateBudget();
        toast("Anggaran berhasil disimpan.");
    } catch (error) {
        showMessage($("budgetAlert"), error.message);
    }
}

async function resetBudget() {
    if (!state.budget) {
        toast("Belum ada anggaran yang bisa direset.", "info");
        return;
    }

    const ok = await confirmDialog({
        title: "Reset anggaran?",
        message: "Anggaran akan dihapus. Kamu punya waktu 5 detik untuk mengurungkannya.",
        confirmText: "Reset",
        danger: true
    });

    if (!ok) return;

    const previous = { ...state.budget };

    try {
        await apiRequest("/budget/", { method: "DELETE" });

        state.budget = null;
        $("budgetAmount").value = "";
        updateBudget();

        state.previousBudget = previous;
        showBudgetUndo();
    } catch (error) {
        toast(error.message, "error");
    }
}

async function undoBudgetReset() {
    if (!state.previousBudget) return;

    const previous = state.previousBudget;
    clearTimeout(budgetUndoTimer);

    try {
        const result = await apiRequest("/budget/", {
            method: "PUT",
            body: JSON.stringify({ amount: previous.amount, period: previous.period })
        });

        state.budget = result.budget;
        dismissBudgetUndo();
        updateBudget();
        toast("Anggaran berhasil dikembalikan.");
    } catch (error) {
        toast(error.message, "error");
    }
}

// ---------------------------------------------------------------------------
// Target tabungan
// ---------------------------------------------------------------------------
function renderGoals() {
    const list = $("goalList");
    list.replaceChildren();

    if (!state.goals.length) {
        list.appendChild(
            makeEl(
                "p",
                "md:col-span-2 xl:col-span-3 text-center text-sm text-slate-400 py-8",
                "Belum ada target. Buat target pertamamu di atas."
            )
        );
        return;
    }

    state.goals.forEach((goal) => {
        const percent = goal.target_amount > 0
            ? Math.round((goal.saved_amount / goal.target_amount) * 100)
            : 0;
        const done = goal.saved_amount >= goal.target_amount;

        const card = makeEl("article", "rounded-2xl border border-slate-200 p-5 bg-white");

        const head = makeEl("div", "flex items-start justify-between gap-3 mb-4");
        head.appendChild(makeEl("h3", "font-bold text-slate-900 break-words min-w-0", goal.name));
        head.appendChild(
            makeEl(
                "span",
                done
                    ? "text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 whitespace-nowrap"
                    : "text-xs font-semibold rounded-full bg-slate-100 text-slate-600 px-2.5 py-1 whitespace-nowrap",
                done ? "Tercapai" : `${percent}%`
            )
        );

        const bar = makeEl("div", "w-full h-2.5 rounded-full bg-slate-100 overflow-hidden");
        const fill = makeEl("div", `h-full rounded-full ${done ? "bg-emerald-500" : "bg-amber-500"}`);
        fill.style.width = `${Math.min(percent, 100)}%`;
        bar.appendChild(fill);

        const amounts = makeEl(
            "p",
            "text-sm text-slate-500 mt-3 mb-4 break-words",
            `${formatRupiah(goal.saved_amount)} dari ${formatRupiah(goal.target_amount)}`
        );

        const actions = makeEl("div", "grid grid-cols-3 gap-2");

        const deposit = makeEl("button", "rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700", "Setor");
        deposit.type = "button";
        deposit.addEventListener("click", () => depositToGoal(goal));

        const withdraw = makeEl("button", "rounded-lg border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40", "Tarik");
        withdraw.type = "button";
        withdraw.disabled = goal.saved_amount <= 0;
        withdraw.addEventListener("click", () => withdrawFromGoal(goal));

        const remove = makeEl("button", "rounded-lg border border-slate-200 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50", "Hapus");
        remove.type = "button";
        remove.addEventListener("click", () => deleteGoal(goal));

        actions.append(deposit, withdraw, remove);
        card.append(head, bar, amounts, actions);
        list.appendChild(card);
    });
}

async function createGoal(event) {
    event.preventDefault();

    const name = $("goalName").value.trim();
    const target = Number($("goalTarget").value);

    if (!name || !Number.isInteger(target) || target <= 0) {
        toast("Isi nama target dan nominal bilangan bulat yang valid.", "error");
        return;
    }

    $("goalSubmit").disabled = true;

    try {
        await apiRequest("/goals/", {
            method: "POST",
            body: JSON.stringify({ name, target_amount: target })
        });

        $("goalForm").reset();
        await loadGoals();
        refreshAll();
        toast("Target tabungan dibuat.");
    } catch (error) {
        toast(error.message, "error");
    } finally {
        $("goalSubmit").disabled = false;
    }
}

async function goalMoney(goal, action, amount) {
    try {
        await apiRequest(`/goals/${goal.id}/${action}/`, {
            method: "POST",
            body: JSON.stringify({ amount })
        });

        await reloadMoney();
        toast(action === "deposit" ? "Dana berhasil disetor ke target." : "Dana berhasil ditarik ke saldo.");
    } catch (error) {
        toast(error.message, "error");
    }
}

async function depositToGoal(goal) {
    const balance = getBalance();

    if (balance <= 0) {
        toast("Saldo kamu kosong, belum ada yang bisa disetor.", "error");
        return;
    }

    const amount = await askAmount({
        title: `Setor ke "${goal.name}"`,
        message: `Saldo tersedia ${formatRupiah(balance)}.`,
        max: balance,
        confirmText: "Setor"
    });

    if (amount) await goalMoney(goal, "deposit", amount);
}

async function withdrawFromGoal(goal) {
    const amount = await askAmount({
        title: `Tarik dari "${goal.name}"`,
        message: `Dana di target ${formatRupiah(goal.saved_amount)}. Dana yang ditarik kembali ke saldo.`,
        max: goal.saved_amount,
        confirmText: "Tarik"
    });

    if (amount) await goalMoney(goal, "withdraw", amount);
}

async function deleteGoal(goal) {
    const ok = await confirmDialog({
        title: `Hapus target "${goal.name}"?`,
        message: goal.saved_amount > 0
            ? `Dana ${formatRupiah(goal.saved_amount)} akan kembali ke saldo kamu.`
            : "Target ini belum berisi dana.",
        confirmText: "Hapus",
        danger: true
    });

    if (!ok) return;

    try {
        await apiRequest(`/goals/${goal.id}/`, { method: "DELETE" });
        await reloadMoney();
        toast("Target dihapus.");
    } catch (error) {
        toast(error.message, "error");
    }
}

// ---------------------------------------------------------------------------
// Reset semua & urungkan
// ---------------------------------------------------------------------------
function showResetAllUndo() {
    clearTimeout(resetAllUndoTimer);
    $("resetAllUndo").classList.remove("hidden");
    resetAllUndoTimer = setTimeout(dismissResetAllUndo, UNDO_DURATION);
}

function dismissResetAllUndo() {
    clearTimeout(resetAllUndoTimer);
    $("resetAllUndo").classList.add("hidden");
    state.backup = null;
}

async function resetAll() {
    if (!state.transactions.length && !state.budget && !state.goals.length) {
        toast("Tidak ada data yang bisa direset.", "info");
        return;
    }

    const ok = await confirmDialog({
        title: "Reset semua data?",
        message: "Semua transaksi, anggaran, dan target tabungan akan dihapus. Kamu punya waktu 5 detik untuk mengurungkannya.",
        confirmText: "Reset semua",
        danger: true
    });

    if (!ok) return;

    const backup = {
        transactions: state.transactions.map((item) => ({ ...item })),
        goals: state.goals.map((goal) => ({ ...goal })),
        budget: state.budget ? { ...state.budget } : null
    };

    try {
        await apiRequest("/reset/", { method: "POST", body: JSON.stringify({}) });

        state.transactions = [];
        state.goals = [];
        state.budget = null;
        dismissBudgetUndo();
        $("budgetAmount").value = "";
        resetTransactionForm();
        refreshAll();

        state.backup = backup;
        showResetAllUndo();
    } catch (error) {
        toast("Gagal mereset data: " + error.message, "error");
    }
}

async function undoResetAll() {
    if (!state.backup) return;

    const backup = state.backup;
    clearTimeout(resetAllUndoTimer);

    try {
        await apiRequest("/restore/", { method: "POST", body: JSON.stringify(backup) });

        dismissResetAllUndo();
        await Promise.all([loadBudget(), loadTransactions(), loadGoals()]);
        refreshAll();
        toast("Data berhasil dikembalikan.");
    } catch (error) {
        toast("Gagal mengembalikan data: " + error.message, "error");
    }
}

// ---------------------------------------------------------------------------
// Akun
// ---------------------------------------------------------------------------
async function logout() {
    const button = $("logoutButton");
    button.disabled = true;

    try {
        await apiRequest("/logout/", { method: "POST", body: JSON.stringify({}) });
        window.location.replace("login.html");
    } catch (error) {
        toast("Gagal keluar dari akun: " + error.message, "error");
        button.disabled = false;
    }
}

function setPasswordModal(show) {
    const modal = $("passwordModal");

    modal.classList.toggle("hidden", !show);
    modal.classList.toggle("flex", show);

    if (show) {
        $("passwordForm").reset();
        $("passwordMessage").classList.add("hidden");
        $("oldPassword").focus();
    }
}

async function changePassword(event) {
    event.preventDefault();

    const oldPassword = $("oldPassword").value;
    const newPassword = $("newPassword").value;

    if (newPassword.length < 8) {
        showMessage($("passwordMessage"), "Password baru minimal 8 karakter.");
        return;
    }

    if (newPassword !== $("confirmNewPassword").value) {
        showMessage($("passwordMessage"), "Konfirmasi password baru tidak cocok.");
        return;
    }

    $("savePasswordButton").disabled = true;

    try {
        await apiRequest("/change-password/", {
            method: "POST",
            body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
        });

        setPasswordModal(false);
        toast("Password berhasil diubah.");
    } catch (error) {
        showMessage($("passwordMessage"), error.message);
    } finally {
        $("savePasswordButton").disabled = false;
    }
}

function setAvatarMenu(show) {
    const menu = $("avatarMenu");
    const button = $("avatarButton");

    menu.classList.toggle("hidden", !show);
    button.setAttribute("aria-expanded", String(show));
}

// Sesi habis ketika sedang memakai dashboard -> kembali ke login.
window.onSessionExpired = () => {
    window.location.replace("login.html?expired=1");
};

// ---------------------------------------------------------------------------
// Ekspor
// ---------------------------------------------------------------------------
function exportPdf() {
    const JsPdf = window.jspdf && window.jspdf.jsPDF;

    if (!JsPdf) {
        toast("Library PDF belum termuat. Periksa koneksi internet lalu muat ulang halaman.", "error");
        return;
    }

    const transactions = getSortedFiltered();

    if (!transactions.length) {
        toast("Tidak ada transaksi untuk diekspor. Periksa filter yang sedang aktif.", "error");
        return;
    }

    try {
        const pdf = new JsPdf();
        const rp = (value) => formatRupiah(value).replace(/\u00a0/g, " ");

        const regular = transactions.filter((item) => !isGoalTransaction(item));
        const income = sumAmount(regular.filter((item) => item.type === "income"));
        const expense = sumAmount(regular.filter((item) => item.type === "expense"));

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

            const sign = item.type === "income" ? "+" : "-";
            const kind = isGoalTransaction(item)
                ? "Target"
                : item.type === "income" ? "Masuk" : "Keluar";

            pdf.text(String(item.date || "-"), 14, y);
            pdf.text(String(item.description || item.name || "-").slice(0, 28), 38, y);
            pdf.text(String(item.category || "-").slice(0, 16), 98, y);
            pdf.text(kind, 130, y);
            pdf.text(`${sign}${rp(item.amount)}`, 196, y, { align: "right" });
            y += 7;
        });

        pdf.save(`laporan-moneytrack-${getToday()}.pdf`);
    } catch (error) {
        console.error("Gagal membuat PDF:", error);
        toast("Gagal membuat PDF: " + error.message, "error");
    }
}

// Cegah "CSV injection": sel yang diawali = + - @ bisa dijalankan sebagai rumus di Excel.
function csvCell(value) {
    let text = String(value ?? "");

    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

    return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
    const transactions = getSortedFiltered();

    if (!transactions.length) {
        toast("Tidak ada transaksi untuk diekspor. Periksa filter yang sedang aktif.", "error");
        return;
    }

    const rows = [["Tanggal", "Nama", "Kategori", "Jenis", "Nominal"]];

    transactions.forEach((item) => {
        rows.push([
            item.date,
            item.description || item.name || "",
            item.category || "",
            typeLabelFor(item),
            signedAmount(item)
        ]);
    });

    const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");

    link.href = url;
    link.download = `transaksi-moneytrack-${getToday()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    toast("File CSV berhasil dibuat.");
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------
function onFilterChange() {
    const custom = $("filterPeriod").value === "custom";

    $("customDateFilter").classList.toggle("hidden", !custom);
    $("customDateFilter").classList.toggle("grid", custom);

    state.page = 1;
    refreshFiltered();
}

function resetFilters() {
    $("searchTransaction").value = "";
    $("filterType").value = "all";
    $("filterPeriod").value = "all";
    $("filterStartDate").value = "";
    $("filterEndDate").value = "";
    $("chartPeriod").value = "month";
    $("customDateFilter").classList.add("hidden");
    $("customDateFilter").classList.remove("grid");

    state.page = 1;
    refreshFiltered();
    renderCategoryChart();
}

// Tandai menu yang sedang aktif sesuai bagian yang terlihat
function setupScrollSpy() {
    const ids = ["dashboard", "transactions", "budget", "goals", "analytics"];
    const sections = ids.map((id) => $(id)).filter(Boolean);

    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;

                document.querySelectorAll("[data-nav]").forEach((link) => {
                    link.classList.toggle("active", link.dataset.nav === entry.target.id);
                });
            });
        },
        { rootMargin: "-35% 0px -55% 0px" }
    );

    sections.forEach((section) => observer.observe(section));
}

// ---------------------------------------------------------------------------
// Mulai
// ---------------------------------------------------------------------------
function showConnectionError(message) {
    $("connErrorText").textContent = message;
    $("connError").classList.remove("hidden");
    document.documentElement.classList.remove("checking");
}

async function loadSessionAndData() {
    $("connError").classList.add("hidden");

    try {
        const result = await apiRequest("/me/", { timeout: 15000 });
        state.user = result.user;
    } catch (error) {
        if (error.status === 401) {
            window.location.replace("login.html");
        } else {
            showConnectionError(error.message);
        }
        return;
    }

    const displayName = state.user.name || state.user.email || "Pengguna";

    $("avatarButton").textContent = getInitials(displayName);
    $("menuUserName").textContent = displayName;
    $("menuUserEmail").textContent = state.user.email || "";

    // Sesi valid -> tampilkan dashboard
    document.documentElement.classList.remove("checking");

    try {
        await Promise.all([loadBudget(), loadTransactions(), loadGoals()]);
        refreshAll();
    } catch (error) {
        if (error.status === 401) return; // sudah ditangani onSessionExpired
        $("transactionTableBody").replaceChildren();
        toast("Gagal memuat data: " + error.message, "error");
    }
}

function initializeDashboard() {
    $("currentDate").textContent = new Date().toLocaleDateString("id-ID", {
        day: "numeric", month: "short", year: "numeric"
    });

    $("transactionDate").value = getToday();
    fillCategories("expense");

    $("budgetForm").addEventListener("submit", saveBudget);
    $("resetBudgetButton").addEventListener("click", resetBudget);
    $("undoBudgetButton").addEventListener("click", undoBudgetReset);
    $("transactionForm").addEventListener("submit", saveTransaction);
    $("cancelEditButton").addEventListener("click", resetTransactionForm);
    $("goalForm").addEventListener("submit", createGoal);
    $("retryButton").addEventListener("click", loadSessionAndData);

    $("downloadPdfButton").addEventListener("click", exportPdf);
    $("downloadCsvButton").addEventListener("click", exportCsv);
    $("menuPdf").addEventListener("click", () => { setAvatarMenu(false); exportPdf(); });
    $("menuCsv").addEventListener("click", () => { setAvatarMenu(false); exportCsv(); });

    $("logoutButton").addEventListener("click", logout);
    $("resetAllButton").addEventListener("click", () => { setAvatarMenu(false); resetAll(); });
    $("undoResetAllButton").addEventListener("click", undoResetAll);

    $("changePasswordButton").addEventListener("click", () => {
        setAvatarMenu(false);
        setPasswordModal(true);
    });
    $("cancelPasswordButton").addEventListener("click", () => setPasswordModal(false));
    $("passwordForm").addEventListener("submit", changePassword);
    $("passwordModal").addEventListener("mousedown", (event) => {
        if (event.target === $("passwordModal")) setPasswordModal(false);
    });

    $("fabAdd").addEventListener("click", () => {
        resetTransactionForm();
        $("transactionForm").scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => $("transactionName").focus({ preventScroll: true }), 400);
    });

    $("transactionType").addEventListener("change", () => {
        fillCategories($("transactionType").value);
        updateAmountHint();
    });
    $("transactionAmount").addEventListener("input", updateAmountHint);

    $("prevPageButton").addEventListener("click", () => {
        state.page -= 1;
        renderTransactions();
        $("transactions").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("nextPageButton").addEventListener("click", () => {
        state.page += 1;
        renderTransactions();
        $("transactions").scrollIntoView({ behavior: "smooth", block: "start" });
    });

    $("resetFiltersButton").addEventListener("click", resetFilters);

    $("avatarButton").addEventListener("click", (event) => {
        event.stopPropagation();
        setAvatarMenu($("avatarMenu").classList.contains("hidden"));
    });

    document.addEventListener("click", (event) => {
        if (!$("avatarMenu").contains(event.target)) setAvatarMenu(false);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setAvatarMenu(false);
            setPasswordModal(false);
        }
    });

    ["searchTransaction", "filterType", "filterPeriod", "filterStartDate", "filterEndDate"]
        .forEach((id) => {
            $(id).addEventListener("input", onFilterChange);
            $(id).addEventListener("change", onFilterChange);
        });

    $("chartPeriod").addEventListener("change", renderCategoryChart);

    setupScrollSpy();
    loadSessionAndData();
}

initializeDashboard();
