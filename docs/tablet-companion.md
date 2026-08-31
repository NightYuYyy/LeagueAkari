# Tablet Mayhem Companion

Tablet Mayhem Companion is a read-only remote view for League Akari. The Windows app publishes a
small champion-select snapshot to a Docker service. The browser uses the same OP.GG ARAM Mayhem
adapter and recommendation order as the desktop champion-data window. Because OP.GG's Mayhem
endpoint does not include loadouts, the page labels and combines regular OP.GG ARAM item, rune,
summoner-spell, and ability recommendations for the same champion.

Champion and augment metadata comes from GTIMG. Item, perk, style, and summoner-spell metadata comes
from Community Dragon. The server proxies only these allowlisted game assets through same-origin
`/api/assets/*` routes, so tablets do not need direct access to either CDN and the browser never acts
as a general-purpose image proxy.

## Data boundary

The publisher sends only:

- League Client connection state
- gameflow phase
- selected champion ID
- queue game mode and type
- assigned position
- publish timestamp

LCU credentials, Riot tokens, summoner identity, chat, match history, and local files are not sent.
The publish token remains in the Windows application's local settings and is never included in the
viewer URL.

## Threat model and security decisions

- The public room code is a capability URL. Use a long random value because anyone who knows it can
  view the current champion state.
- Publishing requires a separate high-entropy bearer token and uses constant-time comparison. The
  browser never receives this token.
- The server accepts a small schema-validated JSON body, applies per-IP request limits, disables
  cross-origin access, and sends a restrictive Content Security Policy.
- The container runs as the unprivileged `node` user with a read-only filesystem, all Linux
  capabilities dropped, and `no-new-privileges` enabled.
- Internet deployment terminates HTTPS at Nginx/Caddy. Plain HTTP is accepted only for local
  development.
- Room state is intentionally in memory. A container restart clears presence and selected champion
  state; the desktop heartbeat restores it automatically.

## Build and run locally

```powershell
corepack yarn build:tablet
$env:TABLET_ROOM_CODE = 'replace-with-a-random-room-code'
$env:TABLET_PUBLISH_TOKEN = 'replace-with-a-long-random-secret'
corepack yarn start:tablet
```

Open `http://127.0.0.1:4174/room/<room-code>`.

## Docker deployment

For production updates to the current Hong Kong deployment, follow the complete
[`tablet-companion-deploy.md`](tablet-companion-deploy.md) runbook. It defines the required backup,
candidate-container, immutable-image, public-cache, and rollback checks. The commands below are only
the generic first-deployment example.

```bash
cp .env.tablet.example .env.tablet
# Edit .env.tablet before continuing.
docker compose --env-file .env.tablet -f docker-compose.tablet.yml up -d --build
curl http://127.0.0.1:4174/health
```

Recommended Caddy configuration:

```caddyfile
akari.example.com {
  reverse_proxy 127.0.0.1:4174
}
```

Keep `TABLET_BIND=127.0.0.1` when using a reverse proxy. Use HTTPS for any Internet-facing
deployment. Generate the publish token and room code independently, for example:

```bash
openssl rand -hex 24
openssl rand -hex 12
```

## Configure League Akari

Open **Settings → Application → Tablet Mayhem Companion**, then configure:

1. Server URL, normally the public HTTPS origin.
2. Room code matching `TABLET_ROOM_CODE`.
3. Publish token matching `TABLET_PUBLISH_TOKEN`.
4. Enable remote view and run **Test Connection**.

The viewer follows the current pick automatically. Manual champion search works even when champion
select is inactive, as long as the remote service is online.

## Current room model

The first version intentionally supports one room per container. The protocol and URL already use a
room code, so a later multi-room service can replace the in-memory room store without changing the
desktop snapshot or the tablet page's core data contract.
