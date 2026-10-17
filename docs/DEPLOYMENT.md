# Running RecipeMixer away from your own computer

RecipeMixer is built to be private: it shows your recipes only to someone who knows the password, and by default
it only answers on the machine it runs on. This guide covers the other cases. Read the first section, pick the
**smallest exposure that does what you need**, and then follow only that part.

_Provider facts in this guide were checked on 2026-10-17. Prices, free allowances and limits change; the links
point to each provider's own page, and you should look at it before you rely on a number here._

## Which option?

| You want | Use | Cost |
|---|---|---|
| Use it on the computer it runs on | [1. On your own computer](#1-on-your-own-computer-the-default) | $0 |
| Open it on your phone, away from home, with nothing on the public internet | [2. Private access with Tailscale](#2-your-phone-away-from-home-without-the-public-internet-tailscale) (recommended) | $0 (personal plan) |
| A normal web address that works from anywhere | [3. A public address with HTTPS](#3-a-public-address-with-https-caddy) | the cost of a server and a name |
| A free server to run option 3 on | [4. A free virtual machine](#4-a-free-virtual-machine) | $0, with conditions |
| A tunnel instead of opening ports | [5. Cloudflare Tunnel](#5-cloudflare-tunnel) | check Cloudflare's page |

## How the protection works (so you can judge it)

- **One shared password.** You set `APP_PASSWORD` (or `APP_PASSWORD_FILE`). It must be at least 12 characters and
  not an obvious one. The app refuses to start otherwise, and tells you how to make a good one.
- **Everything but the page itself is behind the login.** That includes every recipe, search, import and every
  photo. The web app's own files (the page, scripts and styles) are public so that the login page can load; they
  contain none of your data.
- **Guessing is slowed down.** Five wrong passwords from one client lock that client out for 15 minutes (an IPv6
  user counts as a whole /64 network, because one person usually controls billions of addresses). After a burst of
  wrong passwords from anywhere, every attempt also has to wait a second. Both count real client addresses, which
  the app only knows when `TRUST_PROXY` is right: if a proxy is in front and the app has not been told, everyone
  looks like the proxy, and a stranger's five wrong tries would lock you out too. The app logs a warning when it sees
  proxy headers it was not told to trust.
- **Sessions are random tokens in a locked-down cookie** (`HttpOnly`, `SameSite=Strict`, and `Secure` over HTTPS).
  Logging out ends the session on the server. Changing the password ends every session. A session ends after a
  week of not being used, or 30 days after login.
- **Other sites cannot make your browser change your recipes**, and nothing private can be kept by a shared cache
  or CDN.
- **The app does not do HTTPS itself.** Over plain HTTP anyone on the network path can read the password and the
  session cookie. Always put HTTPS in front of any address other than your own computer (options 2 to 5 all do).
- **Passwords that are easy to guess are refused**, not only short ones: all digits, keyboard or alphabet runs,
  a repeated pattern, and common words with a few letters around them. A generated password (below) is expected.
- **There is no two-factor login and no password reset.** To change the password, change the setting and restart.
  For a stronger second layer, use option 2 (only your own devices can even reach it) or option 5 with Cloudflare
  Access.

## Making a password

```bash
node -e "console.log(require('node:crypto').randomBytes(18).toString('base64url'))"
```

Prefer `APP_PASSWORD_FILE` (a file that holds only the password) to `APP_PASSWORD`: a value in an environment
variable can be seen by anyone who can inspect the process or the container, a file with tight permissions
cannot. Keep the password in a password manager.

## Settings reference

| Setting | Default | What it does |
|---|---|---|
| `APP_PASSWORD` / `APP_PASSWORD_FILE` | none | The shared password, or the path of a file that holds it. Set only one. Empty values are refused. |
| `HOST` | `127.0.0.1` | The address to listen on. A password is required for anything else, unless `ALLOW_INSECURE_NO_AUTH=true`. |
| `TRUST_PROXY` | `false` | The address of your reverse proxy (an IP, a range such as `10.0.0.0/8`, or `loopback`, `linklocal`, `uniquelocal`). Only requests from there have their `X-Forwarded-For` and `X-Forwarded-Proto` believed. Plain `true` and hop counts are refused on purpose. |
| `COOKIE_SECURE` | `auto` | `true` always marks the cookie `Secure`; `auto` does so when the request arrived over HTTPS. |
| `ALLOWED_HOSTS` | none | Only used when no password is set: extra host names the app may be opened by. See below. |
| `ALLOW_INSECURE_NO_AUTH` | `false` | Lets a non-loopback `HOST` start with no password. Only for setups where the port is otherwise protected. |
| `URL_IMPORT_ENABLED` | `true` | `false` removes the "import from a link" feature entirely. |
| `MEALDB_ENABLED` | `false` | `true` adds a TheMealDB search to the Import page. Read [DATA-SOURCES.md](DATA-SOURCES.md) first: the service is not open source and its free key is for personal use. |
| `MEALDB_API_KEY` | `1` | The TheMealDB key (letters, digits, `-` and `_`). `1` is their free development key. A supporter key is a secret: keep it in the environment, never in the repository. |

## 1. On your own computer (the default)

Nothing to configure. `docker compose up -d` publishes the app on `127.0.0.1` only, and `npm start` listens on
`127.0.0.1`. No password is needed because only programs on your own computer can reach it.

Two protections work even without a password:

- A web page on another site cannot read or change your recipes (it would have to point its own name at your
  computer, a trick called DNS rebinding). The app only answers to `localhost`, `127.0.0.1` and `::1` unless you
  add names to `ALLOWED_HOSTS`.
- Writes that a browser says came from another site are refused.

If you open it from another device on your home network by IP address (for example `http://192.168.1.5:3210`),
you must either set a password (better) or list that name: `ALLOWED_HOSTS=192.168.1.5`. Home networks are shared
with every device on them, so a password is the right choice.

## 2. Your phone away from home, without the public internet (Tailscale)

[Tailscale](https://tailscale.com) joins your own devices into a private network. The app is never on the public
internet; only devices signed in to your Tailscale account can reach it. As of the date above the free Personal
plan allows up to 6 users and unlimited devices, for non-commercial use ([pricing](https://tailscale.com/pricing)).

1. Run RecipeMixer on a computer that is on most of the time (a home server, a Raspberry Pi, an old laptop), with
   a password: `APP_PASSWORD_FILE=/path/to/password npm start`, or the Docker setup below.
2. Install Tailscale on that computer and on your phone and sign in to the same account.
3. On the computer, put HTTPS in front of the app with
   [Tailscale Serve](https://tailscale.com/kb/1312/serve), for example `tailscale serve --bg 3210` (the exact
   command differs between Tailscale versions; follow the current page). You will first need to enable HTTPS
   certificates for your tailnet in the Tailscale admin page, which that page explains.
4. Open the `https://<machine>.<your-tailnet>.ts.net` address Tailscale prints, on your phone, and log in.

Notes:

- **Not tested by the author of this guide**: no tailnet was available. The app-side settings are the same as in
  option 3 and were tested there.
- Because the app has a password, there is nothing else to set. (Without a password the app would refuse the
  tailnet name, because it is not a loopback name; do not work around that with `ALLOWED_HOSTS`, set a password.)
- The login lockout counts every device on your tailnet as one address when the proxy runs on the same machine, so
  five wrong tries from one of your devices pause all of them for 15 minutes. That is fine for a private network.

## 3. A public address with HTTPS (Caddy)

This runs the app and [Caddy](https://caddyserver.com) (free and open source) together. Caddy gets and renews a
free certificate for your domain by itself. This setup was **built and tested** for this guide: login over HTTPS
sets the `Secure` and `__Host-` cookie, the app's own port is not reachable from outside, a faked
`X-Forwarded-For` is replaced by Caddy so the lockout counts the real address, five wrong passwords lock that
address, and sessions survive an app restart.

What you need: a server you can run Docker on, a domain name whose `A` record points to the server, and ports 80
and 443 open to the internet (Caddy needs both to get its certificate).

1. Get the code onto the server (`git clone https://github.com/amanoos/RecipeMixer.git`).
2. Make the password file (it is git-ignored):

   ```bash
   mkdir -p deploy/secrets
   node -e "console.log(require('node:crypto').randomBytes(18).toString('base64url'))" > deploy/secrets/recipemixer_password
   chmod 400 deploy/secrets/recipemixer_password
   sudo chown 1000:1000 deploy/secrets/recipemixer_password
   ```

   (The container runs as the unprivileged user with id 1000, so on a Linux server the file has to belong to that
   user and be readable only by it. Do not make it readable by everyone: any other user on the server could read it.
   On Docker Desktop (Windows, macOS) the `chown` is not needed.)
3. Start it with your own address:

   ```bash
   SITE_ADDRESS=recipes.example.com docker compose -f deploy/docker-compose.caddy.yml up -d --build
   ```
4. Open `https://recipes.example.com`, log in with the password, and save the password in your password manager.

To try it on your own computer first, leave `SITE_ADDRESS` unset (it uses `localhost` with a local certificate that
your browser will warn about) and add `HTTP_PORT=8080 HTTPS_PORT=8443` to use other ports.

Things to know:

- The app is **not published** to the server's network, only Caddy is. That is why `TRUST_PROXY` can be set to the
  private ranges (`uniquelocal`), which also means no fixed network address has to be chosen (a fixed one can
  clash with networks already on your machine). If you ever publish the app's port, put other containers on its
  network, or let machines on your local network reach the app's port directly, replace that value with Caddy's
  exact address: anything inside the trusted range can make up client addresses and dodge the login limits.
- **Not tested here:** Caddy's automatic redirect from `http://` to `https://` and certificate issuance for a
  real domain (the test used Caddy's local certificate). Both are standard Caddy behaviour; see
  [its documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
- Using another proxy (nginx, Traefik)? Make it send `X-Forwarded-For`, `X-Forwarded-Proto` and the original
  `Host` (or `X-Forwarded-Host`), set `TRUST_PROXY` to the proxy's address, and keep the app's port closed to
  everything else.

## 4. A free virtual machine

A small always-on server that runs option 3. Both providers below were read from their own pages on 2026-10-17.
**Free tiers change, may need a card on file, and can bill you for things outside the free amount**, so watch the
cost estimate in the console for the first days.

**Google Cloud** ([free tier page](https://docs.cloud.google.com/free/docs/free-cloud-features)):
one `e2-micro` VM a month in `us-west1`, `us-central1` or `us-east1`; 30 GB-months of **standard** persistent disk
(the default boot disk type is a different one, so choose "standard persistent disk" when creating the VM); and
1 GB a month of outbound data transfer from North America to other regions (China and Australia excluded). The
page does not say how an external IP address is billed, so check the estimate. Google may change the limits with
30 days' notice.

**Oracle Cloud Always Free** ([resources page](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)):
up to two small AMD VMs with 1 GB of memory each, or Arm capacity equal to 2 OCPUs and 12 GB (reduced from older
figures you may see elsewhere), and 200 GB of block storage in your home region. **Important:** the page says
Oracle may reclaim an Always Free instance that has been idle, defined as 95th-percentile CPU below 20%, network
below 20% (and, for Arm, memory below 20%) for 7 days. A quiet recipe app looks idle by that definition, so do not
count on an Oracle instance staying yours; keep backups.

Either way:

- 1 GB of memory is tight for building the Docker image on the server. Build elsewhere and copy the image, or add
  swap space. **Not tested by the author** on either provider.
- Open only ports 22 (ideally limited to your own address), 80 and 443 in the provider's firewall.
- Turn on automatic security updates for the operating system.
- Then follow option 3 on the VM.

## 5. Cloudflare Tunnel

[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) makes an
outbound-only connection from your server to Cloudflare, so you open no ports, and Cloudflare serves your name over
HTTPS. [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) can add a second
login in front of the app (for example "only my own email address").

- **Not verified:** the Cloudflare pages that could be read for this guide did not state the free-plan limits,
  whether a domain on Cloudflare is required, or whether a payment method is needed. Check their
  [plans](https://www.cloudflare.com/plans/zero-trust-services/) before relying on it being free.
- **Not tested by the author.** Run the app with a password and `TRUST_PROXY=loopback` if `cloudflared` runs on
  the same machine, point the tunnel at `http://localhost:3210`, and keep the app's port closed to everything else.
- Cloudflare terminates HTTPS and can see the traffic, including the password. That is a choice about trust, not a
  flaw, but make it knowingly.

## Not free

Hosting services that run your container for you (Fly.io, Render, Railway and similar) generally need a
**persistent disk** for the database and photos, and serverless platforms do not suit this app at all. Fly.io, for
example, listed no free allowance for new accounts when checked ([pricing](https://fly.io/docs/about/pricing/)).
If you use one: mount a volume at `DATA_DIR`, set `APP_PASSWORD` from the service's secret store, set
`TRUST_PROXY` to what the service documents for its proxy, and follow the checklist below.

## Before you put it on the internet: checklist

- [ ] A strong password in a file or secret store, and saved in your password manager
- [ ] HTTPS in front, and you opened the site once to check the padlock and that the login page shows
- [ ] The app's own port (3210) is **not** reachable from outside; only the proxy is
- [ ] `TRUST_PROXY` names your proxy (or is unset if there is none), never "true"
- [ ] Backups of the data folder (see the README) somewhere other than the same server
- [ ] A plan for updates: `git pull`, then rebuild and restart; read the release notes for new settings
- [ ] You know where the log is: wrong passwords show up as `login failed` lines with the address, never the password

## If the password leaks, or a device is lost

1. Change the password (the file or setting) and restart the app. Every existing session stops working at once,
   including the stolen device's.
2. If you reused the password anywhere, change it there too.
3. Look at the log for `login failed` lines around the time to see whether anyone was guessing.

## Known limits

- The login lockout is kept in memory, so it resets when the app restarts.
- If your session ends while the app is open (it expired), the page stays in the browser's memory behind the login
  so that a recipe you were editing is not lost; it is removed when you log out or close the tab.
- Logging out asks the browser to empty its cache for the site, so photos are not left on a shared device. Browsers
  that do not support that request (Safari, at the time of writing) keep photos until you clear them yourself.
- Importing from a link looks up host names with Node's helper threads. The Docker image sets
  `UV_THREADPOOL_SIZE=16` so a few slow lookups cannot hold up logins; if you run without Docker, set the same
  variable.
- A password in an environment variable is visible to anyone who can inspect the process; use the file form.
- There is one password for everyone who uses the app; there are no separate accounts, no two-factor login and no
  "forgot password".
- The app cannot protect itself from someone who can read the server's files or the password file.
- Recipes you import belong to their authors; keep an exposed library to your own use.
