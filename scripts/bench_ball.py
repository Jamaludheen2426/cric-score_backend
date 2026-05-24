"""
Measure ball-post latency against the live Render backend.

Creates a small throw-away match, then posts 10 balls back-to-back
and reports per-ball latency. Useful for verifying the speedup work.
"""

import os, sys, time, subprocess, uuid

def _ensure(pkg, import_name=None):
    try: __import__(import_name or pkg)
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", pkg])
_ensure("requests")

import requests

if sys.platform == "win32":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

API = os.environ.get("API_URL", "https://cric-score-backend.onrender.com")
print(f"API: {API}\n")

# warm up
for i in range(6):
    try:
        r = requests.get(API + "/health", timeout=15)
        if r.status_code == 200:
            print(f"warmed up after {i+1} attempt(s)")
            break
    except Exception: pass
    print(f"  cold-start, waiting…")
    time.sleep(8)
else:
    print("server never came up"); sys.exit(1)

# Create test data
tag = "B" + uuid.uuid4().hex[:6].upper()
post = lambda p, b=None, hdr=None: requests.post(API + p, json=b or {}, headers=hdr or {}, timeout=30).json()["data"]
get  = lambda p: requests.get(API + p, timeout=30).json()["data"]

print(f"\nseeding match tag={tag}…")
team_a = post("/api/teams", {"name": f"{tag}-A"})
team_b = post("/api/teams", {"name": f"{tag}-B"})
players_a = [post(f"/api/teams/{team_a['id']}/players", {"name": f"A{i}", "role": "batsman", "batting_order": i}) for i in range(1, 5)]
players_b = [post(f"/api/teams/{team_b['id']}/players", {"name": f"B{i}", "role": "bowler",  "batting_order": i}) for i in range(1, 5)]

match = post("/api/matches", {
    "title": f"{tag} bench", "team_a_id": team_a["id"], "team_b_id": team_b["id"],
    "total_overs": 10, "players_per_side": 4, "wide_rule": "normal", "scorer_pin": "9999",
})
token = post(f"/api/matches/{match['id']}/verify-pin", {"pin": "9999"})["token"]
H = {"Authorization": f"Bearer {token}"}

post(f"/api/matches/{match['id']}/start", {
    "toss_winner_team_id": team_a["id"], "elected_to": "bat",
    "opening_batsman1_id": players_a[0]["id"], "opening_batsman2_id": players_a[1]["id"],
    "opening_bowler_id":   players_b[0]["id"],
}, H)

print("\nposting 10 balls back-to-back:")
ms = []
for i in range(10):
    t0 = time.perf_counter()
    post(f"/api/matches/{match['id']}/ball", {"runs": 1 if i % 2 == 0 else 2}, H)
    t1 = time.perf_counter()
    elapsed = (t1 - t0) * 1000
    ms.append(elapsed)
    print(f"  ball {i+1:2d}: {elapsed:7.0f} ms")

print()
print(f"min      {min(ms):7.0f} ms")
print(f"max      {max(ms):7.0f} ms")
print(f"avg      {sum(ms)/len(ms):7.0f} ms")
sorted_ms = sorted(ms)
print(f"median   {sorted_ms[len(ms)//2]:7.0f} ms")
print()

# Don't leave the test team lying around
try:
    requests.delete(API + f"/api/teams/{team_a['id']}", timeout=15)
    requests.delete(API + f"/api/teams/{team_b['id']}", timeout=15)
except Exception:
    pass
