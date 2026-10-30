# Devpost submission text (draft)

## Project name
StreamerMayhem

## Tagline
Chat shoots balls and throws pies. The streamer catches the balls and dodges the pies by leaning.

## Description
StreamerMayhem is an interactive game for a seated Twitch streamer. The game is basketball-themed. Viewers type `!drop 1-3` to send a ball (the middle lane is a two-pointer worth 2 points, dropped from above; the left and right lanes are three-pointers worth 3 points, thrown in an arc from that side; the closer the hoop is to the ball's middle the better the judgement, PERFECT +1, GREAT, GOOD −1, and a streak of catches adds up to +3 per catch) and `!pie 1-3` to throw a pie (`!bomb` still works as an alias; a pie flashes a warning column first). The streamer moves a face-tracking hoop under the balls by leaning their head left and right and dodges the pies. The game page shows a top marquee strip with viewer names and results, a streamer-versus-chat bar, score, and a grade at the end of the 75-second round (S 130, A 95, B 60 on NORMAL; the levels have their own thresholds). When a chat message carries Bits the viewer's name rides on a star ball, and subscribers get a star next to their name (Bits features were tested with simulated cheers only). Announcer voice clips are generated locally with Kokoro. A transparent OBS Browser Source overlay (not a Twitch Extension) shows a subset of the game page. An Auto drops mode adds irregular waves of balls and pies over the round; chat can still add more. The same rules core also keeps extra legacy modes in the simulator (Cross Inferno, Freeze, Lava); the 3x3 `!throw` mode exists only in the rules core and is turned off for chat in the game page. The face-mosquito experiment is not part of this repository.

Why it works on stream: viewers see what is coming before the streamer reacts, so the audience is in on the joke, and a seated streamer can play with small movements, no standing or controllers. Fairness is built in. Each chat event is meant to produce one result: duplicate message IDs are dropped for commands, users are rate-limited, the queue is bounded, and when the face is not tracked a drop resolves as UNKNOWN with no score change instead of a wrong catch.

Twitch integration: two paths into the same rules core. (1) Login-free: an anonymous read-only IRC WebSocket client that reads a channel's chat and normalizes it into the same events, with reconnect and backoff (observed to work; anonymous IRC reading is not documented by Twitch, and Twitch's preferred route is EventSub). (2) OAuth implicit grant and an EventSub WebSocket `channel.chat.message` subscription with reconnect, keepalive watchdog and revocation handling. Tokens live only in page memory.

Face tracking: the page runs Google's MediaPipe Face Landmarker in the browser on the streamer's camera (nothing is uploaded), auto-frames the picture around the face, mirrors it like a mirror, and judges a catch by the head's left/right position only. Limits, stated plainly: it assumes one person; it was measured on one Android phone with one person wearing glasses (about 22 frames per second, judged positions matched the head position), not in a study; accuracy depends on lighting and camera placement; and a phone can be the camera but phone-only or outdoor streaming is out of scope because those apps have no place for a browser-source overlay. Without a camera the game falls back to keyboard or mouse input. The Node test suite covers game rules, waves, the Twitch adapter and the overlay protocol with fake clocks and a local Twitch protocol simulator. Verification status: the anonymous IRC path connected to a real channel and received the room id, but no real viewer command has triggered a catch yet; the EventSub path reached the connection stage only and has not been verified live for chat delivery; Bits and supporter features were tested with simulated cheers only; phone testing covered face tracking and an early version of the game; the OBS overlay was checked in a synthetic Browser Source profile and shows a subset of the game page. The test suite reports 382 tests; on 30 Oct all 382 passed in a run where loopback listening was permitted (inside a sandbox the 2 `serve_local` tests fail with `EPERM`).

## How we used Codex
Codex was the main developer. In Codex sessions we designed the shared rules core, wrote the EventSub adapter and OAuth flow, defined the versioned overlay protocol, and wrote the Node test suite. Independent review of each stage was done by a separate reviewer against frozen file hashes, and Codex fixed the issues it raised (for example a tie between tracking loss and an attack deadline that wrongly counted a HIT). After the Codex subscription ended, the final integration pass (English UI, the login-free IRC chat path, face tracking and the catch game, the basketball theme, submission packaging) was done with Claude Code, working alongside the Codex-built core; this is disclosed here for transparency.

## Codex session ID
Official wording: the thread where most of the project was built (type `/status` in Codex).
`01a17b17-befd-76e0-a3e3-be336ebbd556`

## Repository
https://github.com/jiarong0423/streamer-mayhem (private; shared with testing@devpost.com)

## Demo video
`<<FILL IN: public YouTube URL, under 3:00>>`

## Built with
JavaScript (no build step), Node.js, HTML Canvas, Twitch EventSub WebSocket, Twitch OAuth, OBS Browser Source, OpenAI Codex, Claude Code, Kokoro-82M (local announcer voice clips).

## Testing instructions
See README.md and TWITCH_LIVE_SETUP.md. Without Twitch credentials, `node scripts/serve-local.mjs` runs the full game in labeled simulation mode.
