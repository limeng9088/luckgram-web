# Luckgram Web relay

Luckgram Web talks to Telegram over WebSocket, at `wss://kws<dc>[-1].web.telegram.org/apiws[_premium]`.
Where those addresses cannot be reached the web app does not open, and a browser cannot be given a proxy.
The relay is one more way in: the browser connects to a Luckgram domain and the relay passes the
WebSocket on to Telegram as it is. (luckgram-specs#138, W2.)

```
wss://<relay>/<dc>[-1]/apiws[_premium]   →   wss://kws<dc>[-1].web.telegram.org/apiws[_premium]
```

- `dc` is 1–5; `-1` is Telegram's media (download / upload) endpoint. Anything else is answered 404.
- Only a WebSocket upgrade is forwarded (a plain request: 426). Binary frames go both ways unchanged. They are
  MTProto ciphertext: the relay cannot read them, and it does not parse, cache or log them.
- Only Luckgram Web may use it: the `Origin` has to be the production, development or backup address or a
  pull request preview (`src/rules.js`); any other, or none: 403. This keeps others from using it as a public
  relay — it is not access control, a non-browser client can send any `Origin`.
- Nothing about a user is kept: no IP address is read or logged and request logs are off (`wrangler.toml`).
  What is kept is counts — connections, bytes up and down, duration, errors, by DC and by client / media —
  in Workers Analytics Engine (binding `STATS`).

The rules themselves are in `src/rules.js`, apart from the Workers runtime, and are tested with the web
app's tests (`src/tests/luckgramRelay.test.ts`). The web app's side — which address a connection uses — is
in `src/luckgram/relay/`.

## Addresses

| | Worker | Domain |
|---|---|---|
| Development | `luckgram-relay-dev` (`--env dev`) | `ws-dev.luckgram.cc` |
| Production | `luckgram-relay` (`--env production`) | `ws.luckgram.cc`, backup `lgws.cat158.com` |

The development Worker is where a change to the relay is tried first. No deployed site uses it any more
(luckgram-specs#167): point a local build at it (`LUCKGRAM_RELAYS=wss://ws-dev.luckgram.cc pnpm start`) after
letting the local origin in (`ALLOWED_ORIGINS="http://localhost:8080"` on the Worker).

## Deploying

The Web agent's CI token can only deploy Pages, so the Worker is deployed by the project manager
(`limeng.w-1165`) from a commit named in the Issue:

```bash
git checkout <commit>
cd relay
npx wrangler@4 deploy --env dev           # ws-dev.luckgram.cc
npx wrangler@4 deploy --env production    # ws.luckgram.cc, lgws.cat158.com
```

`wrangler.toml` attaches the domains as custom domains (they have to be zones of the same Cloudflare account)
and binds the Analytics Engine datasets `luckgram_relay_dev` / `luckgram_relay`. To let one more origin in
without a code change, set the variable `ALLOWED_ORIGINS` (comma or space separated) on the Worker.

Checking a deployment:

```bash
H='-H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Protocol: binary"'
eval curl -s -o /dev/null -w '%{http_code}\\n' --http1.1 $H -H '"Origin: https://web.luckgram.cc"'     https://ws.luckgram.cc/2/apiws   # 101
eval curl -s -o /dev/null -w '%{http_code}\\n' --http1.1 $H -H '"Origin: https://evil.example"'        https://ws.luckgram.cc/2/apiws   # 403
eval curl -s -o /dev/null -w '%{http_code}\\n' --http1.1 $H -H '"Origin: https://web.luckgram.cc"'     https://ws.luckgram.cc/6/apiws   # 404
```

Running it locally (no Cloudflare account needed), with the web app's dev server pointed at it:

```bash
cd relay && echo 'ALLOWED_ORIGINS="http://localhost:8080"' > .dev.vars && npx wrangler@4 dev --port 8787
LUCKGRAM_RELAYS=ws://localhost:8787 pnpm start        # in the repository root
```

## Usage

```sql
-- Workers Analytics Engine SQL API; blob1 = outcome, blob2 = dc, blob3 = client | media
SELECT blob3 AS kind, blob1 AS outcome,
       SUM(_sample_interval * double1) AS connections,
       SUM(_sample_interval * double2) AS bytes_up,
       SUM(_sample_interval * double3) AS bytes_down
FROM luckgram_relay
WHERE timestamp > NOW() - INTERVAL '1' DAY
GROUP BY kind, outcome
```

Outcomes: `closed` (a connection that ended, with its bytes and duration), `error`, `upstream_refused`
(Telegram did not upgrade), `upstream_unreachable`, `upstream_timeout` (Telegram did not answer within 6 s),
`pending_overflow` (see below).

## The browser is answered first

The Worker answers the browser's handshake (101) at once and reaches Telegram meanwhile (`src/bridge.js`,
luckgram-specs#148): the browser waits for one network path instead of two before it may send, and — a
browser makes its WebSocket handshakes to one address one after another — its next connection can start that
much sooner. What the browser sends before Telegram's socket is there is held (at most 4 MiB per connection,
then the connection is closed with code `4413`) and passed on in order.

So a `101` no longer says that Telegram was reached. When it cannot be (unreachable, no upgrade, no answer
within 6 s) the browser's socket is closed with code **`4502`** and nothing was passed on. Luckgram Web takes a
relay that opens and hangs up with nothing received for a route that does not work, leaves it alone for 30 s
and goes on to the next one (`src/luckgram/relay/routedSocket.ts`). **Deploy the web app with that rule
before the Worker**: an older build would take the `101` for a working relay and keep coming back to it.

The reverse proxies in `selfhost/` cannot answer first; they keep answering `502` when Telegram is not
reached, which the web app handles as it always did.

All of a user's traffic through the relay — photos and videos included — passes through the Worker. If
that becomes too much, remote config `web.relay_media=false` (W3) keeps media connections (the `-1`
addresses) off the relay: they then go to Telegram's address only, so in a network where Telegram is
blocked text still works and media does not load.

## Changing or adding a relay domain

The web app takes its relays from remote config `web.relays` (W3; until then from the build, see
`LUCKGRAM_RELAYS` in `scripts/luckgram/vite-plugin.mjs`), so a relay can be swapped without a new build —
**as long as the page is allowed to connect to it.** The site's Content-Security-Policy
(`scripts/luckgram/headers.mjs`) lists where the page may connect: `*.luckgram.cc` and `lgws.cat158.com`.
A relay on any other domain has to be added there and the site deployed again first; otherwise the browser
refuses the connection and the relay looks dead.

## The alternative: your own server

When to move off the Worker (the decision is the project manager's, on the numbers in the Issue): the
relay's traffic or cost per active user is clearly above what was expected, Cloudflare limits or blocks
the Worker for carrying non-web traffic, or the Worker's addresses are themselves blocked where the relay
is needed.

`selfhost/` has the same rules as a reverse proxy — `nginx.conf` and `Caddyfile` — for a server that can
reach Telegram: same paths, same `Origin` check, WebSocket only, no access log, nothing forwarded to
Telegram about the client. Point the relay's domain at the server (or add the server's domain to
`web.relays` and to the Content-Security-Policy, see above). Neither configuration has run in production
yet; check it with the three `curl` commands above before sending users to it. A server gives no per-kind
counters: use the interface's byte counters (`vnstat`, the provider's graphs) for traffic.
