# Integration with existing Twitch tooling

Checked on GitHub on 28 Oct 2026 (license, stars and last push from the GitHub API).

| Tool | License | Role here | Decision |
|---|---|---|---|
| [twurple/twurple](https://github.com/twurple/twurple) (753 stars, pushed 25 Sep 2026) | MIT | Twitch API, chat and EventSub client for Node | **Not bundled.** StreamerMayhem has its own small EventSub adapter (`dist/twitch_provider.mjs`, `dist/eventsub_adapter.mjs`) that runs in the browser with no install. Twurple would add an npm dependency and a build step. A server-side variant could adopt it later. |
| [twitchdev/twitch-cli](https://github.com/twitchdev/twitch-cli) (686 stars, pushed 11 Mar 2026) | Apache-2.0 | Local EventSub WebSocket mock for protocol tests | **Used as a test aid only** (`scripts/run-official-mock.sh`, `tests/official_mock_*`). Not shipped, not required to play. |
| [obsproject/obs-websocket](https://github.com/obsproject/obs-websocket) (4,379 stars, pushed 8 Oct 2026) | GPL-2.0 | Remote control of OBS | **Not used.** The overlay is a plain OBS Browser Source URL, so no WebSocket control and no GPL code in this repository. |
| Similar hackathon repos (chat-driven overlays such as streamer-vs-chat, chatquest, raid-arena) | various | Prior art | Read for positioning only; no code reused. |

## Why this fits the rules

The hackathon rules require every third-party SDK or API to be used within its license. This repository contains no third-party code except the licensed files vendored in `dist/vendor/` and `dist/voice/` (see their NOTICE files). The only runtime dependencies are the browser, Node's built-in modules and Twitch's own HTTP/WebSocket endpoints.

## How the pieces connect

Twitch chat reaches the game over a login-free IRC WebSocket (tested live) or over EventSub (connection step tested only), then goes through the provider and adapter into the shared game core. The core drives the controller page and, through the local relay, the transparent overlay loaded as an OBS Browser Source.
