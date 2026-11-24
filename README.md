# Family Hub

A kitchen-wall touchscreen for the family: week calendar, per-kid chore charts with a "do these first" gate, points + a reward shop, meal plan, memory verse (with ESV audio), photo slideshow, and a kids' money page. A DIY Skylight with no subscription and rules you set.

It's a plain web app (vanilla JS, no build step) served by a Cloudflare Worker, shown full-screen by a Raspberry Pi 5 mounted inside a Waveshare 27" touch monitor. Phones and laptops can open the same URL; everyone shares one state.

**Parts list + where to buy:** [`docs/hardware.html`](docs/hardware.html) (~$610 core build).

```
app/            the hub (index.html, app.js, app.css) + worker.js (API) + wrangler.jsonc
app/data.js     ← THE file you edit: kids, chores, rewards, sample events
pi/             kiosk setup for the Raspberry Pi + small helpers
scripts/        optional: Plan to Eat meal-plan fetch
docs/           hardware page
```

## 1. Try it on your laptop (2 minutes)

```bash
cd app
python3 -m http.server 8080
open "http://localhost:8080/"
```

You'll see a dev frame. Useful URL switches: `?kiosk=1` (native full-screen), `?view=cal:week|kid:ava|shop|meals|verse|photos|money|parents`, `?fast=1` (short idle timers), `?date=2026-12-01` (pretend it's another day). Parents PIN is `1234` (change it in `data.js` → `settings.pin`).

Locally, the `/api/*` features (shared state, live calendars, weather, verse audio, photos) are off; everything else works from `localStorage`.

## 2. Make it yours: `app/data.js`

- `familyName`, `settings.place` (weather label), `settings.pin`
- `kids`: `id` (lowercase), name, color, weekly `goal`, optional `dob` for the Money tab's age-18 projection
- `chores[kidId]`: each chore has `kind`:
  - `base`: all must be done before anything else unlocks that day
  - `daily`: extra, `capPerDay`
  - `weekly`: `perWeek` times a week
  - `ungated: true` means tappable anytime (feed the fish, shower)
- `rewards`: label + cost in points (add `kids: ["ava"]` to limit one to specific kids)
- `verseSeries`: memory-verse plan (≈4 weekly parts, then the whole passage)
- `events`, `highlights`, `birthdays`: samples so the calendar isn't empty

After the first deploy, parents edit chores, rewards, verse, money, screen settings and photos **on the wall** (🔒 Parents). Those edits live in shared state and override `data.js`.

## 3. Put it on the internet (Cloudflare, free tier)

```bash
npm i -g wrangler        # or use npx
wrangler login
cd app
npx wrangler kv namespace create HUB_STATE          # paste the id into wrangler.jsonc
npx wrangler r2 bucket create family-hub-photos     # photo storage (needs R2 enabled on the account; free tier is fine)
```

Edit `app/wrangler.jsonc`:
- `name`: becomes `https://<name>.<your-account>.workers.dev`. Pick something unguessable if you don't want strangers finding it, since there's no login, only the parent PIN.
- `vars.KIDS`: comma list of kid ids (calendar events whose title names a kid get tagged to them)
- `vars.WEATHER_LAT / WEATHER_LON / WEATHER_PLACE / TZ`

```bash
npx wrangler deploy
```

### Optional secrets

| Feature | How |
|---|---|
| **Live Google calendars** | Google Calendar → each calendar's Settings → *Secret address in iCal format*. Make a JSON file:<br>`[{"label":"Family","url":"https://calendar.google.com/calendar/ical/.../basic.ics","kind":"family"},{"label":"Work","url":"...","kind":"jason"}]`<br>(`kind:"jason"` = a parent's work calendar; the **Family** filter hides it, **Dad** shows only it. Rename in `app.js` `CALF` if you like.)<br>`cat feeds.json \| npx wrangler secret put CAL_FEEDS`. Refreshes every ~10 min, no redeploy. Keep that file out of git. |
| **Verse text + narration** | Free personal key at [api.esv.org](https://api.esv.org/). `npx wrangler secret put ESV_API_KEY` |
| **Meals from Plan to Eat** | Planner → Share → iCal link. `PLAN_TO_EAT_ICS='https://…' python3 scripts/fetch_plan_to_eat.py` writes `app/data/meals.json`; redeploy. |
| **Photos** | Parents → Photos uploads from any phone (shrinks to 1920 px). Stored in R2. |

## 4. The Raspberry Pi kiosk

Hardware assembly is on the [hardware page](docs/hardware.html#build-order). Then:

1. **Raspberry Pi Imager** → Raspberry Pi OS (64-bit) with desktop. In OS customisation set hostname `familyhub`, user `hub`, your WiFi, and your SSH public key. (`pi/user-data.example` is the CLI equivalent.)
2. Boot it in the monitor, then from your computer:
   ```bash
   scp pi/hub-local.py hub@familyhub.local:
   ssh hub@familyhub.local "HUB_URL='https://<name>.<account>.workers.dev/?kiosk=1' bash -s" < pi/setup_kiosk.sh
   ssh hub@familyhub.local 'mkdir -p ~/.local/bin && mv ~/hub-local.py ~/.local/bin/'
   ssh hub@familyhub.local 'sudo reboot'
   ```
   That sets up: auto-login, Chromium full-screen on the hub, no screen blanking, a launcher that waits for WiFi (and gives up after 90 s and shows the cached copy), a watchdog that restarts Chromium if the page dies, and a 4 a.m. reboot (skipped if offline).
3. **WiFi watchdog** (recommended; Pi 5 WiFi sometimes doesn't come back after a router reboot):
   ```bash
   scp pi/hub-wifi-watchdog.sh pi/hub-wifi-watchdog.cron hub@familyhub.local:
   ssh hub@familyhub.local 'sudo install -m755 hub-wifi-watchdog.sh /usr/local/bin/ && sudo cp hub-wifi-watchdog.cron /etc/cron.d/hub-wifi-watchdog'
   ```
4. **Screen brightness / power from the wall.** `pi/hub-local.py` runs on `127.0.0.1:8777` and drives the panel over DDC (`ddcutil`) and the volume over `wpctl`. Parents → Screen & sound uses it; quiet hours (default 7:30 pm to 7 am) actually turn the panel off, and a tap wakes it. `sudo apt install ddcutil` if the setup script didn't.

### Updating

Edit, `npx wrangler deploy`. The wall checks for a new build every 5 minutes and reloads itself once nobody's touched it for a minute.

### Debugging the wall from your computer

```bash
ssh hub@familyhub.local 'curl -s 127.0.0.1:9222/json'      # page title should be "Family Hub"
ssh -f -N -L 9223:127.0.0.1:9222 hub@familyhub.local && node pi/cdp.mjs 'location.href'   # run JS inside the wall
ssh hub@familyhub.local 'tail ~/hub-kiosk.log'
```

Gotchas we hit:
- Never `pkill -f chromium.*kiosk` over ssh; it matches your own ssh command. Use `pkill -x chromium`.
- Shared state is last-write-wins and KV reads lag ~60 s, so two screens tapped in the same minute can briefly disagree.
- Rewards/chores edited on the wall live in KV, so editing `data.js` afterward doesn't change them. Use Parents → Reset or edit on the wall.

## How it works (short)

- `app.js`: the whole UI. State `S` = `data.js` seed + `localStorage` + shared state from `GET/PUT /api/state`.
- `worker.js`: serves the static files and `/api/state` (KV), `/api/events` (parses + expands iCal feeds incl. RRULEs), `/api/weather` (Open-Meteo), `/api/verse-audio` + `/api/verse-text` (ESV, cached 30 days), `/api/photos` (R2).
- `sw.js`: service worker so the wall still shows the last good calendar/chores when the internet's down (with a "No internet" chip).
