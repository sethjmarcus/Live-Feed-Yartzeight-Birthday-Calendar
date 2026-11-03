# Yahrzeit / Family Feed Calendar

A self-hosted web app for a shared calendar of **birthdays, anniversaries, yahrzeits and other dates**, with **Hebrew and English dates** on everything. Each person subscribes **once** on their iPhone or Android phone, and from then on every event anyone adds, edits or deletes shows up on their phone automatically.

- **Hebrew dates by [Hebcal](https://www.hebcal.com/):** conversions, yahrzeit rules (Adar I and II, 30 Cheshvan and Kislev) and Hebrew lettering.
- **Optional Jewish holidays and candle-lighting times** from the Hebcal API. Each subscriber opts in, and holidays still work offline.
- **Enter dates the way you know them:** an English date (with an "after sunset" box) or a Hebrew date, with a live conversion as you type. Each event repeats on the Hebrew date, the English date, or both.
- **Several calendars** (e.g. each side of the family). Each has its own members, and each member has a role in it: Subscriber, Viewer, Contributor, Editor or Owner, or custom permissions.
- **One phone setup per person.** Their feed holds every calendar they subscribe to, so a calendar they join later just appears.
- **Accountability:** owners see who added and edited each event, the full change history, and an activity log. Deleted events can be restored.
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

Open **http://localhost:8080**. The first visit creates the admin account and your first calendar. It asks for a **setup code**, which the server prints in its log when it starts (e.g. `First-run setup code: A1B2C3-D4E5F6`). This stops anyone else on the network from claiming the admin account first.

**Locked out?** On the server, in the app folder:
- `node dist/server/cli.js users` lists the accounts.
- `node dist/server/cli.js reset-link <username>` prints a one-time link to set a new password.

**Developing:** `npm run dev` runs the server with the React app hot-reloading, on one port. `npm test` runs the tests, and `npm run typecheck` checks the types.

**Upgrading from earlier versions:** your data carries over automatically.
- **Version 1:** `data/db.json` is imported on first start and renamed `db.json.imported`. Users, passwords, events, history and feed links are all kept.
- **Version 2 and single-calendar version 3:** `data/calendar.sqlite` is upgraded in place.
  - Everything becomes your first calendar, and everyone keeps exactly the permissions they had.
  - Admins become that calendar's owners, and app admins.
  - Feed links keep working. A backup is taken daily, but copying `data/` before upgrading never hurts.

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

## 4. Calendars and people

**Calendars** (app admin): create one per group, for example "Cohen side" and "Levi side". You become its owner.

**Roles** are set per calendar:

| Role | Can |
|---|---|
| Subscriber | Get the calendar on their phone |
| Viewer | + browse events in the app |
| Contributor | + add events, and edit or delete their own |
| Editor | + edit or delete anyone's events |
| Owner | + manage members and roles, see the activity log, restore deleted events |

Choose **Custom…** to tick individual permissions instead.

**Inviting someone:**
1. Use **Calendars → Manage → Invite someone new**, or **People → + Invite someone**.
2. Send them the **setup link** (copy it, or use the WhatsApp button). It works once and lasts 14 days.
3. They choose a password and land on **Subscribe**, which has one-tap buttons for their phone.

To add someone who already has an account to another calendar, use the calendar's page or theirs.

For someone who only needs the calendar, send the **subscribe page link** from their page under People instead. It needs no password.

**Owners** of a calendar can invite people to it and manage its members without being app admins.

**App admins** manage accounts, calendars, settings and backups. What they see of other people's calendars depends on `APP_ADMIN_ACCESS` in `.env`:
- `full` (default): they can open and manage every calendar. This suits one family.
- `metadata`: they see only each calendar's name and number of members and events. This suits unrelated families sharing one server.

Whoever runs the server can always read the database itself.

## 5. On the phone (one time)

- **iPhone:** tap **Add to Apple Calendar**, then *Subscribe*, then *Add*.
- **Android with Google Calendar:** tap **Add to Google Calendar**, then *Add*. This needs a public HTTPS address.
- **Android with ICSx⁵:** install the free ICSx⁵ app, tap the webcal link, and set sync to hourly. This also works on a home-network address.

Each person chooses what their feed includes (which calendars and event types) and when to be reminded. The **People** page shows when each phone last synced.

## 6. Holidays & candle-lighting

Go to **Settings** and set:

- Israel or Diaspora schedule
- Which holiday groups to include
- A city for candle-lighting times

Data is downloaded from hebcal.com in the background, covering last year through two years ahead, and refreshed every 12 hours. If hebcal.com can't be reached, holidays are computed locally instead. Data © Hebcal.com, CC BY 4.0.

## 7. Going public (HTTPS)

The recommended setup is **Cloudflare Tunnel**, with Cloudflare Access as an optional extra lock:
- The `cloudflared` program on the server keeps an outgoing connection to Cloudflare, so the server needs **no open ports** for the web.
- Cloudflare provides HTTPS and absorbs floods of traffic (DDoS).
- Access can require a one-time email code before anyone reaches the site. Leave `/feed/*` public, so phones and Google Calendar can fetch their calendars.

Then set:

```
PUBLIC_URL=https://calendar.yourdomain.com
TRUST_PROXY=1
HOST=127.0.0.1
CLIENT_IP_HEADER=cf-connecting-ip
```

- `HOST=127.0.0.1` makes the tunnel the only way in.
- `CLIENT_IP_HEADER` takes each visitor's real address from Cloudflare, for the sign-in and request limits.
- Without Cloudflare (for example Caddy on a cloud server), leave out `CLIENT_IP_HEADER`. `TRUST_PROXY=1` then trusts exactly one proxy to report the address.

This also turns on secure cookies and strict HTTPS headers. Anyone who subscribed with an old address needs to subscribe again with the new link.

## 8. Data & backups

Everything is stored in `data/`:

- `calendar.sqlite` is the database.
- `secret.key` signs logins. Keep it private.
- `backups/` holds a daily copy, and the last 30 are kept.

Admins can also download a backup from Settings. To move servers, copy the `data/` folder.

**Protected links:** feed and invite links are never stored in plain text. The database keeps only a fingerprint (to recognise a link) and an encrypted copy (to show it again), both keyed by `secret.key`. That key is not part of backups, so a leaked database or backup doesn't reveal anyone's links.

**Logs:** feed, invite and subscribe-page tokens are replaced with `[redacted]` in the logs, and cookies and security tokens are never logged. Failed sign-ins are logged with the username and address.

**Sign-ins** are kept on the server:
- Signing out ends a sign-in for real.
- A sign-in lapses after 30 days without use, and after 180 days regardless.
- **Account → Sign out on all other devices** ends every other sign-in, for a lost phone or a shared computer.
- Phone calendar feeds are separate links and keep working.

**Limits:** each address may make 300 requests a minute to the app and 60 feed requests a minute. Sign-in, setup and invite pages allow 20 tries per 15 minutes. Password-reset links last 24 hours; first-time setup links last 14 days.

**License note:** the Hebcal libraries are GPL-2.0. That's fine for running it yourself. If you distribute the app, GPL terms apply.
