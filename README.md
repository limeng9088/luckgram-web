## Luckgram Web

Luckgram's web app: [Telegram Web K](https://github.com/morethanwords/tweb) with the Luckgram name and icons,
its own Telegram API credentials, Simplified Chinese by default in a Chinese browser, and an automatic
deployment. Planning and task specs: [limeng9088/luckgram-specs](https://github.com/limeng9088/luckgram-specs)
(`docs/web.md`, `specs/web/`).

| | |
|---|---|
| Production | https://web.luckgram.cc (backup entrance https://lgweb.cat158.com) |
| Development | https://web-dev.luckgram.cc — every commit of `master`, marked **DEV** |
| Source | https://github.com/limeng9088/luckgram-web |

### Upstream

- Based on `morethanwords/tweb`, branch `master`, commit
  [`2e4bbb52b6aec5e95ee32e5c2882c1f05de32200`](https://github.com/morethanwords/tweb/commit/2e4bbb52b6aec5e95ee32e5c2882c1f05de32200)
  (Telegram Web K 2.3 (687)), imported with its whole history. This line is updated with every merge of upstream.
- Upstream is merged, never rebased — the history of `master` is not rewritten:
  ```bash
  git remote add upstream https://github.com/morethanwords/tweb.git   # once
  git fetch upstream
  git checkout -b chore/sync-upstream origin/master
  git merge upstream/master        # resolve conflicts, keep the Luckgram lines in the files listed below
  pnpm install && pnpm test --run && pnpm typecheck
  # update the commit above, open a pull request; CI builds it and deploys a preview
  ```
- To keep those merges small, Luckgram's code lives in `src/luckgram/` and `scripts/luckgram/`. Upstream files
  only get the few lines that call into it: `vite.config.ts`, `src/index.ts`, `src/config/app.ts`,
  `src/lib/langPack.ts`, `src/lib/serviceWorker/cache.ts`, `src/lib/serviceWorker/push.ts`,
  `src/lib/appManagers/apiUpdatesManager.ts` (and its test `src/tests/changelogDelivery.test.ts`), `src/components/sidebarLeft/index.ts`,
  `src/components/sidebarLeft/tabs/settings.tsx`, `src/components/sidebarLeft/tabs/experimental.tsx`,
  `src/lib/mtproto/dcConfigurator.ts`, `src/lib/mtproto/transports/controller.ts`, `src/lib/mtproto/authorizer.ts`,
  `src/lib/appManagers/createManagers.ts`, `scripts/import-graph.mjs`; for the 20 account slots (W4): `src/lib/accounts/constants.ts`,
  `types.d.ts`, `getValidatedAccount.ts`, `accountController.ts`, `src/lib/sessionStorage.ts`,
  `src/lib/appManagers/appManagersManager.ts` (a slot gets its managers only when it has an account or is worked in),
  `apiManager.ts`, `appStoragesManager.ts`, `utils/state/loadState.ts`, `src/lib/apiManagerProxy.ts`, `src/lib/mainWorker/index.worker.ts`, `src/index.ts`.
  (`experimental.tsx` is back to upstream since W3 moved the connection mode to "Luckgram 功能".) `public/` (upstream's last committed bundle and its
  static files) is left as upstream has it; Luckgram's icons and manifest are laid over it when the site is
  assembled.

### Building and deploying

- Telegram API credentials are **not** in this repository. A build takes `TG_API_ID` / `TG_API_HASH` from the
  environment (in CI: the repository's Actions secrets) and fails without them; it never falls back to the
  pair upstream keeps in `.env`.
  ```bash
  pnpm install
  pnpm start                                       # dev server on :8080
  TG_API_ID=… TG_API_HASH=… LUCKGRAM_CHANNEL=dev pnpm build
  node scripts/luckgram/assemble.mjs               # → tmp/luckgram-site, what is deployed
  node scripts/luckgram/check-site.mjs
  ```
- `.github/workflows/build.yml` — every push to `master`, pull request and manual run: tests, type check,
  build. `master` is deployed to Cloudflare Pages project `luckgram-web-dev` (https://web-dev.luckgram.cc), a
  pull request to a preview (`https://<branch>.luckgram-web-dev.pages.dev`) that is linked in the pull request.
- `.github/workflows/release.yml` — run by hand with a commit of `master`: deploys the production address
  (Cloudflare Pages project `luckgram-web`). Nothing else deploys production.
- The deployed page only talks to Telegram's servers and Luckgram's own domains; the
  Content-Security-Policy in `scripts/luckgram/headers.mjs` enforces it.

### Relay

Where Telegram's addresses cannot be reached, the web app connects through Luckgram's WebSocket relay
instead — a Cloudflare Worker in [`relay/`](relay/README.md) that passes the connection on unread. A
connection tries Telegram's address and the relay and uses whichever answers; Settings → the version line →
Experimental → "连接方式 / Connection" shows the route in use and can pin it. The web app's side is in
`src/luckgram/relay/`.

### License

Luckgram Web is distributed under the [GNU General Public License v3.0](LICENSE), the license of Telegram Web K,
and its source is this repository. It is a modified version of Telegram Web K — © Eduard Kuzmenko and the tweb
contributors — which is based on Webogram, © 2014 Igor Zhukov. The copyright notices in the source files are
kept as they are; Luckgram's changes are © the Luckgram contributors and are marked in the files they touch.
Luckgram is not affiliated with Telegram.

The rest of this file is upstream's README.

---

## Telegram Web K
Based on Webogram, patched and improved. Available for everyone here: https://web.telegram.org/k/


### Developing
Install dependencies with:
```lang=bash
pnpm install
```
This will install all the needed dependencies.


#### Running web-server
Just run `pnpm start` to start the web server and the livereload task.
Open http://localhost:8080/ in your browser.


#### Running in production

Run `node build` to build the minimized production version of the app. Copy `public` folder contents to your web server.

### Running in docker

#### Developing: 
* Install dependencies `docker-compose up tweb.dependencies`.
* Run develop container `docker-compose up tweb.develop `.
* Open http://localhost:8080/ in your browser. 

#### Production:
* Run `docker-compose up tweb.production -d` nginx image and container to serve the build
* Open http://localhost:80/ in your browser.

You can use `docker build -f ./.docker/Dockerfile_production -t {dockerhub-username}/{imageName}:{latest} .` to build your production ready image.

### Dependencies
* [BigInteger.js](https://github.com/peterolson/BigInteger.js) ([Unlicense](https://github.com/peterolson/BigInteger.js/blob/master/LICENSE))
* [fflate](https://github.com/101arrowz/fflate) ([MIT License](https://github.com/101arrowz/fflate/blob/master/LICENSE))
* [cryptography](https://github.com/spalt08/cryptography) ([Apache License 2.0](https://github.com/spalt08/cryptography/blob/master/LICENSE))
* [emoji-data](https://github.com/iamcal/emoji-data) ([MIT License](https://github.com/iamcal/emoji-data/blob/master/LICENSE))
* [emoji-test-regex-pattern](https://github.com/mathiasbynens/emoji-test-regex-pattern) ([MIT License](https://github.com/mathiasbynens/emoji-test-regex-pattern/blob/main/LICENSE))
* [tlottie](https://github.com/dkaraush/tlottie) (MIT License)
* [fast-png](https://github.com/image-js/fast-png) ([MIT License](https://github.com/image-js/fast-png/blob/master/LICENSE))
* [opus-recorder](https://github.com/chris-rudmin/opus-recorder) ([BSD License](https://github.com/chris-rudmin/opus-recorder/blob/master/LICENSE.md))
* [Prism](https://github.com/PrismJS/prism) ([MIT License](https://github.com/PrismJS/prism/blob/master/LICENSE))
* [Solid](https://github.com/solidjs/solid) ([MIT License](https://github.com/solidjs/solid/blob/main/LICENSE))
* [TinyLD](https://github.com/komodojp/tinyld) ([MIT License](https://github.com/komodojp/tinyld/blob/develop/license))
* [libwebp.js](https://libwebpjs.appspot.com/)
* fastBlur
* [Mediabunny](https://github.com/Vanilagy/mediabunny) ([Mozilla Public License 2.0](https://github.com/Vanilagy/mediabunny/blob/main/LICENSE))
* [Temml](https://github.com/ronkok/Temml) ([MIT License](https://github.com/ronkok/Temml/blob/main/LICENSE))

### Debugging
You are welcome in helping to minimize the impact of bugs. There are classes, binded to global context. Look through the code for certain one and just get it by its name in developer tools.
Source maps are included in production build for your convenience.

#### Additional query parameters
* **test=1**: to use test DCs
* **debug=1**: to enable additional logging
* **noSharedWorker=1**: to disable Shared Worker, can be useful for debugging
* **http=1**: to force the use of HTTPS transport when connecting to Telegram servers

Should be applied like that: http://localhost:8080/?test=1

#### Taking local storage snapshots
You can also take and load snapshots of the local storage and indexed DB using the `./snapshot-server` [mini-app](/snapshot-server/README.md). Check the `README.md` under this folder for more details.

#### Preview all icons
You can see all the available svg icons by calling the `showIconLibrary()` global function in the browser's console.

### Troubleshooting & Suggesting

If you find an issue with this app or wish something to be added, let Telegram know using the [Suggestions Platform](https://bugs.telegram.org/c/4002).

### Licensing

The source code is licensed under GPL v3. License is available [here](/LICENSE).
