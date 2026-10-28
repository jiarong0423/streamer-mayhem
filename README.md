# StreamerMayhem

A Twitch interactive game where chat attacks the streamer and the streamer dodges with their body, tracked by a camera pose model that runs in the browser tab (keyboard or mouse is the fallback). Viewers type commands; the streamer sees a warning on a transparent OBS overlay and moves out of the danger cells. Built for the Codex x TwitchCon Hackathon.

## What it does

- **Chat attacks.** Viewers send `!throw 1` to `!throw 9` to target one cell of a 3x3 grid over the streamer's camera view.
- **Five game modes** sharing one rules core, triggered by chat:
  - Matrix Dodge (`!throw 1-9`): one cell is hit after a warning.
  - Cross Inferno: cells 2/4/5/6/8 are hit after a 1.5 s warning; corners 1/3/7/9 are safe.
  - Freeze (`!freeze`): keep five joints inside a narrow box through a yellow then red phase; a continuous violation costs HP.
  - Mosquito (`!mosquito`): move a wrist onto a moving mosquito, or clap, before a 10 s timeout.
  - Lava (`!lava`): rising lava over 8 s; stand or crouch to stay above the surface.
- **Fair by construction.** One result per event, message-ID dedupe, per-user cooldowns, bounded queue, and tracking loss yields UNKNOWN (no damage, no score) instead of a wrong hit.
- **OBS overlay.** A transparent Browser Source page receives game state over a local relay and draws the warnings on top of the streamer's camera.
- **Twitch connection.** OAuth implicit grant plus an EventSub WebSocket `channel.chat.message` subscription, with reconnect, keepalive watchdog and revocation handling. The token stays in page memory and is never written to disk or logs. A second, login-free path reads a public channel's chat anonymously over Twitch's IRC WebSocket (`dist/irc_anonymous.mjs`, read-only, no account or Twitch application); both paths feed the same game rules.

## Requirements

Node.js with the built-in `node:test` runner (verified with v26.12.1). No packages to install. A modern browser. OBS is optional.

## Run

```sh
node scripts/serve-local.mjs
```

Open `http://127.0.0.1:4173/`. Without any Twitch setup the page runs in clearly labeled `SIMULATED` mode: click the numbered buttons or type `!throw 3` in the audience simulator.

To connect to real Twitch, follow [TWITCH_LIVE_SETUP.md](TWITCH_LIVE_SETUP.md). Quickest path: in **Connect to Twitch chat without login**, type a channel name and press Connect.

## Test

```sh
node --test --test-reporter=tap tests/*.test.mjs
```

Tests use fake clocks, synthetic event IDs and generated landmarks. Some integration tests bind to `127.0.0.1`; run them where loopback listening is permitted.

## Honest scope

- Camera tracking: press **Turn on camera tracking**. The page runs Google's MediaPipe (Apache-2.0, bundled under `dist/vendor/mediapipe/`, see its NOTICE.md) on your camera, locally. Default **Face** mode judges dodges by the face position and suits a seated streamer (Matrix Dodge and Cross Inferno; Freeze, Mosquito and Lava need hands or hips, so use **Body** mode for those). **Auto zoom to my face** uses the camera's own zoom (where supported) so a small head movement crosses a cell. Front or rear camera can be chosen. Verified: models load under the page's security policy, mapping, zoom sizing and grid-line stabilization are unit tested, and the camera path ran on an Android phone (grid and video aligned, rotation handled). Accuracy of dodge judging with a real person is still the streamer's own check. Keep the camera fixed and stand or sit alone in view. The model library tries to send a usage-log request to Google; the page's Content-Security-Policy blocks it, so nothing leaves the machine. Without the camera, input is synthetic (keyboard or mouse).
- Twitch chat is verified against the local protocol simulator and the Twitch CLI mock. The anonymous IRC path was checked against live Twitch (it joined a public channel and received the room ID); its message parsing is covered by unit tests with a fake socket. The OAuth/EventSub path needs the streamer's own Twitch app.
- OBS behaviour was verified in a synthetic Browser Source profile.

## Third-party assets
- MediaPipe Tasks Vision and models (Apache-2.0): `dist/vendor/mediapipe/`, see its `NOTICE.md` for sources and checksums.
- Three sparkle sprites from the Kenney Particle Pack by Kenney (https://kenney.nl/), license CC0 (public domain; credit is optional and given here): `dist/vendor/kenney-particles/`, with the license file and checksums in its `NOTICE.md`. They draw the catch burst effect.

## Layout

| Path | Purpose |
|---|---|
| `dist/` | Static game, overlay and Twitch provider (no build step) |
| `scripts/` | Local server, overlay relay, OBS test runner |
| `tests/` | Node test suite and fixtures |
| `docs/ENGINEERING_NOTES.md` | Detailed engineering notes and evidence trail |

## Built with Codex

The game core, Twitch adapter, overlay protocol and test suite were developed in OpenAI Codex sessions. See [SUBMISSION.md](SUBMISSION.md).
