"""
Cricket Scorer — frontend navigation smoke

Drives the live frontend with a headless browser:
  1. Creates a match (via API) and scores a few balls so the public
     scorecard has real data to render.
  2. Navigates the live frontend (home, matches list, public live
     scorecard, summary, teams) and asserts each page's key data
     is actually painted into the DOM.
  3. Saves a screenshot of each page to ./screenshots/.

Usage:
    python scripts/frontend_smoke.py
    python scripts/frontend_smoke.py --api API_URL --front FRONTEND_URL
    python scripts/frontend_smoke.py --headed   # show the browser

Requires: requests, playwright. Auto-installs both on first run.
"""

import argparse
import os
import subprocess
import sys
import time
import uuid

# ── Auto-install ───────────────────────────────────────────────────
def _ensure(pkg, import_name=None):
    try:
        __import__(import_name or pkg)
    except ImportError:
        print(f"[setup] Installing {pkg}…")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", pkg])

_ensure("requests")
_ensure("playwright")

# Make sure the chromium binary is present
def _ensure_chromium():
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            p.chromium.launch().close()
    except Exception:
        print("[setup] Installing playwright chromium…")
        subprocess.check_call([sys.executable, "-m", "playwright", "install", "chromium"])

_ensure_chromium()

import requests
from playwright.sync_api import sync_playwright

# Force UTF-8 stdout on Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ── Colors ─────────────────────────────────────────────────────────
USE_COLOR = sys.stdout.isatty() or os.environ.get("FORCE_COLOR") == "1"
def _c(code, msg): return f"\033[{code}m{msg}\033[0m" if USE_COLOR else msg
green  = lambda s: _c("32", s)
red    = lambda s: _c("31", s)
gray   = lambda s: _c("90", s)
bold   = lambda s: _c("1",  s)

PASS = 0
FAIL = 0

def section(t):
    bar = '-' * max(0, 60 - len(t))
    print(f"\n{bold('-- ' + t + ' ' + bar)}")

def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  {green('PASS')} {label}   {gray(detail)}")
    else:
        FAIL += 1
        print(f"  {red('FAIL')} {label}   {red(detail)}")

# ── API setup ──────────────────────────────────────────────────────
class API:
    def __init__(self, base):
        self.base = base.rstrip('/')
        self.token = None
    def _h(self):
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}
    def post(self, path, body=None, auth=False):
        r = requests.post(self.base + path, json=body or {}, headers=self._h() if auth else {}, timeout=20)
        r.raise_for_status()
        return r.json().get("data")
    def get(self, path):
        r = requests.get(self.base + path, timeout=20)
        r.raise_for_status()
        return r.json().get("data")

def wait_for_api(base):
    for i in range(8):
        try:
            r = requests.get(base + "/health", timeout=15)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        if i == 0:
            print(gray("  /health cold-start, waiting…"))
        time.sleep(8)
    return False

def seed_match(api):
    """Create a match with a couple of balls scored so the live page has data."""
    tag = "F" + uuid.uuid4().hex[:6].upper()
    team_a = api.post("/api/teams", {"name": f"{tag}A"})
    team_b = api.post("/api/teams", {"name": f"{tag}B"})

    players_a = [api.post(f"/api/teams/{team_a['id']}/players",
                          {"name": f"A{i+1}", "role": "batsman" if i < 2 else "bowler", "batting_order": i+1})
                 for i in range(4)]
    players_b = [api.post(f"/api/teams/{team_b['id']}/players",
                          {"name": f"B{i+1}", "role": "batsman" if i < 2 else "bowler", "batting_order": i+1})
                 for i in range(4)]

    match = api.post("/api/matches", {
        "title": f"{tag} Live", "team_a_id": team_a["id"], "team_b_id": team_b["id"],
        "total_overs": 5, "players_per_side": 4, "wide_rule": "normal", "scorer_pin": "1234",
    })

    api.token = api.post(f"/api/matches/{match['id']}/verify-pin", {"pin": "1234"})["token"]

    api.post(f"/api/matches/{match['id']}/start", {
        "toss_winner_team_id": team_a["id"], "elected_to": "bat",
        "opening_batsman1_id": players_a[0]["id"],
        "opening_batsman2_id": players_a[1]["id"],
        "opening_bowler_id":   players_b[2]["id"],
    }, auth=True)

    for body in [{"runs": 4}, {"runs": 1}, {"runs": 6}, {"runs": 0}, {"runs": 2}]:
        api.post(f"/api/matches/{match['id']}/ball", body, auth=True)

    return match, team_a, team_b, tag

# ── Browser driver ─────────────────────────────────────────────────
SCREENS = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(SCREENS, exist_ok=True)

def visit(page, url, name, expectations, *, wait_for=None, wait_ms=2500):
    """Navigate to url, screenshot, then verify each expected snippet appears in the page text."""
    print(gray(f"\n  → {url}"))
    page.goto(url, wait_until="networkidle", timeout=45000)
    if wait_for:
        try:
            page.wait_for_selector(wait_for, timeout=8000)
        except Exception:
            pass
    page.wait_for_timeout(wait_ms)  # let React render + SSE settle
    shot = os.path.join(SCREENS, f"{name}.png")
    page.screenshot(path=shot, full_page=True)
    print(gray(f"    saved {shot}"))

    text = page.inner_text("body")
    for label, needle in expectations.items():
        check(f"{name}: {label}", needle in text, f"looked for '{needle}'")

def run(args):
    global PASS, FAIL
    PASS = FAIL = 0

    print(bold(f"\nCricket Scorer — frontend smoke"))
    print(gray(f"API   : {args.api}"))
    print(gray(f"Front : {args.front}"))
    print(gray(f"Shots : {SCREENS}\n"))

    section("Health + seed data")
    if not wait_for_api(args.api):
        check("API healthy", False, "could not reach /health")
        return PASS, FAIL
    check("API healthy", True)

    api = API(args.api)
    try:
        match, team_a, team_b, tag = seed_match(api)
        check("Seeded match with 5 balls", True, f"id={match['id']} tag={tag}")
    except Exception as e:
        check("Seeded match", False, str(e))
        return PASS, FAIL

    section("Browser navigation")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()

        # Home
        visit(page, args.front, "01_home", {
            "header brand":  "CRIC",
            "primary cta":   "matches",
        })

        # Matches list — should include our match
        visit(page, args.front + "/matches", "02_matches_list", {
            "our match title appears": tag + " Live",
            "live badge shows":        "Live",
        })

        # Public live scorecard — should show batting team and score
        visit(page, f"{args.front}/matches/{match['id']}/live", "03_match_live", {
            "match title shows":       match["title"],
            "batting team shows":      team_a["name"],
            "innings badge appears":   "INN",
            "a stat label appears":    "CRR",
        }, wait_for="text=INN")

        # Teams list
        visit(page, args.front + "/teams", "04_teams_list", {
            "team A appears":          team_a["name"],
            "team B appears":          team_b["name"],
        })

        # Team detail with roster
        visit(page, f"{args.front}/teams/{team_a['id']}", "05_team_detail", {
            "team name in header":     team_a["name"],
            "first player in roster":  "A1",
            "second player":           "A2",
        })

        # Score the chase to completion so we can hit the summary
        api.post(f"/api/matches/{match['id']}/innings/end", {
            "opening_batsman1_id": api.get(f"/api/teams/{team_b['id']}")["players"][0]["id"],
            "opening_batsman2_id": api.get(f"/api/teams/{team_b['id']}")["players"][1]["id"],
            "opening_bowler_id":   api.get(f"/api/teams/{team_a['id']}")["players"][2]["id"],
        }, auth=True)
        # smash the chase
        for _ in range(6):
            api.post(f"/api/matches/{match['id']}/ball", {"runs": 6}, auth=True)
        # ensure completed
        for _ in range(5):
            m = api.get(f"/api/matches/{match['id']}")
            if m["status"] == "completed":
                break
            time.sleep(1)

        # Summary
        visit(page, f"{args.front}/matches/{match['id']}/summary", "06_match_summary", {
            "result section":      "Result",
            "winner mentioned":    team_b["name"],
            "first innings team":  team_a["name"],
            "batting heading":     "Batting",
            "bowling heading":     "Bowling",
        }, wait_for="text=Result")

        browser.close()
    return PASS, FAIL


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--api",    default=os.environ.get("API_URL",   "https://cric-score-backend.onrender.com"))
    p.add_argument("--front",  default=os.environ.get("FRONTEND_URL", "https://cric-score-frontend-psi.vercel.app"))
    p.add_argument("--headed", action="store_true", help="show the browser window")
    args = p.parse_args()

    t0 = time.time()
    passed, failed = run(args)
    elapsed = time.time() - t0

    print()
    line = "=" * 65
    print(line)
    status = "OK" if failed == 0 else "FAILED"
    msg = f" {passed} passed, {failed} failed in {elapsed:.1f}s  [{status}]"
    print((green if failed == 0 else red)(bold(msg)))
    print(f" screenshots: {SCREENS}")
    print(line)
    sys.exit(0 if failed == 0 else 1)

if __name__ == "__main__":
    main()
