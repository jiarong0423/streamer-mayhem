# Devpost submission text

## Project name
StreamerMayhem

## Tagline
Chat shoots balls and throws pies. The streamer catches the balls and dodges the pies by leaning.

## Description
StreamerMayhem is an interactive game for a seated Twitch streamer. The game is basketball-themed. Viewers type `!drop 1-3` to send a ball and `!pie 1-3` to throw a pie (`!bomb` still works as an alias). The middle lane is a two-pointer worth 2 points, dropped from above. The left and right lanes are three-pointers worth 3 points, thrown in an arc from that side. The closer the hoop is to the ball's middle, the better the judgement (PERFECT +1, GREAT, GOOD −1), and a streak of catches adds up to +3 per catch. A pie flashes a warning column first. The streamer moves a face-tracking hoop under the balls by leaning their head left and right, and dodges the pies.

The game page shows a top marquee strip with viewer names and results, a streamer-versus-chat bar, the score, and a grade at the end of the 75-second round (S 130, A 95, B 60 on NORMAL; the levels have their own thresholds). When a chat message carries Bits, the viewer's name rides on a star ball, and subscribers get a star next to their name (tested with simulated cheers only). Announcer voice clips are generated locally with Kokoro. A transparent OBS Browser Source overlay (not a Twitch Extension) shows a subset of the game page. An Auto drops mode adds irregular waves of balls and pies over the round, and chat can still add more. Open `/` for practice or `/live` for chat-only play (no automatic waves). The streamer can also pick the level with the head: tilt to choose, nod to confirm. The rules core keeps extra legacy modes in the simulator (Cross Inferno, Freeze, Lava). The 3x3 `!throw` mode exists only in the rules core and is turned off for chat in the game page.

Why it works on stream: viewers see what is coming before the streamer reacts, so the audience is in on the joke. A seated streamer plays with small movements, with no standing or controllers. Each chat event produces one result: duplicate message IDs are dropped for commands, users are rate-limited, the queue is bounded, and when the face is not tracked a drop resolves as UNKNOWN with no score change instead of a wrong catch.

Twitch integration: two paths into the same rules core. (1) Login-free: a read-only IRC WebSocket client with no login reads a channel's chat and turns it into the same events, with reconnect and backoff. It worked in my tests; Twitch does not document reading chat without a login, and its preferred route is EventSub. (2) OAuth implicit grant and an EventSub WebSocket `channel.chat.message` subscription with reconnect, keepalive watchdog and revocation handling. Tokens live only in page memory.

Face tracking: the page runs Google's MediaPipe Face Landmarker in the browser on the streamer's camera (nothing is uploaded). It auto-frames the picture around the face, mirrors it, and judges a catch by the head's left/right position only. It assumes one person. Without a camera the game falls back to keyboard or mouse input. A phone can be the camera, but phone-only or outdoor streaming is out of scope, because those apps have no place for a browser-source overlay.

What I tested, and what I did not. The camera check was one Android phone with one person wearing glasses, on an early version of the game: about 22 frames per second, and judged positions matched the head position. It is not a study, and accuracy depends on lighting and camera placement. The Node test suite covers game rules, waves, the Twitch adapter and the overlay protocol, with fake clocks and a local Twitch protocol simulator. It reports 407 tests; on 31 Oct all 407 passed in a run where loopback listening was permitted (inside a sandbox the 2 `serve_local` tests fail with `EPERM`). Live: login-free chat reading, and real `!drop` / `!pie` commands typed from a second Twitch account on a real channel that triggered balls and pies, as shown in the demo video (the game footage there is a local recording, not a live broadcast). Not live: EventSub chat delivery (the EventSub path reached the connection stage only), real Bits and supporter features (simulated cheers only), and the overlay inside OBS itself (tested in a synthetic Browser Source profile; it shows a subset of the game page).

## How I used Codex
In the main Codex thread (about 16 hours and 1,615 tool calls) I designed the plan and wrote the first version of the game: the shared rules core, the Twitch provider and EventSub adapter with the OAuth flow, the versioned overlay protocol and a first suite of about 170 tests. That work is the repository's first commit. Each stage was reviewed separately, and Codex fixed the issues the reviews raised (for example a tie between tracking loss and an attack deadline that wrongly counted a HIT). The basketball game on top of it (login-free IRC chat, camera tracking, drop waves, sound, difficulty and head menu) was built afterwards with Claude Code, 28–31 Oct, working alongside the Codex-built core.

## Codex session ID
`01a17b17-befd-76e0-a3e3-be336ebbd556`

## Repository
https://github.com/jiarong0423/streamer-mayhem

## Demo video
https://youtu.be/3Mw3x2Xa71c

## Built with
JavaScript (no build step), Node.js, HTML Canvas, Twitch EventSub WebSocket, Twitch OAuth, OBS Browser Source, OpenAI Codex, Claude Code, Kokoro-82M (local announcer voice clips).

## Testing instructions
See README.md and TWITCH_LIVE_SETUP.md. Without Twitch credentials, `node scripts/serve-local.mjs` runs the full game in labeled simulation mode.
