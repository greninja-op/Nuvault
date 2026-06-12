# Nuvault — Crucial Things

Operational notes and gotchas for running, maintaining, and recovering the Nuvault app.
Last updated: 2026-06-12.

> **Security note:** This file deliberately contains **no** real passwords or API keys.
> All secrets live only in `server/.env` (which is gitignored). This file tells you *where*
> things are and *how* they work, not the secret values themselves.

---

## 1. Project layout & stack

- **Root:** `c:\my files in athuls lap\projects\fino`
- **Backend:** Node.js + Express + Mongoose, in `server/`
- **Frontend:** React + Vite + Tailwind, in `client/`
- **Repo:** `https://github.com/greninja-op/Nuvault.git` (branch `main`)
- **Single port:** Express serves the built client from `client/dist` AND the API on **port 5001**.
  Open the app at `http://localhost:5001`.

---

## 2. Database — MongoDB Atlas (migrated from local)

- The app now uses **MongoDB Atlas** (cloud), not local MongoDB.
- Cluster host: `nuvault-cluster.t77mhy6.mongodb.net`, database `nuvaultDB`.
- The connection string (`MONGO_URI`) lives in `server/.env`. Format:
  `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/nuvaultDB?retryWrites=true&w=majority&appName=<appName>`
- Local fallback (if ever needed): `mongodb://127.0.0.1:27017/nuvaultDB`

### ⚠️ DNS gotcha (important — caused a failed migration once)

- `mongodb+srv://` URIs require **SRV DNS record** lookups.
- This laptop's default DNS (home router → ISP) **silently drops SRV queries**, which makes
  the Mongo driver fail with `querySrv ECONNREFUSED`.
- **Fix applied at OS level:** Wi-Fi adapter DNS was changed to Google DNS (`8.8.8.8`, `8.8.4.4`).
  - To check:  `(Get-DnsClientServerAddress -InterfaceIndex 9 -AddressFamily IPv4).ServerAddresses`
  - To revert (run as admin): `Set-DnsClientServerAddress -InterfaceIndex 9 -ResetServerAddresses`
  - Note: the Wi-Fi InterfaceIndex was `9` at time of writing — confirm with `Get-NetAdapter`.
- **Fix applied at code level (belt-and-suspenders):** `server.js`, `backup.js`, and `restore.js`
  call `dns.setServers(['8.8.8.8','1.1.1.1','8.8.4.4'])` automatically when the URI starts with
  `mongodb+srv://`. So even on a machine with bad ISP DNS, the app resolves Atlas correctly.

### ⚠️ Atlas Network Access

- Atlas only accepts connections from allowlisted IPs. Under Atlas → **Network Access**, the
  server's public IP must be listed (or `0.0.0.0/0` for a dev laptop). Otherwise connections hang.
- This laptop's public IP can change; if Atlas suddenly refuses connections, re-check this first.

---

## 3. Secrets — where they live

All in `server/.env` (gitignored, never committed). Verify on disk with `Get-Content server/.env`,
not the editor (the editor sometimes shows unsaved buffers).

| Key | Purpose |
|-----|---------|
| `MONGO_URI` | Atlas connection string |
| `JWT_SECRET` | Signs auth tokens |
| `JWT_EXPIRE` | Token lifetime |
| `GEMINI_API_KEY` | Gemini AI key(s) — **comma-separated list** for rotation (3 keys currently) |
| `EXCHANGERATE_API_KEY` | Currency conversion |
| `CLIENT_ORIGIN` | CORS / CSP allowed origins |

- `server/.env.example` is the committed template (placeholders only).
- **TODO / recommended:** rotate the Atlas DB password and any API keys that were pasted into
  chat during setup — assume anything typed into chat history is no longer private.

---

## 4. AI Advisor (Gemini) — how it's wired

- Controller: `server/controllers/aiController.js`. Calls Gemini via `axios` (no SDK).
- **Multiple API keys:** `GEMINI_API_KEY` is a comma-separated list. On quota exhaustion (HTTP 429)
  the controller rotates to the next key; a key gets a 60-second "blackout" after all its models 429.
- **Model rotation order** (per key), highest quota / quality first:
  1. `gemini-3-flash-preview`  (~1,500 RPD free tier)
  2. `gemini-2.5-flash`        (~250 RPD)
  3. `gemini-2.0-flash`        (~200 RPD)
  4. `gemini-2.5-flash-lite`   (~1,000 RPD)
- Total ≈ 2,950 requests/day **per key**; with 3 keys ≈ ~8,850/day.
- On total exhaustion the user sees: *"AI free-tier quota exceeded. Try again in a minute…"*
- `gemini-1.5-flash` does **NOT** work with these keys (returns 404) — do not switch to it.
- To add another key: append `,<newkey>` to `GEMINI_API_KEY` in `server/.env`, then
  `pm2 restart nuvault --update-env`. Get keys from **different Google accounts** (same-account
  keys share one quota).

---

## 5. Running the server (pm2)

- The app runs under **pm2**, process name `nuvault`, defined by `ecosystem.config.js`
  (`NODE_ENV: development` so dotenv loads `.env`).
- pm2 commands sometimes need `ignoreWarning: true` when run via tooling.

Common commands (run from `server/`):

```
pm2 list                          # see status
pm2 logs nuvault --lines 30       # view logs (out + err)
pm2 restart nuvault --update-env  # restart AND reload .env changes
pm2 stop nuvault
pm2 resurrect                     # restore saved process list
pm2 save                          # save current process list for auto-start
```

> After **any** `.env` change you must use `--update-env`, or pm2 keeps the old values.

---

## 6. Auto-start on reboot (Windows)

- **MongoDB:** N/A now (using Atlas cloud) — but the local MongoDB service is still `Automatic`.
- **Nuvault:** starts via **Task Scheduler**, not the Startup folder (the Startup folder approach
  was unreliable and was removed).
  - Task name: **"Nuvault Auto-Start"** — runs 15s after logon.
  - It runs `%USERPROFILE%\nuvault-startup.bat`, which waits for MongoDB then `pm2 resurrect`.
  - Log of each boot: `%USERPROFILE%\nuvault-startup.log`
  - If the app is down after a reboot, manual recovery: `pm2 resurrect` (from `server/`).
  - To remove auto-start: `schtasks /Delete /TN "Nuvault Auto-Start" /F` and delete the .bat.

---

## 7. Build / deploy cycle

- After **client** changes:  `npm run build` (in `client/`) then `pm2 restart nuvault`.
  pm2 serves the built `client/dist`, NOT live source — changes won't show until rebuilt.
- After **server** changes:  `pm2 restart nuvault` (no build needed).

---

## 8. Tests

- **Backend:** `npm test` in `server/` — currently **448 passing** (Jest).
- **Frontend:** `npx vitest --run` in `client/` — currently **24 passing**.
- Run these before committing significant changes.

---

## 9. Data backup / restore scripts (run from `server/`)

```
npm run backup    # dumps every collection to server/data/backup_<timestamp>.json
npm run restore   # restores the NEWEST backup into the DB in MONGO_URI
npm run seed      # wipes DB and seeds the test user + sample data
```

- `server/data/*.json` is gitignored (backups never committed).
- Restore preserves `_id`s, dates, and already-hashed passwords (login keeps working).
- **Migration note:** these scripts respect whatever `MONGO_URI` points at — so a `backup` while
  pointed at local then `restore` while pointed at Atlas is exactly how the cloud migration was done.

---

## 10. Test account

- Email: `test@nuvault.com`
- Password: `test123456`
- (Created by `npm run seed`.)

---

## 11. Quick troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "site can't be reached" on localhost:5001 | pm2 not running after reboot | `pm2 resurrect` from `server/` |
| `querySrv ECONNREFUSED` in logs | ISP DNS dropping SRV | confirm Wi-Fi DNS is 8.8.8.8 (see §2) |
| Atlas connection hangs/refuses | public IP not allowlisted | add IP in Atlas → Network Access |
| AI says "quota exceeded" | all Gemini keys hit daily limit | wait, or add another key (see §4) |
| `.env` change not taking effect | pm2 cached old env | `pm2 restart nuvault --update-env` |
| Client change not visible | dist not rebuilt | `npm run build` in `client/` then restart |

---

## 12. Git safety

- `server/.env`, `client/.env`, and `server/data/*.json` are gitignored — verified never committed.
- Before committing anything touching env: check `git ls-files`, `git check-ignore`, and
  `git log -S "<secret-prefix>"` to be sure no secret ever entered history.
