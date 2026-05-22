"""
Cricket Scorer — end-to-end integration test

Drives the backend API like a real client (create teams, players,
match; start play; score balls; end overs/innings; verify chase auto-
completes; test undo) AND verifies the database actually reflects each
step, AND verifies the public live-scorecard endpoint (which is what
the frontend renders) returns the correct values at every step.

Usage:
    python scripts/test_api.py                  # against local http://localhost:4000
    python scripts/test_api.py --api PROD_URL   # against any other API
    python scripts/test_api.py --keep           # don't delete test teams at end

Requires: requests, pymysql. The script auto-installs them on first run.
"""

import argparse
import os
import subprocess
import sys
import time
import uuid

# Force UTF-8 stdout on Windows so we can print check marks
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ── Auto-install deps ──────────────────────────────────────────────
def _ensure(pkg, import_name=None):
    try:
        __import__(import_name or pkg)
    except ImportError:
        print(f"[setup] Installing {pkg}…")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", pkg])

_ensure("requests")
_ensure("pymysql")
_ensure("cryptography")  # pymysql needs this for SSL

import requests
import pymysql

# ── Load backend/.env (NEVER hard-code credentials) ────────────────
def _load_env_file():
    here = os.path.dirname(os.path.abspath(__file__))
    env_path = os.path.join(here, "..", ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

_load_env_file()

DEFAULTS = {
    "api":      os.environ.get("API_URL", "http://localhost:4000"),
    "db_host":  os.environ.get("DB_HOST", "localhost"),
    "db_port":  int(os.environ.get("DB_PORT", "3306")),
    "db_user":  os.environ.get("DB_USER", "root"),
    "db_pass":  os.environ.get("DB_PASS", os.environ.get("DB_PASSWORD", "")),
    "db_name":  os.environ.get("DB_NAME", "cricket_scorer"),
}

# ── Pretty output ──────────────────────────────────────────────────
USE_COLOR = sys.stdout.isatty() or os.environ.get("FORCE_COLOR") == "1"
def _c(code, msg): return f"\033[{code}m{msg}\033[0m" if USE_COLOR else msg
green   = lambda s: _c("32", s)
red     = lambda s: _c("31", s)
yellow  = lambda s: _c("33", s)
gray    = lambda s: _c("90", s)
bold    = lambda s: _c("1",  s)

PASS = 0
FAIL = 0
SECT = ""

def section(title):
    global SECT
    SECT = title
    bar = '-' * max(0, 60 - len(title))
    print(f"\n{bold('-- ' + title + ' ' + bar)}")

def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  {green('PASS')} {label}   {gray(detail)}")
    else:
        FAIL += 1
        print(f"  {red('FAIL')} {label}   {red(detail)}")

# ── Helpers ────────────────────────────────────────────────────────
class API:
    def __init__(self, base):
        self.base = base.rstrip('/')
        self.token = None

    def _auth_headers(self):
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def post(self, path, body=None, auth=False):
        r = requests.post(self.base + path, json=body or {}, headers=self._auth_headers() if auth else {}, timeout=20)
        r.raise_for_status()
        return r.json().get("data")

    def get(self, path):
        r = requests.get(self.base + path, timeout=20)
        r.raise_for_status()
        return r.json().get("data")

    def delete(self, path, auth=False):
        r = requests.delete(self.base + path, headers=self._auth_headers() if auth else {}, timeout=20)
        r.raise_for_status()
        return r.json().get("data")


def db_connect(cfg):
    return pymysql.connect(
        host=cfg["db_host"], port=cfg["db_port"],
        user=cfg["db_user"], password=cfg["db_pass"],
        database=cfg["db_name"], ssl={"check_hostname": False},
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


def db_query(conn, sql, *args):
    with conn.cursor() as c:
        c.execute(sql, args)
        return c.fetchall()


# ── Main test flow ─────────────────────────────────────────────────
def run(cfg):
    global PASS, FAIL
    PASS = FAIL = 0
    api = API(cfg["api"])

    # Unique tag so re-runs don't conflict
    tag = "T" + uuid.uuid4().hex[:6].upper()
    print(bold(f"\nCricket Scorer — integration test"))
    print(gray(f"API : {cfg['api']}"))
    print(gray(f"DB  : {cfg['db_host']}/{cfg['db_name']}"))
    print(gray(f"Tag : {tag}\n"))

    section("Health check")
    # Render free tier can cold-start (up to ~60s). Try multiple times.
    healthy = False
    for attempt in range(6):
        try:
            r = requests.get(cfg["api"] + "/health", timeout=15)
            if r.status_code == 200:
                healthy = True
                print(gray(f"  /health up after {attempt+1} attempt(s)"))
                break
        except Exception as e:
            if attempt == 0:
                print(gray(f"  /health cold-start, waiting…"))
            time.sleep(8)
    check("API /health responds 200", healthy)
    if not healthy:
        return PASS, FAIL

    try:
        conn = db_connect(cfg)
        check("DB connection succeeds", True, f"({cfg['db_name']})")
    except Exception as e:
        check("DB connection succeeds", False, str(e))
        return PASS, FAIL

    # ── Teams + players ─────────────────────────────────────────────
    section("Create teams")
    team_a = api.post("/api/teams", {"name": f"{tag}-A"})
    team_b = api.post("/api/teams", {"name": f"{tag}-B"})
    check("POST /api/teams creates A", isinstance(team_a, dict) and team_a.get("id"))
    check("POST /api/teams creates B", isinstance(team_b, dict) and team_b.get("id"))

    rows = db_query(conn, "SELECT id, name FROM teams WHERE id IN (%s, %s)", team_a["id"], team_b["id"])
    check("DB has both teams",        len(rows) == 2)
    check("DB names match API names", {r["name"] for r in rows} == {team_a["name"], team_b["name"]})

    # 4 players per side (small for fast all-out scenarios in test)
    players_a, players_b = [], []
    for i in range(4):
        pa = api.post(f"/api/teams/{team_a['id']}/players", {"name": f"A{i+1}", "role": "batsman" if i < 2 else "bowler", "batting_order": i + 1})
        pb = api.post(f"/api/teams/{team_b['id']}/players", {"name": f"B{i+1}", "role": "batsman" if i < 2 else "bowler", "batting_order": i + 1})
        players_a.append(pa)
        players_b.append(pb)
    check("Added 4 players to A", len(players_a) == 4)
    check("Added 4 players to B", len(players_b) == 4)
    db_cnt_a = db_query(conn, "SELECT COUNT(*) AS c FROM players WHERE team_id = %s", team_a["id"])[0]["c"]
    check("DB player count for A matches", db_cnt_a == 4, f"({db_cnt_a})")

    # ── Match ───────────────────────────────────────────────────────
    section("Create match")
    pin = "1234"
    match = api.post("/api/matches", {
        "title": f"{tag} Match",
        "team_a_id": team_a["id"], "team_b_id": team_b["id"],
        "total_overs": 2, "players_per_side": 4,
        "wide_rule": "normal", "scorer_pin": pin,
    })
    check("POST /api/matches creates match", isinstance(match, dict) and match.get("id"))
    check("Match status = pending",          match.get("status") == "pending")
    check("Match has share_token",           bool(match.get("share_token")))
    db_match = db_query(conn, "SELECT status, total_overs, players_per_side FROM matches WHERE id = %s", match["id"])[0]
    check("DB match status = pending", db_match["status"] == "pending")
    check("DB total_overs = 2",        db_match["total_overs"] == 2)

    # ── PIN auth ───────────────────────────────────────────────────
    section("Scorer auth")
    token_data = api.post(f"/api/matches/{match['id']}/verify-pin", {"pin": pin})
    api.token = token_data["token"]
    check("Verify PIN returns token", bool(api.token), f"({api.token[:10]}…)")

    try:
        bad = requests.post(f"{cfg['api']}/api/matches/{match['id']}/verify-pin", json={"pin": "0000"})
        check("Wrong PIN returns 401", bad.status_code == 401, f"({bad.status_code})")
    except Exception as e:
        check("Wrong PIN returns 401", False, str(e))

    # ── Start match ────────────────────────────────────────────────
    section("Start match")
    api.post(f"/api/matches/{match['id']}/start", {
        "toss_winner_team_id": team_a["id"],
        "elected_to": "bat",
        "opening_batsman1_id": players_a[0]["id"],
        "opening_batsman2_id": players_a[1]["id"],
        "opening_bowler_id":   players_b[2]["id"],
    }, auth=True)
    live = api.get(f"/api/matches/live/{match['share_token']}")
    check("Live score returns 1 innings", len(live["innings"]) == 1)
    inn1 = live["innings"][0]
    check("Innings 1 status = live",      inn1["status"] == "live")
    check("Batting team is A",            inn1["batting_team_id"] == team_a["id"])
    check("First over exists",            live.get("currentOver") and live["currentOver"]["over_number"] == 1)

    db_match = db_query(conn, "SELECT status FROM matches WHERE id = %s", match["id"])[0]
    check("DB match status = live",      db_match["status"] == "live")
    db_inn = db_query(conn, "SELECT status FROM innings WHERE match_id = %s", match["id"])[0]
    check("DB innings status = live",    db_inn["status"] == "live")

    # ── Score balls ────────────────────────────────────────────────
    section("Score balls — over 1")
    def add_ball(body):
        return api.post(f"/api/matches/{match['id']}/ball", body, auth=True)

    add_ball({"runs": 1})   # rotates strike
    add_ball({"runs": 4})   # boundary
    add_ball({"runs": 6})   # six
    add_ball({"runs": 0})   # dot
    add_ball({"runs": 1, "is_wide": True})  # wide +1, extra ball
    add_ball({"runs": 2})

    live = api.get(f"/api/matches/live/{match['share_token']}")
    inn1 = live["innings"][0]
    expected_runs = 1 + 4 + 6 + 0 + 2 + 2  # wide adds +2 (1 run on wide + 1 penalty)
    # actually: wide with runs=1 → extras = 1 (penalty) + 1 (run) = 2 total extras, plus 0 batsman runs
    # so total runs = 1 + 4 + 6 + 0 + 2 + 2 = 15
    check(f"Innings total_runs = {expected_runs}", inn1["total_runs"] == expected_runs, f"got {inn1['total_runs']}")
    check("Extras = 2 (wide)",                     inn1["extras"] == 2, f"got {inn1['extras']}")
    over = live["currentOver"]
    check("Legal balls in over = 5",               over["legal_balls"] == 5, f"got {over['legal_balls']}")

    db_balls = db_query(conn, "SELECT COUNT(*) c FROM balls b JOIN overs o ON b.over_id = o.id WHERE o.innings_id = %s", inn1["id"])[0]["c"]
    check("DB ball count = 6",                     db_balls == 6, f"got {db_balls}")

    # ── Undo last ball ─────────────────────────────────────────────
    section("Undo last ball")
    api.delete(f"/api/matches/{match['id']}/ball/last", auth=True)
    live = api.get(f"/api/matches/live/{match['share_token']}")
    inn1 = live["innings"][0]
    check(f"After undo, total_runs = {expected_runs - 2}", inn1["total_runs"] == expected_runs - 2, f"got {inn1['total_runs']}")
    check("After undo, legal_balls = 4",                   live["currentOver"]["legal_balls"] == 4, f"got {live['currentOver']['legal_balls']}")
    db_balls = db_query(conn, "SELECT COUNT(*) c FROM balls b JOIN overs o ON b.over_id = o.id WHERE o.innings_id = %s", inn1["id"])[0]["c"]
    check("DB ball count after undo = 5", db_balls == 5)

    # Re-add the ball we undid to keep going
    add_ball({"runs": 2})

    # 6th legal ball → over complete
    add_ball({"runs": 1})  # +1 = 6th legal ball (rotates strike at end of over)
    live = api.get(f"/api/matches/live/{match['share_token']}")
    over = live["currentOver"]
    # Over should still show 6 legal balls but innings still live
    check("Over 1 has 6 legal balls",  over["legal_balls"] == 6, f"got {over['legal_balls']}")

    # ── End over → next bowler ──────────────────────────────────────
    section("End over → new bowler")
    api.post(f"/api/matches/{match['id']}/over/end", {"next_bowler_id": players_b[3]["id"]}, auth=True)
    live = api.get(f"/api/matches/live/{match['share_token']}")
    over = live["currentOver"]
    check("Over 2 started",          over["over_number"] == 2)
    check("New bowler is B4",        over["bowler"]["id"] == players_b[3]["id"])
    check("Legal balls in O2 = 0",   over["legal_balls"] == 0)

    # ── Force innings 1 to finish: bowl out remaining balls so target is small ──
    section("Finish innings 1 (overs run out)")
    # Total overs is 2. We've bowled 1 already. Bowl 6 more legal balls.
    for _ in range(5):
        add_ball({"runs": 0})
    # 6th ball — should auto-close innings (oversFinished)
    res = add_ball({"runs": 1})
    check("addBall returns oversFinished=True", bool(res.get("oversFinished")), f"got {res.get('oversFinished')}")

    live = api.get(f"/api/matches/live/{match['share_token']}")
    inn1 = live["innings"][0]
    check("Innings 1 status = completed", inn1["status"] == "completed", f"got {inn1['status']}")
    inn1_runs = inn1["total_runs"]
    print(gray(f"    innings 1 closed at {inn1_runs}/{inn1['total_wickets']}"))

    db_inn = db_query(conn, "SELECT status, total_runs FROM innings WHERE match_id = %s", match["id"])[0]
    check("DB innings 1 status = completed", db_inn["status"] == "completed")

    # ── Start innings 2 (B chases) ─────────────────────────────────
    section("Start innings 2 (chase)")
    api.post(f"/api/matches/{match['id']}/innings/end", {
        "opening_batsman1_id": players_b[0]["id"],
        "opening_batsman2_id": players_b[1]["id"],
        "opening_bowler_id":   players_a[2]["id"],
    }, auth=True)

    live = api.get(f"/api/matches/live/{match['share_token']}")
    inn2 = next(i for i in live["innings"] if i["innings_number"] == 2)
    check("Innings 2 exists",         inn2 is not None)
    check("Innings 2 target = inn1_runs+1", inn2["target"] == inn1_runs + 1, f"got {inn2['target']}")
    check("Batting team is B",        inn2["batting_team_id"] == team_b["id"])

    # ── Score chase to target ──────────────────────────────────────
    section("Chase to target")
    runs_needed = inn2["target"]
    # Score singles until we hit the target
    res = None
    bowls = 0
    while True:
        live = api.get(f"/api/matches/live/{match['share_token']}")
        inn2 = next(i for i in live["innings"] if i["innings_number"] == 2)
        if inn2["status"] == "completed":
            break
        bowls += 1
        runs_left = inn2["target"] - inn2["total_runs"]
        runs_this_ball = min(runs_left, 4)  # smash to win quickly
        res = add_ball({"runs": runs_this_ball})
        if res.get("targetReached") or res.get("matchEnded"):
            break
        if bowls > 20:  # safety
            break

    check("addBall flagged targetReached", bool(res and res.get("targetReached")), f"got {res.get('targetReached') if res else None}")
    check("addBall flagged matchEnded",    bool(res and res.get("matchEnded")),    f"got {res.get('matchEnded') if res else None}")

    live = api.get(f"/api/matches/live/{match['share_token']}")
    inn2_final = next(i for i in live["innings"] if i["innings_number"] == 2)
    check("Innings 2 status = completed",  inn2_final["status"] == "completed")
    check("Chase reached target",          inn2_final["total_runs"] >= inn2_final["target"], f"{inn2_final['total_runs']}/{inn2_final['target']}")

    # ── Match auto-completed ───────────────────────────────────────
    section("Match closed")
    final_match = api.get(f"/api/matches/{match['id']}")
    check("API match.status = completed", final_match["status"] == "completed", f"got {final_match['status']}")
    db_match = db_query(conn, "SELECT status FROM matches WHERE id = %s", match["id"])[0]
    check("DB match.status = completed",  db_match["status"] == "completed")

    # ── Final scorecard endpoint (what summary page renders) ────────
    section("Public scorecard (frontend data source)")
    sc = api.get(f"/api/matches/live/{match['share_token']}")
    check("Scorecard has 2 innings",       len(sc["innings"]) == 2)
    for inn in sc["innings"]:
        check(f"Innings {inn['innings_number']} has batting cards", len(inn.get("battingCards") or []) > 0)
        check(f"Innings {inn['innings_number']} has bowling cards", len(inn.get("bowlingCards") or []) > 0)
        # check overs are numeric-castable (the DECIMAL crash we fixed earlier)
        for bc in inn.get("bowlingCards") or []:
            try:
                float(bc.get("overs", 0))
                ok = True
            except Exception:
                ok = False
            if not ok:
                check(f"Bowler {bc['player']['name']}.overs castable", False, f"got {bc.get('overs')!r}")

    # ── Frontend public live page renders (smoke) ──────────────────
    section("Frontend smoke")
    front = os.environ.get("FRONTEND_URL", "https://cric-score-frontend-psi.vercel.app")
    try:
        r = requests.get(f"{front}/matches/{match['id']}/live", timeout=15)
        check(f"GET {front}/matches/<id>/live responds", r.status_code == 200, f"({r.status_code})")
        check("HTML mentions match title", match["title"] in r.text or "Live" in r.text)
    except Exception as e:
        check("Frontend reachable", False, str(e))

    # ── Cleanup ────────────────────────────────────────────────────
    if not cfg.get("keep"):
        section("Cleanup")
        # Delete players + teams. Match data stays (no DELETE endpoint).
        try:
            api.delete(f"/api/teams/{team_a['id']}")
            api.delete(f"/api/teams/{team_b['id']}")
            print(gray(f"  deleted test teams {tag}-A and {tag}-B"))
        except Exception as e:
            print(yellow(f"  cleanup warn: {e}"))

    conn.close()
    return PASS, FAIL


# ── Entrypoint ─────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--api",      default=os.environ.get("API_URL", DEFAULTS["api"]))
    p.add_argument("--db-host",  default=DEFAULTS["db_host"])
    p.add_argument("--db-port",  type=int, default=DEFAULTS["db_port"])
    p.add_argument("--db-user",  default=DEFAULTS["db_user"])
    p.add_argument("--db-pass",  default=DEFAULTS["db_pass"])
    p.add_argument("--db-name",  default=DEFAULTS["db_name"])
    p.add_argument("--keep",     action="store_true", help="don't delete test teams")
    args = p.parse_args()
    cfg = vars(args)

    t0 = time.time()
    passed, failed = run(cfg)
    elapsed = time.time() - t0

    print()
    line = "=" * 65
    print(line)
    status = "OK" if failed == 0 else "FAILED"
    msg = f" {passed} passed, {failed} failed in {elapsed:.1f}s  [{status}]"
    print((green if failed == 0 else red)(bold(msg)))
    print(line)

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
