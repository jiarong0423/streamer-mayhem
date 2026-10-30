# Connecting StreamerMayhem to real Twitch

## Option A: no login (fastest)

1. `node scripts/serve-local.mjs`, open `http://127.0.0.1:4173/` (`http://localhost:4173/` works too: the OBS overlay relay accepts both hosts, and nothing else).
2. In **Connect to Twitch chat without login**, type the channel name and press **Connect without login (read-only)**.
3. When the status shows `Live chat connected`, any viewer typing `!drop 2` (a ball) or `!pie 1` (a pie; `!bomb 1` is an alias) in that channel's chat sends it into the game. This path is read-only and uses an anonymous `justinfan` IRC identity: no account, token or Twitch application, and it never sends messages. It was observed to work, but anonymous IRC reading is not documented by Twitch (Twitch's preferred route is EventSub, Option B), so it is not claimed as officially supported. Use it only on your own channel or one whose owner agreed.

## Option B: OAuth + EventSub

You need a Twitch account (with two-factor authentication enabled, which Twitch requires to register an application) and a free Twitch developer application. Credentials are entered only by you, in your browser. The page keeps them in memory; nothing is written to disk.

## One-time setup

1. Go to the Twitch developer console and register an application.
   - OAuth Redirect URL: `http://localhost:4173/oauth-callback.html` (exact match; this repository's tested setup uses plain http on `localhost`; Twitch's own pages show `http://localhost` in examples but we did not verify a rule about http)
   - Category and client type: pick the closest options offered by the console (we did not verify which values the console lists or whether they matter for this flow). The app uses the implicit grant and never a secret.
2. Copy the application's **Client ID** (not the secret; this app never uses a secret).
3. Find your numeric **broadcaster channel ID** (the user ID of the channel to read chat from).

## Each session

1. `node scripts/serve-local.mjs`, then open `http://localhost:4173/` for the OAuth steps (use `localhost`, not `127.0.0.1`, so the origin matches the registered redirect URL).
2. In **Connect to Twitch**, enter the client ID, broadcaster ID and the callback URL from step 1.
3. Click **Authorize and subscribe**. A Twitch consent popup asks for the `user:read:chat` scope. Approve it with the broadcaster account.
4. When the status shows connected, type `!drop 2` (a ball) or `!pie 1` (a pie; `!bomb 1` is an alias) in your Twitch chat. The arena reacts. Chat accepts only `!drop`, `!pie` and `!bomb`; the legacy `!throw`, `!freeze` and `!lava` are not read from chat in the game page (Freeze and Lava remain simulator buttons).
5. Optional: press **Turn on camera tracking** and allow the camera; keep your face in view and the camera fixed (16:9, landscape).
6. Press **Enable overlay sync** (OBS overlay section) and use the overlay link as an OBS Browser Source (1920x1080, transparent background) above your camera. It is an OBS Browser Source, not a Twitch Extension. The link is kept in this browser's local storage, so reloading the controller page keeps the same link; tick **Turn overlay sync on automatically when this page loads** to skip the button. If the browser cannot store it (private window), the page says the link changes on every load. The overlay draws the marquee (latest results, refused commands such as `WAIT 3S`), the streamer-vs-chat bar, score, health, combo, round clock, the hoop, falling balls and pies, and the 3-2-1, GO! and round-over banners. It has no sound. Only game state travels to it, never camera pixels.
   - Line-up: the page shows **OBS camera source** numbers (flip horizontal and crop in pixels of your camera's resolution) under the overlay controls. Apply them to the OBS camera source, then fit it to the whole canvas. Auto-frame re-frames when you move a lot and the numbers then change; for a steady setup untick Auto-frame (or press **Center me** once) and copy the numbers. Whether the result matches your head in OBS is not verified here.
   - Keep the game page visible: when it is hidden or minimised the browser stops its animation, judging pauses on purpose, and the overlay shows `GAME PAUSED`. Use a second screen or leave the window beside OBS, then press **Resume**.
7. The token is a user token held in page memory; when it expires you must authorize again.

## Troubleshooting

| Status | Meaning |
|---|---|
| `LIVE_LOCKED` | The build you are running has live access disabled. This repository's `dist/twitch_endpoints.mjs` ships with `LIVE_NETWORK_ENABLED=true`; a copy with `false` stays locked. |
| Consent popup closes with an error | Redirect URL does not exactly match the one registered, or the page was opened at a different origin (use `http://localhost:4173/`). |
| Connected but chat is ignored | The token lacks `user:read:chat`, or the broadcaster ID is not the channel you are chatting in. |
| Subscription revoked | Re-authorize; the game stays offline until you do. |

## Verification checklist for the demo video

- [ ] Status shows connected to the live channel.
- [ ] A real viewer message from Twitch chat triggers a ball or pie (not a simulator button). Not yet done at the time of writing.
- [ ] Overlay visible in OBS above the camera.
- [ ] Simulated events are never presented as live ones.
