/**
 * Multi-profilo: ogni fanta ha rosa/preferiti/budget separati (localStorage).
 */

import { getDefaultDbUrl } from "./db.js";

const STORE_KEY = "fanta_store_v2";
const LEGACY_KEY = "fanta_team_state_v1";

export const ROLE_ORDER = ["P", "D", "C", "A"];
export const ROLE_LABELS = {
  P: "Portieri",
  D: "Difensori",
  C: "Centrocampisti",
  A: "Attaccanti",
};

const DEFAULT_TARGET = { P: 50, D: 125, C: 150, A: 175 };

function uid() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultState(overrides = {}) {
  return {
    id: overrides.id || uid(),
    teamName: overrides.teamName || "Fanta 1",
    leagueName: overrides.leagueName || "",
    budget_iniziale: overrides.budget_iniziale ?? 500,
    target_reparti: { ...DEFAULT_TARGET, ...(overrides.target_reparti || {}) },
    preferiti: [...(overrides.preferiti || [])].map(String),
    wishlist: [...(overrides.wishlist || [])].map(String),
    rosa: Array.isArray(overrides.rosa) ? [...overrides.rosa] : [],
    db_url: overrides.db_url || getDefaultDbUrl(),
  };
}

function normalizeProfile(raw) {
  const base = defaultState(raw || {});
  if (raw?.id) base.id = String(raw.id);
  base.budget_iniziale = Number(base.budget_iniziale) || 500;
  base.target_reparti = { ...DEFAULT_TARGET, ...(raw?.target_reparti || {}) };
  base.preferiti = (raw?.preferiti || []).map(String);
  base.wishlist = (raw?.wishlist || []).map(String);
  base.rosa = Array.isArray(raw?.rosa) ? raw.rosa : [];
  base.db_url = raw?.db_url || getDefaultDbUrl();
  return base;
}

function defaultStore() {
  const first = defaultState({ teamName: "Fanta 1" });
  return { activeId: first.id, profiles: [first] };
}

function migrateLegacyIfNeeded() {
  try {
    if (localStorage.getItem(STORE_KEY)) return;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    const saved = JSON.parse(legacy);
    if (!saved || typeof saved !== "object") return;
    const profile = normalizeProfile({ ...saved, teamName: saved.teamName || "Fanta 1" });
    const store = { activeId: profile.id, profiles: [profile] };
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

export function loadStore() {
  migrateLegacyIfNeeded();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultStore();
    const parsed = JSON.parse(raw);
    if (!parsed?.profiles?.length) return defaultStore();
    const profiles = parsed.profiles.map(normalizeProfile);
    let activeId = parsed.activeId;
    if (!profiles.some((p) => p.id === activeId)) {
      activeId = profiles[0].id;
    }
    return { activeId, profiles };
  } catch {
    return defaultStore();
  }
}

export function saveStore(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

/** @deprecated use loadStore + getActiveProfile — kept for clarity in app */
export function loadState() {
  return getActiveProfile(loadStore());
}

export function saveState(state, store = loadStore()) {
  const next = upsertActiveProfile(store, state);
  saveStore(next);
  return next;
}

export function getActiveProfile(store) {
  return (
    store.profiles.find((p) => p.id === store.activeId) ||
    store.profiles[0] ||
    defaultState()
  );
}

export function upsertActiveProfile(store, state) {
  const active = normalizeProfile({ ...state, id: store.activeId || state.id });
  const profiles = store.profiles.map((p) => (p.id === active.id ? active : p));
  if (!profiles.some((p) => p.id === active.id)) {
    profiles.push(active);
  }
  return { ...store, activeId: active.id, profiles };
}

export function listProfiles(store) {
  return store.profiles.map((p) => ({
    id: p.id,
    label: p.leagueName ? `${p.teamName} · ${p.leagueName}` : p.teamName,
  }));
}

export function switchProfile(store, profileId) {
  if (!store.profiles.some((p) => p.id === profileId)) return store;
  return { ...store, activeId: profileId };
}

export function createProfile(store, { teamName, leagueName } = {}) {
  const profile = defaultState({
    teamName: teamName || `Fanta ${store.profiles.length + 1}`,
    leagueName: leagueName || "",
  });
  return {
    activeId: profile.id,
    profiles: [...store.profiles, profile],
  };
}

export function deleteProfile(store, profileId) {
  if (store.profiles.length <= 1) {
    throw new Error("Serve almeno un profilo.");
  }
  const profiles = store.profiles.filter((p) => p.id !== profileId);
  const activeId = store.activeId === profileId ? profiles[0].id : store.activeId;
  return { activeId, profiles };
}

export function exportStateJson(state) {
  return JSON.stringify(state, null, 2);
}

export function importStateJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("File non valido");
  }
  // Import singolo profilo (anche se vecchio backup senza id)
  return normalizeProfile({ ...parsed, id: parsed.id || uid() });
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
