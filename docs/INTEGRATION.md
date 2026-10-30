# Integration with existing Twitch tooling

Checked on GitHub on 2026-10-28 (license, stars and last push from the GitHub API).

| Tool | License | Role here | Decision |
|---|---|---|---|
| [twurple/twurple](https://github.com/twurple/twurple) (753 stars, pushed 2026-09-25) | MIT | Twitch API, chat and EventSub client for Node | **Not bundled.** StreamerMayhem has its own small EventSub adapter (`dist/twitch_provider.mjs`, `dist/eventsub_adapter.mjs`) that runs in the browser with no install. Twurple would add an npm dependency and a build step. A server-side variant could adopt it later. |
| [twitchdev/twitch-cli](https://github.com/twitchdev/twitch-cli) (686 stars, pushed 2026-03-11) | Apache-2.0 | Local EventSub WebSocket mock for protocol tests | **Used as a test aid only** (`scripts/run-official-mock.sh`, `tests/official_mock_*`). Not shipped, not required to play. |
| [obsproject/obs-websocket](https://github.com/obsproject/obs-websocket) (4,379 stars, pushed 2026-10-08) | GPL-2.0 | Remote control of OBS | **Not used.** The overlay is a plain OBS Browser Source URL, so no WebSocket control and no GPL code in this repository. |
| Similar hackathon repos (chat-driven overlays such as streamer-vs-chat, chatquest, raid-arena) | various | Prior art | Reviewed for positioning only; no code reused. |

## Why this fits the rules

The official rules require every third-party SDK or API to be used within its license. This repository ships no third-party code of its own beyond the vendored, licensed files in `dist/vendor/` and `dist/voice/` (see their NOTICE files): the only runtime dependencies are the browser, Node's built-in modules and Twitch's own HTTP/WebSocket endpoints. The design-system vendor files that existed in the working copy were removed from this repository.

## How the pieces connect

Twitch chat, over EventSub WebSocket, goes through the provider and adapter into the shared game core. The core drives the controller page and, through the local relay, the transparent overlay loaded as an OBS Browser Source.
