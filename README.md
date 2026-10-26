# Yahrzeit / Family Feed Calendar

A self-hosted web app for a shared calendar of **birthdays, anniversaries, yahrzeits and other dates**, with **Hebrew and English dates** on everything. Each person subscribes **once** on their iPhone or Android phone, and from then on every event anyone adds, edits or deletes shows up on their phone automatically.

- **Hebrew dates by [Hebcal](https://www.hebcal.com/):** conversions, yahrzeit rules (Adar I and II, 30 Cheshvan and Kislev) and Hebrew lettering.
- **Optional Jewish holidays and candle-lighting times** from the Hebcal API. Each subscriber opts in, and holidays still work offline.
- **Enter dates the way you know them:** an English date (with an "after sunset" box) or a Hebrew date, with a live conversion as you type. Each event repeats on the Hebrew date, the English date, or both.
- **Permissions:** the admin gives each user Subscribe, View, Add, Edit own or any, Delete own or any, and Admin.
- **Accountability:** the admin sees who added and who edited each event, the full change history, and an activity log. Deleted events can be restored.
- **Stack:** Express API and React front end, TypeScript throughout, SQLite storage. See [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Install, build, run

You need **Node.js 22 or newer** (`node -v`). If you need to upgrade, use nvm: `nvm install 22 && nvm use 22`.

```bash
cd ~/Documents/yarzeight_feed_calendar
npm install
npm run build        # builds the React app and compiles the server
cp .env.example .env # optional; see "Server address"
npm start
```

Open **http://localhost:8080**. The first visit creates the admin account. It asks for a **setup code**, which the server prints in its log when it starts (e.g. `First-run setup code: A1B2C3-D4E5F6`). This stops anyone else on the network from claiming the admin account first.

**Developing:** `npm run dev` runs the server with the React app hot-reloading, on one port. `npm test` runs the tests, and `npm run typecheck` checks the types.

**Upgrading from earlier versions:** your data carries over automatically.
- **Version 1:** `data/db.json` is imported on first start and renamed `db.json.imported`. Users, passwords, events, history and feed links are all kept.
- **Version 2:** `data/calendar.sqlite` is used as-is.

## 2. Server address (important for phones)

Phones need an address they can reach. Find your computer's LAN IP with `hostname -I | awk '{print $1}'`, then put it in `.env`:

```
PUBLIC_URL=http://192.168.1.50:8080
```

If the firewall is on, allow the port: `sudo ufw allow 8080/tcp`.

On a LAN address, iPhones and the ICSx⁵ Android app sync while on your Wi-Fi. Google Calendar fetches feeds from Google's own servers, so it needs a public HTTPS address (see section 7).

## 3. Keep it running

```bash
mkdir -p ~/.config/systemd/user
cp deploy/feed-calendar.service ~/.config/systemd/user/
# using nvm? edit the NODE= line in that file to the output of: which node
systemctl --user daemon-reload && systemctl --user enable --now feed-calendar
sudo loginctl enable-linger $USER
journalctl --user -u feed-calendar -f     # logs
```

After pulling updates, run `npm install && npm run build`, then `systemctl --user restart feed-calendar`.

You can also run it with Docker: `docker compose up -d --build`.

## 4. Invite people (admin)

1. Go to **Users → + Invite someone** and pick a preset: Subscriber, Viewer, Contributor, Editor or Admin. You can then adjust individual permissions.
2. Send them the **setup link** (copy it, or use the WhatsApp button). It works once and lasts 14 days.
3. They choose a password and land on **Subscribe**, which has one-tap buttons for their phone.

For someone who only needs the calendar, send the **subscribe page link** from their user page instead. It needs no password.

## 5. On the phone (one time)

- **iPhone:** tap **Add to Apple Calendar**, then *Subscribe*, then *Add*.
- **Android with Google Calendar:** tap **Add to Google Calendar**, then *Add*. This needs a public HTTPS address.
- **Android with ICSx⁵:** install the free ICSx⁵ app, tap the webcal link, and set sync to hourly. This also works on a home-network address.

Each person chooses what their feed includes and when to be reminded. The **Users** page shows when each phone last synced.

## 6. Holidays & candle-lighting

Go to **Settings** and set:

- Israel or Diaspora schedule
- Which holiday groups to include
- A city for candle-lighting times

Data is downloaded from hebcal.com in the background, covering last year through two years ahead, and refreshed every 12 hours. If hebcal.com can't be reached, holidays are computed locally instead. Data © Hebcal.com, CC BY 4.0.

## 7. Later: going public (HTTPS)

Once you have a public HTTPS address (Cloudflare Tunnel, Tailscale Funnel, or a cloud VM using the Dockerfile), set:

```
PUBLIC_URL=https://calendar.yourdomain.com
TRUST_PROXY=1
HOST=127.0.0.1
```

`TRUST_PROXY=1` trusts exactly one proxy, the tunnel, to report each visitor's real IP address. `HOST=127.0.0.1` makes sure the tunnel is the only way in. Without it, someone could connect directly and fake their address to get around the sign-in limits.

This turns on secure cookies and strict HTTPS headers. Anyone who subscribed with the old LAN address then needs to subscribe again with the new link.

## 8. Data & backups

Everything is stored in `data/`:

- `calendar.sqlite` is the database.
- `secret.key` signs logins. Keep it private.
- `backups/` holds a daily copy, and the last 30 are kept.

Admins can also download a backup from Settings. To move servers, copy the `data/` folder.

**Protected links:** feed and invite links are never stored in plain text. The database keeps only a fingerprint (to recognise a link) and an encrypted copy (to show it again), both keyed by `secret.key`. That key is not part of backups, so a leaked database or backup doesn't reveal anyone's links.

**Logs:** feed, invite and subscribe-page tokens are replaced with `[redacted]` in the logs, and cookies and security tokens are never logged.

**License note:** the Hebcal libraries are GPL-2.0. That's fine for running it yourself. If you distribute the app, GPL terms apply.
