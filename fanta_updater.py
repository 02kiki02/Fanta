#!/usr/bin/env python3
"""
Aggiorna il database Fantacalcio (Serie A) da fantacalcio.it.

Fonti:
  - Quotazioni Classic/Mantra + FVM: pagina quotazioni HTML
  - Probabili formazioni: pagina probabili (titolarità / %)

Output:
  - data/fantacalcio_db.json
  - data/fantacalcio_db.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DEFAULT_SEASON = "2025-26"
BASE_URL = "https://www.fantacalcio.it"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0.0.0 Safari/537.36"
)

ROLE_CLASSIC_LABEL = {
    "p": "P",
    "d": "D",
    "c": "C",
    "a": "A",
}

TEAM_ID_TO_CODE: dict[str, str] = {}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
            "Referer": f"{BASE_URL}/",
        }
    )
    return session


def fetch_html(session: requests.Session, url: str, timeout: int = 45) -> str:
    response = session.get(url, timeout=timeout)
    response.raise_for_status()
    response.encoding = response.apparent_encoding or "utf-8"
    return response.text


def safe_int(value: str | None, default: int | None = None) -> int | None:
    if value is None:
        return default
    text = value.strip().replace("*", "")
    if not text or text == "-":
        return default
    try:
        return int(float(text.replace(",", ".")))
    except ValueError:
        return default


def cell_text(row: Any, col_key: str) -> str:
    el = row.select_one(f'td[data-col-key="{col_key}"]')
    return el.get_text(strip=True) if el else ""


def extract_player_id(href: str | None) -> str | None:
    if not href:
        return None
    # .../squadre/inter/martinez-l/2764/2025-26  oppure .../2764
    match = re.search(r"/(\d+)(?:/\d{4}-\d{2})?/?$", href.rstrip("/"))
    if match:
        return match.group(1)
    parts = href.rstrip("/").split("/")
    for part in reversed(parts):
        if part.isdigit():
            return part
    return None


def parse_quotazioni(html: str, season: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "lxml")
    players: list[dict[str, Any]] = []

    for row in soup.select("tr.player-row"):
        name = (row.get("data-filter-keywords") or "").strip()
        role_classic_raw = (row.get("data-filter-role-classic") or "").strip().lower()
        role_mantra_raw = (row.get("data-filter-role-mantra") or "").strip().lower()
        team_id = (row.get("data-filter-team-id") or "").strip()
        playeds = safe_int(row.get("data-filter-playeds"), 0) or 0

        link = row.select_one("a.player-link")
        href = link.get("href") if link else None
        if link and not name:
            span = link.select_one("span")
            name = (span.get_text(strip=True) if span else link.get_text(strip=True))

        squadra = cell_text(row, "sq")

        if team_id and squadra:
            TEAM_ID_TO_CODE[team_id] = squadra

        qi = safe_int(cell_text(row, "c_qi"), 0)
        qa = safe_int(cell_text(row, "c_qa"), 0)
        fvm = safe_int(cell_text(row, "c_fvm"), 0)
        qi_mantra = safe_int(cell_text(row, "m_qi"), 0)
        qa_mantra = safe_int(cell_text(row, "m_qa"), 0)
        fvm_mantra = safe_int(cell_text(row, "m_fvm"), 0)

        mantra_slots = [
            span.get("data-value", "").strip().lower()
            for span in row.select("span.role-mantra")
            if span.get("data-value")
        ]
        if not mantra_slots and role_mantra_raw:
            mantra_slots = [role_mantra_raw]

        player_id = extract_player_id(href)
        if not name or not player_id:
            continue

        players.append(
            {
                "id": player_id,
                "nome": name,
                "ruolo": ROLE_CLASSIC_LABEL.get(role_classic_raw, role_classic_raw.upper()),
                "ruolo_mantra": "/".join(s.upper() for s in mantra_slots if s),
                "squadra": squadra,
                "team_id": team_id or None,
                "qi": qi or 0,
                "qa": qa or 0,
                "fvm": fvm or 0,
                "qi_mantra": qi_mantra or 0,
                "qa_mantra": qa_mantra or 0,
                "fvm_mantra": fvm_mantra or 0,
                "presenze_pct": playeds,
                "url": urljoin(BASE_URL, href) if href else None,
                "season": season,
                "probabile": None,
                "probabile_pct": None,
                "probabile_status": None,
            }
        )

    return players


def parse_probabili(html: str) -> dict[str, dict[str, Any]]:
    """Mappa player_id -> {probabile, pct, status, squadra}."""
    soup = BeautifulSoup(html, "lxml")
    by_id: dict[str, dict[str, Any]] = {}

    for match in soup.select("div.matches article, article.match, div.match, section.match"):
        # Fallback più generico sotto: se i selettori non matchano, usiamo i blocchi team
        pass

    # Struttura reale: blocchi team dentro .matches
    team_blocks = soup.select(".matches .team, .match .team, article .team")
    if not team_blocks:
        # Alcune versioni del markup usano header.team-name come ancora
        team_blocks = []
        for header in soup.select("h3.team-name"):
            parent = header.find_parent(["div", "article", "section", "li"])
            if parent:
                team_blocks.append(parent)

    for block in team_blocks:
        team_name_el = block.select_one("h3.team-name, .team-name")
        team_name = team_name_el.get_text(strip=True) if team_name_el else None
        formation_el = block.select_one(".team-formation")
        formation = formation_el.get_text(strip=True) if formation_el else None

        for list_name, status in (
            ("ul.player-list.starters", "titolare"),
            ("ul.player-list.reserves", "panchina"),
            ("ul.player-list.ballottaggio", "ballottaggio"),
            ("ul.starters", "titolare"),
            ("ul.reserves", "panchina"),
        ):
            for item in block.select(f"{list_name} li.player-item"):
                link = item.select_one("a.player-link")
                if not link:
                    continue
                href = link.get("href")
                player_id = extract_player_id(href)
                if not player_id:
                    continue

                pct_el = item.select_one(".progress-value")
                pct = safe_int(pct_el.get_text(strip=True).replace("%", "") if pct_el else None)

                if pct is None:
                    bar = item.select_one(".progress-bar")
                    if bar and bar.get("aria-valuenow"):
                        pct = safe_int(bar.get("aria-valuenow"))

                name_span = link.select_one("span")
                nome = name_span.get_text(strip=True) if name_span else link.get_text(strip=True)

                by_id[player_id] = {
                    "nome": nome,
                    "probabile": status == "titolare",
                    "probabile_pct": pct,
                    "probabile_status": status,
                    "squadra_nome": team_name,
                    "modulo": formation,
                }

        # Ballottaggi in figure/donut (se presenti fuori dalle liste)
        for ballot_item in block.select(".ballot a.player-link, li.ballot a.player-link"):
            href = ballot_item.get("href")
            player_id = extract_player_id(href)
            if not player_id or player_id in by_id:
                continue
            by_id[player_id] = {
                "nome": ballot_item.get_text(strip=True),
                "probabile": False,
                "probabile_pct": None,
                "probabile_status": "ballottaggio",
                "squadra_nome": team_name,
                "modulo": formation,
            }

    # Fallback globale: qualsiasi player-item con progress
    if not by_id:
        for item in soup.select("li.player-item"):
            link = item.select_one("a.player-link")
            if not link:
                continue
            player_id = extract_player_id(link.get("href"))
            if not player_id:
                continue
            parent_ul = item.find_parent("ul")
            classes = " ".join(parent_ul.get("class", [])) if parent_ul else ""
            if "starter" in classes:
                status = "titolare"
            elif "reserve" in classes:
                status = "panchina"
            else:
                status = "altro"
            pct_el = item.select_one(".progress-value")
            pct = safe_int(pct_el.get_text(strip=True).replace("%", "") if pct_el else None)
            by_id[player_id] = {
                "nome": link.get_text(strip=True),
                "probabile": status == "titolare",
                "probabile_pct": pct,
                "probabile_status": status,
                "squadra_nome": None,
                "modulo": None,
            }

    return by_id


def merge_probabili(
    players: list[dict[str, Any]], probabili: dict[str, dict[str, Any]]
) -> int:
    merged = 0
    for player in players:
        info = probabili.get(player["id"])
        if not info:
            continue
        player["probabile"] = info.get("probabile")
        player["probabile_pct"] = info.get("probabile_pct")
        player["probabile_status"] = info.get("probabile_status")
        merged += 1
    return merged


def write_outputs(players: list[dict[str, Any]], season: str, source_urls: dict[str, str]) -> tuple[Path, Path]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    json_path = DATA_DIR / "fantacalcio_db.json"
    csv_path = DATA_DIR / "fantacalcio_db.csv"

    payload = {
        "meta": {
            "season": season,
            "updated_at": utc_now_iso(),
            "source": "fantacalcio.it",
            "urls": source_urls,
            "player_count": len(players),
        },
        "players": players,
    }

    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    fieldnames = [
        "id",
        "nome",
        "ruolo",
        "ruolo_mantra",
        "squadra",
        "qi",
        "qa",
        "fvm",
        "qi_mantra",
        "qa_mantra",
        "fvm_mantra",
        "presenze_pct",
        "probabile",
        "probabile_pct",
        "probabile_status",
        "url",
        "season",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for player in players:
            writer.writerow(player)

    return json_path, csv_path


def run(season: str) -> int:
    session = build_session()
    quotazioni_url = f"{BASE_URL}/quotazioni-fantacalcio/{season}"
    # Redirect ufficiale senza stagione → stagione corrente; la path con stagione è più stabile
    probabili_url = f"{BASE_URL}/probabili-formazioni-serie-a"

    print(f"[fanta_updater] Stagione: {season}")
    print(f"[fanta_updater] Fetch quotazioni: {quotazioni_url}")
    quotazioni_html = fetch_html(session, quotazioni_url)
    players = parse_quotazioni(quotazioni_html, season)
    if not players:
        print("[fanta_updater] ERRORE: nessun giocatore trovato nella pagina quotazioni.", file=sys.stderr)
        return 1
    print(f"[fanta_updater] Giocatori quotazioni: {len(players)}")

    print(f"[fanta_updater] Fetch probabili: {probabili_url}")
    try:
        probabili_html = fetch_html(session, probabili_url)
        probabili = parse_probabili(probabili_html)
        merged = merge_probabili(players, probabili)
        print(f"[fanta_updater] Probabili matchati: {merged}/{len(probabili)}")
    except requests.RequestException as exc:
        print(f"[fanta_updater] AVVISO: probabili non disponibili ({exc})")

    players.sort(key=lambda p: (-(p.get("qa") or 0), p.get("nome") or ""))

    json_path, csv_path = write_outputs(
        players,
        season,
        {"quotazioni": quotazioni_url, "probabili": probabili_url},
    )
    print(f"[fanta_updater] Scritto: {json_path}")
    print(f"[fanta_updater] Scritto: {csv_path}")
    print(f"[fanta_updater] OK — {len(players)} giocatori")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Aggiorna fantacalcio_db.json / .csv")
    parser.add_argument(
        "--season",
        default=DEFAULT_SEASON,
        help=f"Stagione Fantacalcio (default: {DEFAULT_SEASON})",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return run(args.season)
    except requests.RequestException as exc:
        print(f"[fanta_updater] ERRORE di rete: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 — CLI entrypoint
        print(f"[fanta_updater] ERRORE: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
