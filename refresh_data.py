import json
import urllib.request
import os

BASE = "https://api.jolpi.ca/ergast/f1"

def get(path):
    req = urllib.request.Request(BASE + path, headers={
        "User-Agent": "Mozilla/5.0", "Accept": "application/json"
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def num(x):
    f = float(x or 0)
    return int(f) if f == int(f) else f

def iso(d, t=None):
    return (d + "T" + (t or "12:00:00Z")) if d else None

def sess(race, key):
    s = race.get(key) or {}
    return iso(s.get("date"), s.get("time"))

# === LOAD EXISTING IMAGES TO PRESERVE THEM ===
def get_existing_images(filepath, name_key="name"):
    images = {}
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                for item in json.load(f):
                    if item.get("image"):
                        images[item.get(name_key)] = item["image"]
        except: pass
    return images

existing_driver_imgs = get_existing_images("data/drivers.json")
existing_team_imgs = get_existing_images("data/constructors.json")

# ---- Fetch Live Data ----
races = get("/current.json")["MRData"]["RaceTable"]["Races"]
timetable = [{
    "round": int(r["round"]), "name": r["raceName"],
    "circuit": (r.get("Circuit") or {}).get("circuitName", ""),
    "country": (r.get("Circuit") or {}).get("Location", {}).get("country", ""),
    "raceDate": iso(r.get("date"), r.get("time")),
    "practice1Date": sess(r, "FirstPractice"), "practice2Date": sess(r, "SecondPractice"),
    "practice3Date": sess(r, "ThirdPractice"), "qualifyingDate": sess(r, "Qualifying"),
    "sprintDate": sess(r, "Sprint")
} for r in races]

try:
    last = get("/current/last/results.json")["MRData"]["RaceTable"]["Races"][0]["Results"]
    last_points = {res["Driver"]["driverId"]: num(res.get("points")) for res in last}
except Exception:
    last_points = {}

st = get("/current/driverStandings.json")["MRData"]["StandingsTable"]["StandingsLists"][0]["DriverStandings"]
drivers = []
for i in st:
    d = i["Driver"]
    full_name = (d.get("givenName", "") + " " + d.get("familyName", "")).strip()
    drivers.append({
        "position": int(i["position"]),
        "name": full_name,
        "team": (i.get("Constructors") or [{}])[0].get("name", ""),
        "points": num(i.get("points")),
        "lastGpChange": last_points.get(d.get("driverId")),
        # KEEP THE IMAGE IF IT EXISTS!
        "image": existing_driver_imgs.get(full_name, "")
    })

ct = get("/current/constructorStandings.json")["MRData"]["StandingsTable"]["StandingsLists"][0]["ConstructorStandings"]
constructors = []
for i in ct:
    c = i["Constructor"]
    name = c.get("name", "")
    constructors.append({
        "position": int(i["position"]), "name": name,
        "nationality": c.get("nationality", ""), "points": num(i.get("points")),
        # KEEP THE IMAGE IF IT EXISTS!
        "image": existing_team_imgs.get(name, "")
    })

# ---- Save Files ----
for filename, payload in [
    ("data/timetable.json", timetable),
    ("data/drivers.json", drivers),
    ("data/constructors.json", constructors)
]:
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"Updated {filename}: {len(payload)} entries")