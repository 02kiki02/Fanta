import { clearDbCache, fetchPlayersDb } from "./db.js";
import {
  ROLE_LABELS,
  ROLE_ORDER,
  budgetSummary,
  buyPlayer,
  exportStateJson,
  importStateJson,
  loadState,
  resetAuctionLists,
  rosaIds,
  saveState,
  sellPlayer,
  toggleList,
} from "./state.js";

const app = {
  state: loadState(),
  players: [],
  meta: {},
  selectedId: null,
  dbError: null,
  fromCache: false,
};

const $ = (id) => document.getElementById(id);

function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("error", !!isError);
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2800);
}

function persist() {
  saveState(app.state);
}

function ownedSet() {
  return rosaIds(app.state);
}

function favSet() {
  return new Set((app.state.preferiti || []).map(String));
}

function wishSet() {
  return new Set((app.state.wishlist || []).map(String));
}

function availablePlayers() {
  const owned = ownedSet();
  return app.players.filter((p) => !owned.has(String(p.id)));
}

function renderMetrics(containerId) {
  const s = budgetSummary(app.state);
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="metric"><div class="label">Budget</div><div class="value">${s.budget_iniziale}</div></div>
    <div class="metric"><div class="label">Spesi</div><div class="value">${s.spesi}</div></div>
    <div class="metric"><div class="label">Residui</div><div class="value">${s.residui}</div></div>
    <div class="metric"><div class="label">In rosa</div><div class="value">${s.num_acquisti}</div></div>
  `;
}

function renderRoleBars() {
  const s = budgetSummary(app.state);
  const el = $("dashRoleBars");
  el.innerHTML = ROLE_ORDER.map((role) => {
    const spent = s.byRoleSpent[role];
    const target = Math.max(s.targets[role], 1);
    const pct = Math.min(100, Math.round((spent / target) * 100));
    const over = spent > s.targets[role];
    return `
      <div class="role-bar">
        <div><strong>${ROLE_LABELS[role]}</strong><div class="muted">${s.byRoleCount[role]} giocatori</div></div>
        <div class="track"><div class="fill ${over ? "over" : ""}" style="width:${pct}%"></div></div>
        <div>${spent}/${s.targets[role]}</div>
      </div>
    `;
  }).join("");
}

function renderDashboard() {
  const team = app.state.teamName || "La Mia Squadra";
  $("teamSubtitle").textContent = app.state.leagueName
    ? `${team} · ${app.state.leagueName}`
    : team;
  $("dashHeroTitle").textContent = `${team}, tocca bandire`;
  const updated = app.meta.updated_at
    ? new Date(app.meta.updated_at).toLocaleString("it-IT")
    : "n/d";
  $("dashHeroText").textContent = app.dbError
    ? `Attenzione listone: ${app.dbError}`
    : `Listone ${app.meta.player_count || app.players.length} giocatori · aggiornato ${updated}${
        app.fromCache ? " (cache)" : ""
      }`;

  renderMetrics("dashMetrics");
  renderRoleBars();

  const recent = [...(app.state.rosa || [])].slice(-5).reverse();
  const box = $("dashRecent");
  if (!recent.length) {
    box.innerHTML = `<div class="empty">Nessun acquisto ancora. Vai su <strong>Asta Live</strong>.</div>`;
    return;
  }
  box.innerHTML = `
    <div class="table-wrap">
      <table class="data" style="min-width:0">
        <thead><tr><th>Ruolo</th><th>Nome</th><th>Prezzo</th></tr></thead>
        <tbody>
          ${recent
            .map(
              (r) => `
            <tr>
              <td><span class="badge ${r.ruolo}">${r.ruolo}</span></td>
              <td>${escapeHtml(r.nome)} <span class="muted">${escapeHtml(r.squadra || "")}</span></td>
              <td><strong>${r.prezzo}</strong></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fillTeamFilter() {
  const select = $("preTeam");
  const current = select.value;
  const teams = [...new Set(app.players.map((p) => p.squadra).filter(Boolean))].sort();
  select.innerHTML =
    `<option value="">Tutte</option>` +
    teams.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  select.value = current;
}

function filterPool({ q, role, team, listMode, onlyAvailable = true }) {
  const fav = favSet();
  const wish = wishSet();
  let list = onlyAvailable ? availablePlayers() : [...app.players];
  if (role) list = list.filter((p) => p.ruolo === role);
  if (team) list = list.filter((p) => p.squadra === team);
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter((p) => String(p.nome || "").toLowerCase().includes(needle));
  }
  if (listMode === "preferiti") list = list.filter((p) => fav.has(String(p.id)));
  if (listMode === "wishlist") list = list.filter((p) => wish.has(String(p.id)));
  if (listMode === "either") {
    list = list.filter((p) => fav.has(String(p.id)) || wish.has(String(p.id)));
  }
  return list.sort((a, b) => Number(b.qa || 0) - Number(a.qa || 0));
}

function renderPrelista() {
  fillTeamFilter();
  const rows = filterPool({
    q: $("preSearch").value.trim(),
    role: $("preRole").value,
    team: $("preTeam").value,
    listMode: $("preList").value,
  });
  $("preCount").textContent = `${rows.length} giocatori`;
  const fav = favSet();
  const wish = wishSet();
  $("preTableBody").innerHTML = rows
    .slice(0, 250)
    .map((p) => {
      const id = String(p.id);
      const isFav = fav.has(id);
      const isWish = wish.has(id);
      return `
        <tr data-id="${escapeHtml(id)}">
          <td><span class="badge ${p.ruolo}">${p.ruolo}</span></td>
          <td><strong>${escapeHtml(p.nome)}</strong></td>
          <td>${escapeHtml(p.squadra || "")}</td>
          <td>${p.qa ?? "-"}</td>
          <td>${p.fvm ?? "-"}</td>
          <td>${p.probabile_status || "-"}${p.probabile_pct != null ? ` ${p.probabile_pct}%` : ""}</td>
          <td>
            <div class="btn-row">
              <button class="btn btn-ghost" data-act="fav" type="button">${isFav ? "★" : "☆"}</button>
              <button class="btn btn-ghost" data-act="wish" type="button">${isWish ? "♥" : "♡"}</button>
              <button class="btn btn-accent" data-act="asta" type="button">Asta</button>
            </div>
          </td>
        </tr>`;
    })
    .join("");
}

function currentAstaPlayer() {
  const id = $("astaPlayer").value;
  return app.players.find((p) => String(p.id) === String(id)) || null;
}

function renderAstaSelect() {
  const rows = filterPool({
    q: $("astaSearch").value.trim(),
    role: $("astaRole").value,
    team: "",
    listMode: $("astaFocus").value === "all" ? "all" : $("astaFocus").value,
  });
  const select = $("astaPlayer");
  const prev = select.value || app.selectedId;
  select.innerHTML = rows
    .slice(0, 400)
    .map((p) => {
      const label = `${p.ruolo} · ${p.nome} (${p.squadra}) — QA ${p.qa ?? "-"} · FVM ${p.fvm ?? "-"}`;
      return `<option value="${escapeHtml(p.id)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  if (prev && [...select.options].some((o) => o.value === String(prev))) {
    select.value = String(prev);
  }
  renderAstaPlayerCard();
}

function renderAstaPlayerCard() {
  const p = currentAstaPlayer();
  const card = $("astaPlayerCard");
  const summary = budgetSummary(app.state);
  if (!p) {
    card.innerHTML = `<div class="empty">Nessun giocatore disponibile con questi filtri.</div>`;
    $("astaHint").textContent = "";
    return;
  }
  app.selectedId = String(p.id);
  const suggested = Math.max(1, Number(p.qa) || 1);
  const priceInput = $("astaPrice");
  if (!priceInput.dataset.touched) {
    priceInput.value = String(Math.min(suggested, Math.max(summary.residui, 1)));
  }
  card.innerHTML = `
    <h3>${escapeHtml(p.nome)}</h3>
    <div class="muted">${escapeHtml(p.ruolo)}/${escapeHtml(p.ruolo_mantra || "-")} · ${escapeHtml(
      p.squadra || ""
    )}</div>
    <div class="stat-row">
      <span class="stat-pill">QI ${p.qi ?? "-"}</span>
      <span class="stat-pill">QA ${p.qa ?? "-"}</span>
      <span class="stat-pill">FVM ${p.fvm ?? "-"}</span>
      <span class="stat-pill">${escapeHtml(p.probabile_status || "n/d")}${
        p.probabile_pct != null ? ` ${p.probabile_pct}%` : ""
      }</span>
    </div>
    ${
      p.url
        ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Scheda Fantacalcio →</a>`
        : ""
    }
  `;
  const price = Number(priceInput.value) || 0;
  $("astaHint").textContent = `Residui dopo acquisto: ${
    summary.residui - price
  } · Target ${p.ruolo}: ${summary.targets[p.ruolo]} · Già speso: ${summary.byRoleSpent[p.ruolo]}`;

  $("btnFavAsta").textContent = favSet().has(String(p.id)) ? "★ Preferito" : "☆ Preferito";
  $("btnWishAsta").textContent = wishSet().has(String(p.id)) ? "♥ Wishlist" : "♡ Wishlist";
}

function renderRosa() {
  renderMetrics("rosaMetrics");
  const wrap = $("rosaTableWrap");
  const rosa = [...(app.state.rosa || [])].sort((a, b) => {
    const ra = ROLE_ORDER.indexOf(a.ruolo);
    const rb = ROLE_ORDER.indexOf(b.ruolo);
    if (ra !== rb) return ra - rb;
    return Number(b.prezzo || 0) - Number(a.prezzo || 0);
  });
  if (!rosa.length) {
    wrap.innerHTML = `<div class="empty">Rosa vuota. Acquista dalla tab Asta Live.</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Ruolo</th><th>Nome</th><th>Sq</th><th>Prezzo</th><th>QA</th><th>FVM</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${rosa
            .map(
              (r) => `
            <tr>
              <td><span class="badge ${r.ruolo}">${r.ruolo}</span></td>
              <td><strong>${escapeHtml(r.nome)}</strong></td>
              <td>${escapeHtml(r.squadra || "")}</td>
              <td><strong>${r.prezzo}</strong></td>
              <td>${r.qa ?? "-"}</td>
              <td>${r.fvm ?? "-"}</td>
              <td><button class="btn btn-danger" data-sell="${escapeHtml(r.id)}" type="button">Svincola</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function fillSettingsForm() {
  $("setTeamName").value = app.state.teamName || "";
  $("setLeagueName").value = app.state.leagueName || "";
  $("setBudget").value = app.state.budget_iniziale || 500;
  $("setTP").value = app.state.target_reparti?.P ?? 50;
  $("setTD").value = app.state.target_reparti?.D ?? 125;
  $("setTC").value = app.state.target_reparti?.C ?? 150;
  $("setTA").value = app.state.target_reparti?.A ?? 175;
  $("setDbUrl").value = app.state.db_url || "";
}

function renderAll() {
  updateDbChip();
  renderDashboard();
  renderPrelista();
  renderAstaSelect();
  renderRosa();
}

function updateDbChip() {
  const chip = $("dbStatusChip");
  if (app.dbError) {
    chip.textContent = "Listone offline";
    chip.classList.remove("live");
    return;
  }
  const n = app.meta.player_count || app.players.length;
  chip.textContent = `Listone live · ${n}`;
  chip.classList.add("live");
}

async function loadDb({ force = false } = {}) {
  $("dbStatusChip").textContent = "Listone…";
  try {
    const { payload, fromCache } = await fetchPlayersDb(app.state.db_url, { force });
    app.players = payload.players || [];
    app.meta = payload.meta || {};
    app.fromCache = fromCache;
    app.dbError = null;
    renderAll();
    if (force) toast("Listone aggiornato");
  } catch (err) {
    app.dbError = err.message || String(err);
    app.players = app.players || [];
    updateDbChip();
    renderDashboard();
    toast(`Errore listone: ${app.dbError}`, true);
  }
}

function switchPanel(name) {
  document.querySelectorAll(".nav-tabs button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.panel === name);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${name}`);
  });
  if (name === "asta") renderAstaSelect();
  if (name === "prelista") renderPrelista();
  if (name === "rosa") renderRosa();
  if (name === "dashboard") renderDashboard();
  if (name === "settings") fillSettingsForm();
}

function bindEvents() {
  $("navTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-panel]");
    if (!btn) return;
    switchPanel(btn.dataset.panel);
  });

  $("btnRefreshDb").addEventListener("click", () => {
    clearDbCache();
    loadDb({ force: true });
  });

  ["preSearch", "preRole", "preTeam", "preList"].forEach((id) => {
    $(id).addEventListener("input", renderPrelista);
    $(id).addEventListener("change", renderPrelista);
  });

  $("preTableBody").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const tr = btn.closest("tr[data-id]");
    const id = tr?.dataset.id;
    if (!id) return;
    if (btn.dataset.act === "fav") {
      app.state = toggleList(app.state, "preferiti", id);
      persist();
      renderPrelista();
    }
    if (btn.dataset.act === "wish") {
      app.state = toggleList(app.state, "wishlist", id);
      persist();
      renderPrelista();
    }
    if (btn.dataset.act === "asta") {
      app.selectedId = id;
      $("astaSearch").value = "";
      $("astaFocus").value = "all";
      switchPanel("asta");
      renderAstaSelect();
      $("astaPlayer").value = id;
      $("astaPrice").dataset.touched = "";
      renderAstaPlayerCard();
    }
  });

  ["astaSearch", "astaRole", "astaFocus"].forEach((id) => {
    $(id).addEventListener("input", () => {
      $("astaPrice").dataset.touched = "";
      renderAstaSelect();
    });
    $(id).addEventListener("change", () => {
      $("astaPrice").dataset.touched = "";
      renderAstaSelect();
    });
  });

  $("astaPlayer").addEventListener("change", () => {
    $("astaPrice").dataset.touched = "";
    renderAstaPlayerCard();
  });

  $("astaPrice").addEventListener("input", () => {
    $("astaPrice").dataset.touched = "1";
    renderAstaPlayerCard();
  });

  $("btnBuy").addEventListener("click", () => {
    const player = currentAstaPlayer();
    if (!player) return;
    const result = buyPlayer(app.state, player, $("astaPrice").value);
    if (result.error) {
      toast(result.error, true);
      return;
    }
    app.state = result.state;
    persist();
    $("astaPrice").dataset.touched = "";
    toast(`${player.nome} acquistato a ${Math.floor(Number($("astaPrice").value))} crediti`);
    renderAll();
  });

  $("btnFavAsta").addEventListener("click", () => {
    const p = currentAstaPlayer();
    if (!p) return;
    app.state = toggleList(app.state, "preferiti", p.id);
    persist();
    renderAstaPlayerCard();
    renderPrelista();
  });

  $("btnWishAsta").addEventListener("click", () => {
    const p = currentAstaPlayer();
    if (!p) return;
    app.state = toggleList(app.state, "wishlist", p.id);
    persist();
    renderAstaPlayerCard();
    renderPrelista();
  });

  $("rosaTableWrap").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-sell]");
    if (!btn) return;
    app.state = sellPlayer(app.state, btn.dataset.sell);
    persist();
    toast("Giocatore svincolato");
    renderAll();
  });

  $("btnSaveSettings").addEventListener("click", async () => {
    const prevUrl = app.state.db_url;
    app.state.teamName = $("setTeamName").value.trim() || "La Mia Squadra";
    app.state.leagueName = $("setLeagueName").value.trim();
    app.state.budget_iniziale = Number($("setBudget").value) || 500;
    app.state.target_reparti = {
      P: Number($("setTP").value) || 0,
      D: Number($("setTD").value) || 0,
      C: Number($("setTC").value) || 0,
      A: Number($("setTA").value) || 0,
    };
    app.state.db_url = $("setDbUrl").value.trim();
    persist();
    toast("Impostazioni salvate");
    if (app.state.db_url !== prevUrl) {
      clearDbCache();
      await loadDb({ force: true });
    } else {
      renderAll();
    }
  });

  $("btnExport").addEventListener("click", () => {
    const blob = new Blob([exportStateJson(app.state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fanta-backup-${(app.state.teamName || "squadra").replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      app.state = importStateJson(text);
      persist();
      fillSettingsForm();
      clearDbCache();
      await loadDb({ force: true });
      toast("Backup importato");
    } catch (err) {
      toast(`Import fallito: ${err.message}`, true);
    } finally {
      e.target.value = "";
    }
  });

  $("btnReset").addEventListener("click", () => {
    if (!confirm("Reset rosa, preferiti e wishlist? Le impostazioni restano.")) return;
    app.state = resetAuctionLists(app.state);
    persist();
    toast("Asta resettata");
    renderAll();
  });
}

bindEvents();
fillSettingsForm();
loadDb();
