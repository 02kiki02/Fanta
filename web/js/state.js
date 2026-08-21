/**
 * Stato squadra / asta in localStorage (+ export/import).
 */

import { getDefaultDbUrl } from "./db.js";

const STORAGE_KEY = "fanta_team_state_v1";

export const ROLE_ORDER = ["P", "D", "C", "A"];
export const ROLE_LABELS = {
  P: "Portieri",
  D: "Difensori",
  C: "Centrocampisti",
  A: "Attaccanti",
};

const DEFAULT_TARGET = { P: 50, D: 125, C: 150, A: 175 };

export function defaultState() {
  return {
    teamName: "La Mia Squadra",
    leagueName: "",
    budget_iniziale: 500,
    target_reparti: { ...DEFAULT_TARGET },
    preferiti: [],
    wishlist: [],
    rosa: [],
    db_url: getDefaultDbUrl(),
  };
}

export function loadState() {
  const base = defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return base;
    const merged = { ...base, ...saved };
    merged.target_reparti = {
      ...DEFAULT_TARGET,
      ...(saved.target_reparti || {}),
    };
    merged.preferiti = (merged.preferiti || []).map(String);
    merged.wishlist = (merged.wishlist || []).map(String);
    merged.rosa = Array.isArray(merged.rosa) ? merged.rosa : [];
    merged.budget_iniziale = Number(merged.budget_iniziale) || 500;
    merged.db_url = merged.db_url || getDefaultDbUrl();
    return merged;
  } catch {
    return base;
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function exportStateJson(state) {
  return JSON.stringify(state, null, 2);
}

export function importStateJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("File non valido");
  }
  const merged = { ...defaultState(), ...parsed };
  merged.target_reparti = {
    ...DEFAULT_TARGET,
    ...(parsed.target_reparti || {}),
  };
  merged.preferiti = (merged.preferiti || []).map(String);
  merged.wishlist = (merged.wishlist || []).map(String);
  merged.rosa = Array.isArray(merged.rosa) ? merged.rosa : [];
  return merged;
}

export function rosaIds(state) {
  return new Set((state.rosa || []).map((x) => String(x.id)));
}

export function budgetSummary(state) {
  const rosa = state.rosa || [];
  const spent = rosa.reduce((sum, item) => sum + Number(item.prezzo || 0), 0);
  const initial = Number(state.budget_iniziale) || 0;
  const byRoleSpent = { P: 0, D: 0, C: 0, A: 0 };
  const byRoleCount = { P: 0, D: 0, C: 0, A: 0 };

  for (const item of rosa) {
    const role = item.ruolo;
    if (byRoleSpent[role] !== undefined) {
      byRoleSpent[role] += Number(item.prezzo || 0);
      byRoleCount[role] += 1;
    }
  }

  return {
    budget_iniziale: initial,
    spesi: spent,
    residui: initial - spent,
    num_acquisti: rosa.length,
    byRoleSpent,
    byRoleCount,
    targets: {
      P: Number(state.target_reparti?.P || 0),
      D: Number(state.target_reparti?.D || 0),
      C: Number(state.target_reparti?.C || 0),
      A: Number(state.target_reparti?.A || 0),
    },
  };
}

export function toggleList(state, listKey, playerId) {
  const id = String(playerId);
  const list = (state[listKey] || []).map(String);
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  return { ...state, [listKey]: next };
}

export function buyPlayer(state, player, price) {
  const id = String(player.id);
  if (rosaIds(state).has(id)) {
    return { state, error: "Giocatore già in rosa." };
  }
  const p = Math.floor(Number(price));
  if (!Number.isFinite(p) || p < 1) {
    return { state, error: "Il prezzo deve essere almeno 1." };
  }
  const summary = budgetSummary(state);
  if (p > summary.residui) {
    return { state, error: `Budget insufficiente (residui: ${summary.residui}).` };
  }

  const entry = {
    id,
    nome: player.nome,
    ruolo: player.ruolo,
    squadra: player.squadra,
    prezzo: p,
    qa: player.qa,
    fvm: player.fvm,
    acquired_at: new Date().toISOString(),
  };

  return {
    state: {
      ...state,
      rosa: [...(state.rosa || []), entry],
      preferiti: (state.preferiti || []).filter((x) => String(x) !== id),
      wishlist: (state.wishlist || []).filter((x) => String(x) !== id),
    },
    error: null,
  };
}

export function sellPlayer(state, playerId) {
  const id = String(playerId);
  return {
    ...state,
    rosa: (state.rosa || []).filter((x) => String(x.id) !== id),
  };
}

export function resetAuctionLists(state) {
  return {
    ...state,
    rosa: [],
    preferiti: [],
    wishlist: [],
  };
}
