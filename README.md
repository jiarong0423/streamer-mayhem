# StreamerMayhem

A Twitch interactive game for a seated streamer: chat drops gold items and bombs, and the streamer catches or dodges them just by leaning their head, tracked by a face model that runs in the browser tab (keyboard or mouse is the fallback). Viewers type commands; the streamer sees the items fall on a transparent OBS overlay with score and health. Built for the Codex x TwitchCon Hackathon.

**Who it is for:** a streamer sitting at a computer with the face camera as the main picture (Just Chatting style), streaming with OBS in landscape. Outdoor and phone-only streaming is out of scope: those apps have no place to put a browser-source overlay. A phone can serve as the camera (see below).

## What it does

- **Catch mode (the main game).** Viewers send `!drop 1`, `!drop 2` or `!drop 3`: a gold item falls for 2.5 s to one of three targets (35%, 50%, 65% of the picture width). A catcher about one face width wide follows the streamer's head along the bottom; if it covers the item when it lands, +25. `!bomb 1-3` drops a bomb: catching it costs 25 points, dodging it earns 10. **Auto drops** (a checkbox) adds irregular waves of items and bombs that get denser and faster over a 75 s round, then shows a score banner. Only the left/right position counts; if the face is not tracked the result is UNKNOWN, never a guess.
- **Face mosquito (`!mosquito`).** A mosquito flies an irregular S-shaped path toward the streamer's face. Swat it with a hand in flight, or, if it lands, slap your own face within 2 s; tilting away makes it miss (+25). A bite costs 5 HP and 25 points. Hand and slap are detected from camera motion around the mosquito (no hand model), and the first mosquito of a round is a no-penalty practice. Auto drops send one around two thirds into the 75 s round; a viewer `!mosquito` has a 10 s cooldown.
- **Dodge attacks.** Viewers send `!throw 1` to `!throw 9` to target one cell of a 3x3 grid over the camera view (the grid is only drawn for the targeted cells).
- **Four more modes** sharing the same rules core, triggered by chat:
  - Dodge (`!throw 1-9`): one cell is hit after a warning.
  - Cross Inferno: cells 2/4/5/6/8 are hit after a 1.5 s warning; corners 1/3/7/9 are safe.
  - Freeze (`!freeze`): keep five joints inside a narrow box through a yellow then red phase; a continuous violation costs HP.
  - Lava (`!lava`): rising lava over 8 s; stand or crouch to stay above the surface.
- **Fair by construction.** One result per event, message-ID dedupe, per-user cooldowns, bounded queue, and tracking loss yields UNKNOWN (no damage, no score) instead of a wrong hit.
- **OBS overlay.** A transparent Browser Source page receives game state over a local relay and draws the warnings on top of the streamer's camera.
- **Twitch connection.** OAuth implicit grant plus an EventSub WebSocket `channel.chat.message` subscription, with reconnect, keepalive watchdog and revocation handling. The anonymous IRC path has its own watchdog (join timeout, 6 minute idle limit, endless reconnect). The token stays in page memory and is never written to disk or logs. A second, login-free path reads a public channel's chat anonymously over Twitch's IRC WebSocket (`dist/irc_anonymous.mjs`, read-only, no account or Twitch application); both paths feed the same game rules.

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

Tests (246 at the time of writing) use fake clocks, synthetic event IDs and generated landmarks. Some integration tests bind to `127.0.0.1`; run them where loopback listening is permitted.

## Honest scope

- Camera tracking: press **Turn on camera tracking**. The page runs Google's MediaPipe (Apache-2.0, bundled under `dist/vendor/mediapipe/`, see its NOTICE.md) on your camera, locally. Default **Face** mode judges dodges by the face position and suits a seated streamer (Matrix Dodge and Cross Inferno; Freeze, Mosquito and Lava need hands or hips, so use **Body** mode for those). **Auto zoom to my face** uses the camera's own zoom (where supported) so a small head movement crosses a cell. Front or rear camera can be chosen. Verified: models load under the page's security policy, mapping, zoom sizing and grid-line stabilization are unit tested, and the camera path ran on an Android phone (grid and video aligned, rotation handled). Accuracy of dodge judging with a real person is still the streamer's own check. Keep the camera fixed and stand or sit alone in view. The model library tries to send a usage-log request to Google; the page's Content-Security-Policy blocks it, so nothing leaves the machine. Without the camera, input is synthetic (keyboard or mouse).
- Seated play: **Auto-frame** (a checkbox, on by default) crops the picture around your face (about six face widths wide) and re-frames only if you move much closer or farther. The camera image is **mirrored** by default so leaning left moves left. Face tracking uses MediaPipe Face Landmarker, which keeps tracking a tilted head; the plain face detector is the fallback. Open the page with `?debug=1` for a readout (face score, frames per second, position, judged position).
- Measured on one Android phone (rear camera, glasses): face tracking about 22 frames per second, catch judging matched the head position (for example head at 41%/64%/50% for targets 35%/65%/50%). This is a single-person, single-device check, not a study; accuracy depends on lighting and camera placement. The face-position survey of 180 live Just Chatting thumbnails behind the framing numbers is in the project notes (single frame per channel, rough order of magnitude).
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
