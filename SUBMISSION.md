# Devpost submission text (draft)

## Project name
StreamerMayhem

## Tagline
Chat throws the attacks. The streamer dodges with their body.

## Description
StreamerMayhem turns a Twitch chat into the attacker and the streamer into the defender. Viewers type `!throw 1`-`!throw 9` to target a cell of a 3x3 grid over the streamer's camera. A warning appears on a transparent OBS overlay, and the streamer has about a second and a half to move out. Four more modes share the same rules core: Cross Inferno (five cells at once, four safe corners), Freeze, Mosquito and Lava.

Why it works on stream: viewers see the danger before the streamer reacts, so the audience is in on the joke; the streamer gets a readable warning instead of a surprise. Fairness is built in. Each chat event produces exactly one result, duplicate message IDs are dropped, users are rate-limited, the queue is bounded, and when body tracking is lost an attack resolves as UNKNOWN with no damage and no score instead of a wrong hit.

Twitch integration: OAuth implicit grant and an EventSub WebSocket `channel.chat.message` subscription with reconnect, keepalive watchdog and revocation handling. Tokens live only in page memory.

Limits, stated plainly: body tracking in this repository is driven by synthetic five-joint frames and keyboard/mouse input; a camera pose model is not bundled. The test suite covers game rules, the Twitch adapter and the overlay protocol with fake clocks and a local Twitch protocol simulator.

## How we used Codex
Codex was the main developer. In Codex sessions we designed the shared rules core, wrote the EventSub adapter and OAuth flow, defined the versioned overlay protocol, and wrote the Node test suite. Independent review of each stage was done by a separate reviewer against frozen file hashes, and Codex fixed the issues it raised (for example a tie between tracking loss and an attack deadline that wrongly counted a HIT).

## Codex session ID
Official wording: the thread where most of the project was built (type `/status` in Codex).
`<<FILL IN: session ID of the main Codex thread>>`

## Repository
`<<FILL IN: repository URL>>` (if private on GitHub or GitLab, share with testing@devpost.com)

## Demo video
`<<FILL IN: public YouTube URL, under 3:00>>`

## Built with
JavaScript (no build step), Node.js, HTML Canvas, Twitch EventSub WebSocket, Twitch OAuth, OBS Browser Source, OpenAI Codex.

## Testing instructions
See README.md and TWITCH_LIVE_SETUP.md. Without Twitch credentials, `node scripts/serve-local.mjs` runs the full game in labeled simulation mode.
