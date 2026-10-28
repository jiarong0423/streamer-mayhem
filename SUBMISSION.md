# Devpost submission text (draft)

## Project name
StreamerMayhem

## Tagline
Chat throws the attacks. The streamer dodges with their body.

## Description
StreamerMayhem turns a Twitch chat into the attacker and the streamer into the defender. Viewers type `!throw 1`-`!throw 9` to target a cell of a 3x3 grid over the streamer's camera. A warning appears on a transparent OBS overlay, and the streamer has about half a second to move out (Cross Inferno gives a second and a half). Four more modes share the same rules core: Cross Inferno (five cells at once, four safe corners), Freeze, Mosquito and Lava.

Why it works on stream: viewers see the danger before the streamer reacts, so the audience is in on the joke; the streamer gets a readable warning instead of a surprise. Fairness is built in. Each chat event produces exactly one result, duplicate message IDs are dropped, users are rate-limited, the queue is bounded, and when body tracking is lost an attack resolves as UNKNOWN with no damage and no score instead of a wrong hit.

Twitch integration: two paths into the same rules core. (1) Login-free: an anonymous read-only IRC WebSocket client that reads a channel's chat and normalizes it into the same events, with reconnect and backoff. (2) OAuth implicit grant and an EventSub WebSocket `channel.chat.message` subscription with reconnect, keepalive watchdog and revocation handling. Tokens live only in page memory.

Body tracking: the page runs Google's MediaPipe Pose Landmarker in the browser on the streamer's camera and judges dodges by the shoulder midpoint (nose as fallback). Limits, stated plainly: it assumes one person in a fixed camera view; the tracking path was tested with unit tests, a stubbed camera and the real model loading, and accuracy depends on lighting and camera placement. Without a camera the game falls back to keyboard or mouse input. The test suite covers game rules, the Twitch adapter and the overlay protocol with fake clocks and a local Twitch protocol simulator.

## How we used Codex
Codex was the main developer. In Codex sessions we designed the shared rules core, wrote the EventSub adapter and OAuth flow, defined the versioned overlay protocol, and wrote the Node test suite. Independent review of each stage was done by a separate reviewer against frozen file hashes, and Codex fixed the issues it raised (for example a tie between tracking loss and an attack deadline that wrongly counted a HIT). After the Codex subscription ended, the final integration pass (English UI, the login-free IRC chat path, submission packaging) was done with Claude Code; this is disclosed here for transparency.

## Codex session ID
Official wording: the thread where most of the project was built (type `/status` in Codex).
`01a17dbb-1e9d-7331-8e99-750df636fd8b`

## Repository
https://github.com/jiarong0423/streamer-mayhem (private; shared with testing@devpost.com)

## Demo video
`<<FILL IN: public YouTube URL, under 3:00>>`

## Built with
JavaScript (no build step), Node.js, HTML Canvas, Twitch EventSub WebSocket, Twitch OAuth, OBS Browser Source, OpenAI Codex.

## Testing instructions
See README.md and TWITCH_LIVE_SETUP.md. Without Twitch credentials, `node scripts/serve-local.mjs` runs the full game in labeled simulation mode.
