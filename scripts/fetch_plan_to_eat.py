#!/usr/bin/env python3
"""Fetch the Plan to Eat 'recipes' iCal feed and write app/data/meals.json  {YYYY-MM-DD: "Recipe 1 · Recipe 2"}.
Feed URL comes from Plan to Eat → Planner → Share Meal Plan (secret URL, no login needed)."""
import re, json, sys, urllib.request, pathlib
import os
FEED = os.environ.get("PLAN_TO_EAT_ICS", "")  # Plan to Eat → Planner → Share → iCal link (keep it private)
out = pathlib.Path(__file__).resolve().parents[1] / "app" / "data" / "meals.json"; out.parent.mkdir(exist_ok=True)
if not FEED: sys.exit("set PLAN_TO_EAT_ICS to your Plan to Eat iCal link")
ics = urllib.request.urlopen(urllib.request.Request(FEED, headers={"User-Agent":"family-hub"}), timeout=60).read().decode("utf-8","replace")
ics = re.sub(r"\r?\n[ \t]", "", ics)  # unfold
meals = {}
for ev in ics.split("BEGIN:VEVENT")[1:]:
    d = re.search(r"DTSTART[^:]*:(\d{8})", ev); s = re.search(r"SUMMARY:(.*)", ev)
    if not d or not s: continue
    day = f"{d[1][:4]}-{d[1][4:6]}-{d[1][6:]}"; title = s[1].replace("\\,", ",").strip()
    meals.setdefault(day, []).append(title)
meals = {k: " · ".join(v) for k, v in sorted(meals.items())}
out.write_text(json.dumps(meals, indent=1)); print(f"{len(meals)} days → {out}")
