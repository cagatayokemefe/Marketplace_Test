/* ── State (loaded from server, not localStorage) ───────────────────────────── */

let state = {
  username: "",
  balance: 0,
  portfolio: {},
  transactions: [],
  favorites: [],
};
let currentStocks = [];
let selectedSymbol = null;

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

function fmt(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString();
}

function showToast(msg, type = "success") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.className = "toast";
  }, 3000);
}

/* ── Auth ────────────────────────────────────────────────────────────────────── */

async function refreshUserState() {
  const res = await fetch("/api/auth/me");
  if (res.status === 401) {
    window.location.href = "/login";
    return;
  }
  const data = await res.json();
  state.balance = data.balance;
  state.portfolio = data.portfolio;
  state.transactions = data.transactions;
  state.favorites = data.favorites || [];
}

async function init() {
  try {
    const res = await fetch("/api/auth/me");
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    const data = await res.json();
    state = {
      username: data.username,
      balance: data.balance,
      portfolio: data.portfolio,
      transactions: data.transactions,
      favorites: data.favorites || [],
    };
    document.getElementById("username-display").textContent = data.username;
    await fetchStocks();
    if (localStorage.getItem("autoRefresh") !== "false") {
      setInterval(fetchStocks, 5000);
    }
    renderPortfolio();
    renderTransactions();
  } catch (e) {
    console.error("Init failed:", e);
    window.location.href = "/login";
  }
}

document.getElementById("btn-logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
});

/* ── Fetch stocks from server ────────────────────────────────────────────────── */

async function fetchStocks() {
  try {
    const res = await fetch("/api/stocks");
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    currentStocks = await res.json();
    const query = document
      .getElementById("search-input")
      .value.trim()
      .toLowerCase();
    renderMarket(query);
    renderFavorites();
    updateTradePanel();
    renderPortfolio();
  } catch (e) {
    console.error("Failed to fetch stocks:", e);
  }
}

/* ── Search ──────────────────────────────────────────────────────────────────── */

document.getElementById("search-input").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  renderMarket(q);
});

/* ── Build Stock Card (shared helper) ────────────────────────────────────────── */

function buildStockCard(stock, isFav, compact = false) {
  const positive = stock.change >= 0;
  const card = document.createElement("div");

  if (compact) {
    card.className = "stock-card compact";
    card.innerHTML = `
      <button class="btn-star ${isFav ? "starred" : ""}" data-symbol="${stock.symbol}" title="${isFav ? "Remove favorite" : "Add to favorites"}">
        ${isFav ? "&#9733;" : "&#9734;"}
      </button>
      <span class="compact-symbol">${stock.symbol}</span>
      <span class="compact-name">${stock.name}</span>
      <span class="stock-price compact-price">${fmt(stock.price)}</span>
      <span class="stock-change ${positive ? "positive" : "negative"} compact-change">
        ${positive ? "+" : ""}${stock.change.toFixed(2)} (${positive ? "+" : ""}${stock.changePct.toFixed(2)}%)
      </span>
    `;
    card.addEventListener("click", () => openTrade(stock.symbol));
  } else {
    card.className =
      "stock-card" + (selectedSymbol === stock.symbol ? " selected" : "");
    card.innerHTML = `
      <button class="btn-star ${isFav ? "starred" : ""}" data-symbol="${stock.symbol}" title="${isFav ? "Remove favorite" : "Add to favorites"}">
        ${isFav ? "&#9733;" : "&#9734;"}
      </button>
      <div class="stock-header">
        <div>
          <div class="stock-symbol">${stock.symbol}</div>
          <div class="stock-name">${stock.name}</div>
        </div>
        <div style="text-align:right">
          <div class="stock-price">${fmt(stock.price)}</div>
          <span class="stock-change ${positive ? "positive" : "negative"}">
            ${positive ? "+" : ""}${stock.change.toFixed(2)} (${positive ? "+" : ""}${stock.changePct.toFixed(2)}%)
          </span>
        </div>
      </div>
      <p class="stock-desc">${stock.description}</p>
      <button class="btn-trade" data-symbol="${stock.symbol}">Trade ${stock.symbol}</button>
    `;
    card
      .querySelector(".btn-trade")
      .addEventListener("click", () => openTrade(stock.symbol));
  }

  card.querySelector(".btn-star").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(stock.symbol);
  });
  return card;
}

/* ── Render Market ───────────────────────────────────────────────────────────── */

function renderMarket(query = "") {
  const grid = document.getElementById("stocks-grid");
  grid.innerHTML = "";

  const filtered = query
    ? currentStocks.filter(
        (s) =>
          s.symbol.toLowerCase().includes(query) ||
          s.name.toLowerCase().includes(query),
      )
    : currentStocks;

  filtered.forEach((stock) => {
    const isFav = state.favorites.includes(stock.symbol);
    const isSelected = stock.symbol === selectedSymbol;
    grid.appendChild(buildStockCard(stock, isFav, !isSelected));
  });

  document.getElementById("balance").textContent = fmt(state.balance);
}

/* ── Render Favorites ────────────────────────────────────────────────────────── */

function renderFavorites() {
  const section = document.getElementById("section-favorites");
  const grid = document.getElementById("favorites-grid");

  if (state.favorites.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "";
  grid.innerHTML = "";

  const favStocks = currentStocks.filter((s) =>
    state.favorites.includes(s.symbol),
  );
  favStocks.forEach((stock) => {
    grid.appendChild(buildStockCard(stock, true, false));
  });
}

/* ── Toggle Favorite ─────────────────────────────────────────────────────────── */

async function toggleFavorite(symbol) {
  const isFav = state.favorites.includes(symbol);
  const method = isFav ? "DELETE" : "POST";
  const url = isFav ? `/api/favorites/${symbol}` : "/api/favorites";
  const body = isFav ? undefined : JSON.stringify({ symbol });

  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body,
  });
  if (!res.ok) return;

  if (isFav) {
    state.favorites = state.favorites.filter((s) => s !== symbol);
  } else {
    state.favorites.push(symbol);
  }

  renderFavorites();
  const query = document
    .getElementById("search-input")
    .value.trim()
    .toLowerCase();
  renderMarket(query);
}

/* ── Trade Panel ─────────────────────────────────────────────────────────────── */

function openTrade(symbol) {
  selectedSymbol = symbol;
  document.getElementById("section-trade").style.display = "";
  document.getElementById("trade-symbol-title").textContent = symbol;
  document.getElementById("qty-input").value = 1;
  updateTradePanel();
  document
    .getElementById("section-trade")
    .scrollIntoView({ behavior: "smooth", block: "start" });
  const query = document
    .getElementById("search-input")
    .value.trim()
    .toLowerCase();
  renderMarket(query);
  renderFavorites();
}

function updateTradePanel() {
  if (!selectedSymbol) return;
  const stock = currentStocks.find((s) => s.symbol === selectedSymbol);
  if (!stock) return;

  const qty = parseInt(document.getElementById("qty-input").value, 10) || 1;
  document.getElementById("trade-price").textContent = fmt(stock.price);
  document.getElementById("trade-owned").textContent = (
    state.portfolio[selectedSymbol]?.shares || 0
  ).toString();
  document.getElementById("trade-cost").textContent = fmt(stock.price * qty);
}

document
  .getElementById("qty-input")
  .addEventListener("input", updateTradePanel);

document.getElementById("btn-cancel").addEventListener("click", () => {
  selectedSymbol = null;
  document.getElementById("section-trade").style.display = "none";
  const query = document
    .getElementById("search-input")
    .value.trim()
    .toLowerCase();
  renderMarket(query);
  renderFavorites();
});

/* ── Buy ─────────────────────────────────────────────────────────────────────── */

document.getElementById("btn-buy").addEventListener("click", async () => {
  const qty = parseInt(document.getElementById("qty-input").value, 10);
  if (!qty || qty < 1) {
    showToast("Enter a valid quantity.", "error");
    return;
  }

  try {
    const res = await fetch("/api/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: selectedSymbol, quantity: qty }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error, "error");
      return;
    }

    await refreshUserState();
    showToast(
      `Bought ${data.quantity} share(s) of ${data.symbol} for ${fmt(data.total)}.`,
    );
    await fetchStocks();
    renderPortfolio();
    renderTransactions();
    updateTradePanel();
  } catch (e) {
    showToast("Transaction failed. Try again.", "error");
  }
});

/* ── Sell ────────────────────────────────────────────────────────────────────── */

document.getElementById("btn-sell").addEventListener("click", async () => {
  const qty = parseInt(document.getElementById("qty-input").value, 10);
  if (!qty || qty < 1) {
    showToast("Enter a valid quantity.", "error");
    return;
  }

  try {
    const res = await fetch("/api/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: selectedSymbol, quantity: qty }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error, "error");
      return;
    }

    await refreshUserState();
    showToast(
      `Sold ${data.quantity} share(s) of ${data.symbol} for ${fmt(data.total)}.`,
    );
    await fetchStocks();
    renderPortfolio();
    renderTransactions();
    updateTradePanel();
  } catch (e) {
    showToast("Transaction failed. Try again.", "error");
  }
});

/* ── Portfolio ───────────────────────────────────────────────────────────────── */

function renderPortfolio() {
  const body = document.getElementById("portfolio-body");
  const table = document.getElementById("portfolio-table");
  const empty = document.getElementById("portfolio-empty");
  const symbols = Object.keys(state.portfolio);

  if (symbols.length === 0) {
    table.style.display = "none";
    empty.style.display = "";
    document.getElementById("portfolio-value").textContent = "$0.00";
    return;
  }

  table.style.display = "";
  empty.style.display = "none";
  body.innerHTML = "";

  let totalValue = 0;

  symbols.forEach((sym) => {
    const holding = state.portfolio[sym];
    const stock = currentStocks.find((s) => s.symbol === sym);
    const currentPrice = stock ? stock.price : holding.avgCost;
    const marketValue = parseFloat((holding.shares * currentPrice).toFixed(2));
    const costBasis = parseFloat((holding.shares * holding.avgCost).toFixed(2));
    const gain = parseFloat((marketValue - costBasis).toFixed(2));
    const gainPct = parseFloat(((gain / costBasis) * 100).toFixed(2));
    totalValue += marketValue;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${sym}</td>
      <td>${stock?.name || sym}</td>
      <td>${holding.shares}</td>
      <td>${fmt(holding.avgCost)}</td>
      <td>${fmt(currentPrice)}</td>
      <td>${fmt(marketValue)}</td>
      <td class="${gain >= 0 ? "gain-pos" : "gain-neg"}">
        ${gain >= 0 ? "+" : ""}${fmt(gain)} (${gain >= 0 ? "+" : ""}${gainPct}%)
      </td>
    `;
    body.appendChild(tr);
  });

  document.getElementById("portfolio-value").textContent = fmt(totalValue);
}

/* ── Transactions ────────────────────────────────────────────────────────────── */

function renderTransactions() {
  const body = document.getElementById("tx-body");
  const table = document.getElementById("tx-table");
  const empty = document.getElementById("tx-empty");

  if (state.transactions.length === 0) {
    table.style.display = "none";
    empty.style.display = "";
    return;
  }

  table.style.display = "";
  empty.style.display = "none";
  body.innerHTML = "";

  state.transactions.forEach((tx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtTime(tx.time)}</td>
      <td class="${tx.type === "BUY" ? "tx-buy" : "tx-sell"}">${tx.type}</td>
      <td>${tx.symbol}</td>
      <td>${tx.qty}</td>
      <td>${fmt(tx.price)}</td>
      <td>${fmt(tx.total)}</td>
    `;
    body.appendChild(tr);
  });
}

/* ── Boot ────────────────────────────────────────────────────────────────────── */

init();
