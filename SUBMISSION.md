# Devpost submission text (draft)

## Project name
StreamerMayhem

## Tagline
Chat drops gold and bombs. The streamer catches them by leaning.

## Description
StreamerMayhem is an interactive game for a seated Twitch streamer. Viewers type `!drop 1-3` to send a gold item and `!bomb 1-3` to send a bomb; the items fall on a transparent OBS overlay and the streamer catches the gold and dodges the bombs by leaning their head left and right. A face-tracking catcher follows the head along the bottom of the picture, and the overlay shows score and health. An Auto drops mode adds irregular waves of items and bombs that get denser over a 75-second round; chat can still add more. The same rules core also runs a dodge mode (`!throw 1-9`), Cross Inferno, Freeze, Mosquito and Lava.

Why it works on stream: viewers see what is coming before the streamer reacts, so the audience is in on the joke, and a seated streamer can play with small movements, no standing or controllers. Fairness is built in. Each chat event produces exactly one result, duplicate message IDs are dropped, users are rate-limited, the queue is bounded, and when the face is not tracked a drop resolves as UNKNOWN with no score change instead of a wrong catch.

Twitch integration: two paths into the same rules core. (1) Login-free: an anonymous read-only IRC WebSocket client that reads a channel's chat and normalizes it into the same events, with reconnect and backoff. (2) OAuth implicit grant and an EventSub WebSocket `channel.chat.message` subscription with reconnect, keepalive watchdog and revocation handling. Tokens live only in page memory.

Face tracking: the page runs Google's MediaPipe Face Landmarker in the browser on the streamer's camera (nothing is uploaded), auto-frames the picture around the face, mirrors it like a mirror, and judges a catch by the head's left/right position only. Limits, stated plainly: it assumes one person; it was measured on one Android phone with one person wearing glasses (about 22 frames per second, judged positions matched the head position), not in a study; accuracy depends on lighting and camera placement; and a phone can be the camera but phone-only or outdoor streaming is out of scope because those apps have no place for a browser-source overlay. Without a camera the game falls back to keyboard or mouse input. The Node test suite covers game rules, waves, the Twitch adapter and the overlay protocol with fake clocks and a local Twitch protocol simulator. The EventSub path has not been verified with a real Twitch application; the anonymous IRC path has.

## How we used Codex
Codex was the main developer. In Codex sessions we designed the shared rules core, wrote the EventSub adapter and OAuth flow, defined the versioned overlay protocol, and wrote the Node test suite. Independent review of each stage was done by a separate reviewer against frozen file hashes, and Codex fixed the issues it raised (for example a tie between tracking loss and an attack deadline that wrongly counted a HIT). After the Codex subscription ended, the final integration pass (English UI, the login-free IRC chat path, face tracking and the catch game, submission packaging) was done with Claude Code; this is disclosed here for transparency.

## Codex session ID
Official wording: the thread where most of the project was built (type `/status` in Codex).
`01a17b17-befd-76e0-a3e3-be336ebbd556`

## Repository
https://github.com/jiarong0423/streamer-mayhem (private; shared with testing@devpost.com)

## Demo video
`<<FILL IN: public YouTube URL, under 3:00>>`

## Built with
JavaScript (no build step), Node.js, HTML Canvas, Twitch EventSub WebSocket, Twitch OAuth, OBS Browser Source, OpenAI Codex.

## Testing instructions
See README.md and TWITCH_LIVE_SETUP.md. Without Twitch credentials, `node scripts/serve-local.mjs` runs the full game in labeled simulation mode.
