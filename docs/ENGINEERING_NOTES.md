> Historical engineering notes written while Twitch access was locked and before the basketball theme (some parts describe the old 3x3 game). Where they say "does not connect to real Twitch", see the top-level README: live access is now enabled behind an explicit user click.

# StreamerMayhem — local simulation (engineering notes)

The simulation is playable locally with a synthetic avatar, synthetic chat, an optional Twitch CLI mock transport and an optional local OAuth/chat simulator. It does not connect to real Twitch or OBS and has no camera, model, or OBS integration. The Twitch provider code and settings are present, but live authorization and networking are hard-locked and have not been validated against Twitch.

## Play locally

From this project directory, run:

```sh
node scripts/serve-local.mjs
```

Open `http://127.0.0.1:4173/` in a browser. Stop the server with Ctrl+C. The server uses a fixed allowlist of static files and binds only to loopback; it does not contact Twitch or OBS. On the page, click the arena or use the direction buttons/arrow keys to move the synthetic player. Type `!drop 1-3` or `!pie 1-3` in the command box to simulate chat attacks (the legacy `!throw` is turned off in the game page). Pause, tracking loss, disconnect and reset controls simulate their respective states. The labels `SIMULATED` and `Synthetic input` remain visible.

For **Cross Inferno**, click its button in the audience simulator. After 1.5 seconds of active game time, cells **2, 4, 5, 6, 8** are hit together; move to a corner (**1, 3, 7, 9**) to dodge. Each accepted cross produces one result: a hit costs 15 HP, a dodge earns 25 points. It shares Matrix's dedupe, queue limit, cooldowns, tracking-loss protection and recovery countdown. The calibrated transparent overlay displays all five warning cells. The button is disabled during CLI/OAuth/provider simulation; `!cross` and Bits events cannot trigger it. This increment does not implement Bits fundraising or paid triggers.

After updating the program, reload the controller and open the overlay again using its new synthetic session link. The controller, relay and overlay use the v4 wire types (`synthetic-state-v4` and `synthetic-closed-v4`, see `dist/overlay_protocol.mjs`). Older readers reject the new state type; the new reader and relay reject legacy or unknown types. Mixed versions therefore stop passing state instead of silently reducing a Cross warning to the center cell. All three components must be updated together.

## Run the synthetic tests

Requires Node.js with the built-in `node:test` runner. This stage was verified with Node.js v26.12.1 and does not install any packages:

```sh
node --test --test-reporter=tap tests/*.test.mjs
```

The suite uses fake timestamps, synthetic event IDs, generated landmark coordinates, and a recording Canvas context. It does not use a model or connect to a remote service. A failing test exits nonzero. It covers the 31 planned scenarios, 81 independent target/position combinations, additional game regressions and six EventSub adapter tests.

## Optional real Canvas smoke

Start the short-lived local test server:

```sh
node tests/serve-synthetic.mjs
```

Open the printed loopback URL in a browser. The page checks seven geometry/pixel conditions using generated data and displays `REAL CANVAS PASS` only when all seven pass. The allowlisted server binds only to `127.0.0.1`, serves two test files, and closes after 55 seconds. Stop it earlier with Ctrl+C. Some sandboxes block local listening; use an environment that permits loopback. The fixture makes no request to Twitch or OBS and does not request a camera.

## Synthetic camera calibration

Expand **Camera region calibration (synthetic)** and enter the rectangle as percentages of the 1280×720 synthetic scene. Choose a 16:9 or 4:3 synthetic source, contain or cover, crop percentages relative to the original source, rotation, and optional horizontal mirroring. Select **Apply calibration**. The displayed grid, player and hit detection share the same visible-camera coordinates; click within the visible camera area or use the arrow controls to move. The transformation order is crop → rotation → mirror → contain/cover into the selected rectangle.

The initial full-frame rectangle is a synthetic default, not a real camera calibration. Applying any change cancels queued attacks as UNKNOWN and rejects frames captured at or before the change. Invalid settings invalidate calibration and leave tracking lost until valid settings are applied. During ordinary tracking loss existing warnings freeze; if tracking is missing at an impact deadline, the outcome is UNKNOWN without damage or score. The settings are memory-only. The standalone `overlay.html` page uses the same geometry and renders a clipped transparent canvas. OBS behavior is not yet tested; matching an OBS camera source still requires manual setup or a later authorized integration.

The `tests/camera_geometry.test.mjs` tests synthetic transforms, stale frames, loss and engine alignment. The optional `tests/calibration_canvas.html` fixture checks transparent pixels in a real browser, served by `node tests/serve-synthetic.mjs`; use its printed loopback port with `/tests/calibration_canvas.html`. No webcam or model is used.

## Standalone transparent synthetic overlay

Start `node scripts/serve-local.mjs` and open `http://127.0.0.1:4173/`. In **Camera region calibration (synthetic)**, set the rectangle and transform, select **Enable overlay sync**, then open or copy **Open transparent overlay**. The link opens the standalone `overlay.html` page. Its default URL without a synthetic session is transparent and inactive. The controller uses a fresh in-memory session for each page load; after reloading the controller, enable sync and use the new link. Keep the controller and loopback server running while testing.

The controller sends only synthetic game state to a bounded in-memory same-origin HTTP relay at `127.0.0.1:4173`; the independent overlay receives events from that relay, so it does not depend on the two pages sharing one browser profile. No credentials or Twitch event identities are included. The overlay draws the calibrated visible camera grid, active synthetic warnings, a synthetic point and a `SIMULATED` label. Invalid calibration clears it; tracking loss or low confidence hides attack warnings; stopping the controller or receiving no updates for about 1.5–2 seconds clears stale output. A hidden or throttled controller can therefore cause the overlay to clear safely. No settings or state are persisted.

For later OBS setup, the generated loopback URL is the candidate Browser Source URL. Match the Browser Source's aspect ratio and dimensions to the calibrated scene (the current controller uses 1280×720; 1920×1080 preserves the same ratio), and manually align the camera rectangle; do not infer other OBS source positions automatically. The actual OBS Browser Source, transparency compositing and camera alignment have **not** been tested. The page is currently synthetic-only and does not connect to Twitch, OBS or a camera. The overlay canvas caps dimensions at 4096×2160.

Re-run pure tests with `node --test tests/*.test.mjs`. Run the local relay security/cleanup test with `node tests/overlay_relay_integration.mjs` in an environment that permits loopback. To check browser pixels, run `node tests/serve-synthetic.mjs` and open the printed loopback port at `/tests/overlay_page.html`; the expected result is `OVERLAY PAGE PASS — 20/20`. Stop test servers afterwards.

## Official Twitch CLI mock integration

On macOS arm64, `bash scripts/run-official-mock.sh` runs bounded tests using a local build from Twitch CLI v1.1.24 source at commit `2b10cc20dd792b33ad7e0423a838433a798749d0`. The only source change binds the CLI's RPC listener to `127.0.0.1` instead of all interfaces; this is a modified build, not the unmodified release binary. The official binary's wildcard listener was reachable via the machine's non-loopback address despite `sandbox-exec`, so do not use it for this test. The modified binary, official archive, source and build caches are in `output/isolation/current_runs/20261027_streamer_mayhem_mvp/twitch_cli/`. The runner checks binary hashes, ports and each server's listener, disables update checks, uses an absent explicit config and applies a network sandbox as an extra layer. The CLI may require its empty application directory in the user's Library. The runner needs Go, Node.js with a built-in WebSocket client, `lsof`, and `sandbox-exec`.

For an interactive local mock, start `bash scripts/run-official-mock.sh --serve` in one terminal, `node scripts/serve-local.mjs` in another, open the printed page and select **Connect local CLI mock**. Stop the mock with Ctrl+C and stop the page server when finished. The page defaults to synthetic mode and only connects to a local mock after its button is pressed. Its CSP allows only `127.0.0.1:8080` and `127.0.0.1:8091` for network connections. If local listening is blocked by a sandbox, use an environment that permits loopback.

Version 1.1.24 does not generate or accept a `channel.chat.message` subscription. `tests/official_mock_inject.go` submits synthetic chat bodies through the local mock RPC, and non-strict mode forwards them to the product transport, adapter and game. Strict mode tests use `channel.ban` as a substitute: after close code 4006 the product transport creates a new subscription on a new session; after `session_reconnect` it follows the supplied loopback URL and retains the same subscription ID without creating another. The product transport also applies a bounded exponential retry, a keepalive watchdog, a bounded migration queue and explicit stop. The tests check chat message-ID replay over the server and notification-ID replay in process because the server generates a fresh metadata ID on each forwarding. This is not proof of live chat subscription, authentication or production Twitch compatibility. Evidence: `logs/runtime/official_mock_lifecycle.log` and `logs/runtime/official_mock_product.log`.

## Configurable Twitch provider (live access locked)

The page's **Advanced: connect with your own Twitch app (OAuth + EventSub)** panel accepts a client ID, a numeric broadcaster channel ID, and a callback URL. Settings are kept only in the page's memory. For the present local server, the callback must be `http://127.0.0.1:4173/oauth-callback.html` or a same-origin path ending in `/oauth-callback.html` (for example `/custom/oauth-callback.html`), without a query or fragment. Use the exact URI registered with Twitch when live integration is later authorized. A channel login/name is not resolved to an ID by this version.

`TwitchProvider` builds the OAuth and `channel.chat.message` WebSocket subscription using the configured values; the token is held in memory, validated on receipt and at most hourly, and reauthorization is required after expiration. The callback accepts Twitch's query-based denial and fragment-based success. Real OAuth startup, token validation, socket creation and subscription are disabled by `LIVE_NETWORK_ENABLED=false`, and the page CSP excludes Twitch hosts. The panel includes a live authorization and subscription control, currently disabled by the same live lock, and a separate local simulation button that exercises the same activation lifecycle. The local integration runs the same provider and subscription lifecycle against the synthetic service, using its fixed synthetic client, channel and callback. Live Twitch compatibility and browser delivery have not been tested.

## Local OAuth and chat simulator

The independent simulator implements a **synthetic** implicit-grant consent screen, token-validation endpoint and `channel.chat.message` EventSub subscription over WebSocket at `127.0.0.1:8091`. It is not the Twitch CLI and does not contact Twitch. It follows Twitch's documented [client-side OAuth flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/) and [chat subscription fields](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage), but its tokens, users and channel are fake. The browser checks a one-time, expiring state value and the popup origin/source; the callback removes the token fragment from the URL and passes it only to its opener. Tokens remain in memory, are validated before subscriptions and periodically thereafter, and are never written to files, localStorage, sessionStorage or logs. The implicit flow has no token refresh; expiry requires a new authorization.

Run `bash scripts/run-chat-simulator.sh` to build the local simulator offline and run its integration tests. This requires Go, Node.js with WebSocket support, and the Gorilla WebSocket v1.5.0 module already cached in the prior CLI isolation directory; the script fails closed if the cache is missing. On a fresh machine, explicitly download the Go module into that isolated cache before running; no automatic network installation occurs. Logs are in `logs/runtime/local_twitch_integration.log`.

For an interactive test, run `bash scripts/run-chat-simulator.sh --serve` and `node scripts/serve-local.mjs` in separate terminals, open `http://127.0.0.1:4173/`, expand **Advanced: connect with your own Twitch app (OAuth + EventSub)**, select **Test with local simulator** (or use the existing **Start the local chat authorization test**), and allow the explicitly labelled synthetic consent in the popup. Click **Stop or cancel the local simulation** (or **Stop the local chat test** for the legacy button) and stop both terminal processes with Ctrl+C afterwards. The local simulator callback is fixed to port 4173. The in-app browser did not expose the popup; Safari was used to verify consent, denial, cancellation, callback, chat subscription, and scoring after both reconnection paths. Closing the popup manually clears the pending state; an acknowledged callback remains eligible to complete unless the user cancels. Actual Twitch operation still requires registering the callback with Twitch, an authorized live-connection stage, and live validation; the current application is deliberately restricted to loopback.

## Module contract

- `dist/matrix.mjs`: `MatrixGame` accepts injected monotonic milliseconds, synthetic chat events with notification/message IDs, and landmark frames with capture timestamps and explicit visibility. It provides `start`, `pause`, `resume`, `addFrame`, `receiveChat`, `receiveSyntheticCross`, `tick`, `setConnection` and `snapshot`; event admission and `tick` advance the state using the injected clock. Cross warnings/results retain `cell:5` for compatibility and add `kind:'CROSS'`, `cells:[2,4,5,6,8]`; renderers and the allowlisted overlay protocol preserve the full target area.
- `dist/camera_geometry.mjs` maps synthetic source coordinates into the visible calibrated camera area; `dist/matrix_view.mjs` renders the matching grid and transparent clipped overlay. Legacy `mapPoint` remains available for the older synthetic fixture. `audioStatus` is a status helper, not an audio player.
- `dist/eventsub_adapter.mjs`: validates EventSub-shaped chat notifications, broadcaster identity, session status and duplicate IDs and forwards accepted commands to `MatrixGame`. It is an in-memory adapter; it creates no WebSocket, HTTP request, token or live subscription.
- `dist/mock_eventsub_transport.mjs`: shared WebSocket and subscription lifecycle with mock and dormant Twitch profiles; Twitch networking is hard-locked. `dist/index.html`, `dist/app.mjs`, `dist/arena_draw.mjs` provide the local playable UI, synthetic pose and rendering.
- `dist/twitch_chat_contract.mjs` defines pure OAuth request, token metadata and chat subscription contracts; `dist/twitch_provider.mjs` supplies the configurable Twitch provider and its local simulation, while `dist/mock_oauth.mjs` retains the synthetic compatibility interface. `tests/twitch_simulator/` contains the synthetic authorization and EventSub server.
- `dist/auth_popup_controller.mjs` coordinates manual close, explicit cancellation and validated callback without allowing late callbacks to restore a cancelled attempt; `tests/browser_reconnect_harness.mjs` is a bounded local browser test driver.
- `dist/engine.mjs`: exports `MatrixGame` and the `Game` alias. `ExperimentalGame` retains the earlier unvalidated multi-mode draft; it rejects `throw` commands to prevent bypassing the Matrix event contract. Its Freeze, lava and legacy Cross modes remain unvalidated. The new synthetic Cross action lives in `MatrixGame`, independently of that draft.
- `tests/real_canvas.html`: synthetic browser fixture, not a product UI. Its result does not establish OBS compatibility.

Event identifiers are remembered in bounded in-memory caches with a configurable 10-minute default TTL. Events rejected during the TTL are also remembered, so a retry cannot become a delayed surprise attack. Round reset preserves the identifier cache. Tracking loss pauses the game clock; recovery includes a configurable preparation countdown. A hit, dodge, or unknown outcome is emitted at most once for each accepted attack. A round ending cancels outstanding attacks as `UNKNOWN`.

## Evidence and boundaries

The acceptance matrix and current results are in `docs/decisions/2026Q4/game_template_plan.md`, sections 8–21. OBS has not been tested on this build: the earlier OBS alignment measurements (86 Node tests, a native OBS Browser Source profile) were logged in files that are not part of this repository, so no OBS result is claimed here. Actual Twitch EventSub/OAuth, Window Capture, webcam tracking on the current build, model accuracy, audio playback and real stream performance remain unverified. Do not label the synthetic result as a live-camera or Twitch pass.

For the approved synthetic OBS workflow, see `docs/decisions/2026Q4/obs_synthetic_validation_plan.md`. `node scripts/run-obs-synthetic.mjs` requires the verified isolated OBS app and dedicated 720p30 test profile documented there; it refuses another running OBS and monitors the owned tree. This is a macOS-only operator test runner, not a portable install or automatic scene builder. It sends SIGTERM at resource/deadline limits; explicit exit verification is still required. The app and installer remain isolated, while OBS configuration is in the user's Library. The synthetic server is not left running after testing.

The same plan records phone alternatives and the user's RMX2075 candidate (Camo over USB). Phone resource use is unmeasured, and the phone is busy with another project: notify the user and confirm availability before any phone installation, pairing, capture or test. No phone integration or camera/model startup is authorized by this evaluation.

Reference screenshots and the camera-relative composition proposal are documented in `docs/decisions/2026Q4/stream_frame_layout_design.md`. Those screenshots are isolated research assets and are not included in a public release.

## Synthetic arcade controls (candidate; independent review pending)

Run the existing local page with `node scripts/serve-local.mjs`. Existing Matrix/Cross controls remain. All new actions use generated coordinates; real camera/model/Twitch remain locked.

- **Freeze**: click Freeze or enter `!freeze`. Keep five visible joints in the narrow box for the1500ms yellow and2500ms red phase. Adjust Elbow spread before red; continuous150ms violation costs12HP, success gives100points. Unknown joints pause the evidence clock and require1000ms trusted preparation.
- **Mosquito**: removed. No mosquito code, button or chat command remains in the game page or rules core.
- **Lava**: click Lava or enter `!lava` (optional initial level `!lava 0.6`). Use Stand (hip up) / Crouch (hip down) to move the explicit hip marker. The surface rises for8seconds; continuous immersion burns5HP per1000ms, repeated render cannot burn again. Further valid Lava actions raise the target by.1 up to.8. Clear completion gives75points; burns are not applied a second time at final result.
- Each game shares dedupe/actor/global gates, is mutually exclusive with projectiles and other games, and suppresses ring damage while active. Missing joint controls demonstrate UNKNOWN; source stop/calibration/reset cancels safely. Desktop canvas remains visible while scrolling controls.
- Controller, relay and transparent overlay use `synthetic-state-v4` / `synthetic-closed-v4`. New/old readers reject mixed identities. Only bounded render geometry and challenge state cross the in-memory loopback relay; no event/actor IDs or credential fields.

Candidate code and author tests do not constitute independent acceptance. Complete synthetic functionality is under concentrated local and independent review; real OBS/device/live integration is a separate frozen boundary.
