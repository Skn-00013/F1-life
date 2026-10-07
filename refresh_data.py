import json
import urllib.request

BASE = "https://api.jolpi.ca/ergast/f1"

def get(path):
    req = urllib.request.Request(BASE + path, headers={
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def num(x):
    f = float(x or 0)
    return int(f) if f == int(f) else f

def iso(d, t=None):
    if not d:
        return None
    return d + "T" + (t or "12:00:00Z")

def sess(race, key):
    s = race.get(key) or {}
    return iso(s.get("date"), s.get("time"))

# ---- Timetable ----
races = get("/current.json")["MRData"]["RaceTable"]["Races"]
timetable = [{
    "round": int(r["round"]),
    "name": r["raceName"],
    "circuit": (r.get("Circuit") or {}).get("circuitName", ""),
    "country": (r.get("Circuit") or {}).get("Location", {}).get("country", ""),
    "raceDate": iso(r.get("date"), r.get("time")),
    "practice1Date": sess(r, "FirstPractice"),
    "practice2Date": sess(r, "SecondPractice"),
    "practice3Date": sess(r, "ThirdPractice"),
    "qualifyingDate": sess(r, "Qualifying"),
    "sprintDate": sess(r, "Sprint")
} for r in races]

# ---- Last race points ----
try:
    last = get("/current/last/results.json")["MRData"]["RaceTable"]["Races"][0]["Results"]
    last_points = {res["Driver"]["driverId"]: num(res.get("points")) for res in last}
except Exception:
    last_points = {}

# ---- Drivers ----
st = get("/current/driverStandings.json")["MRData"]["StandingsTable"]["StandingsLists"][0]["DriverStandings"]
drivers = [{
    "position": int(i["position"]),
    "name": ((i["Driver"].get("givenName", "") + " " + i["Driver"].get("familyName", "")).strip()),
    "team": (i.get("Constructors") or [{}])[0].get("name", ""),
    "points": num(i.get("points")),
    "lastGpChange": last_points.get(i["Driver"].get("driverId")),
    "image": ""
} for i in st]

# ---- Constructors ----
ct = get("/current/constructorStandings.json")["MRData"]["StandingsTable"]["StandingsLists"][0]["ConstructorStandings"]
constructors = [{
    "position": int(i["position"]),
    "name": i["Constructor"].get("name", ""),
    "nationality": i["Constructor"].get("nationality", ""),
    "points": num(i.get("points")),
    "image": ""
} for i in ct]

for filename, payload in [
    ("data/timetable.json", timetable),
    ("data/drivers.json", drivers),
    ("data/constructors.json", constructors)
]:
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"Updated {filename}: {len(payload)} entries")