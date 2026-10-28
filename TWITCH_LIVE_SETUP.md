# Connecting StreamerMayhem to real Twitch

## Option A: no login (fastest)

1. `node scripts/serve-local.mjs`, open `http://localhost:4173/`.
2. In **Connect to Twitch chat without login**, type the channel name and press **Connect without login (read-only)**.
3. When the status shows `Live chat connected`, any viewer typing `!throw 5` in that channel's chat triggers an attack. This path is read-only and uses an anonymous `justinfan` IRC identity: no account, token or Twitch application.

## Option B: OAuth + EventSub

You need a Twitch account (with two-factor authentication enabled, which Twitch requires to register an application) and a free Twitch developer application. Credentials are entered only by you, in your browser. The page keeps them in memory; nothing is written to disk.

## One-time setup

1. Go to the Twitch developer console and register an application.
   - OAuth Redirect URL: `http://localhost:4173/oauth-callback.html` (exact match; Twitch accepts plain http only for `localhost`)
   - Category: Game Integration. Client type: Public.
2. Copy the application's **Client ID** (not the secret; this app never uses a secret).
3. Find your numeric **broadcaster channel ID** (the user ID of the channel to read chat from).

## Each session

1. `node scripts/serve-local.mjs`, then open `http://localhost:4173/` (use `localhost`, not `127.0.0.1`, so the origin matches the registered redirect URL).
2. In **Connect to Twitch**, enter the client ID, broadcaster ID and the callback URL from step 1.
3. Click **Authorize and subscribe**. A Twitch consent popup asks for the `user:read:chat` scope. Approve it with the broadcaster account.
4. When the status shows connected, type `!throw 5` (or `!freeze`, `!mosquito`, `!lava`; Cross Inferno is started from the controller button, not by chat) in your Twitch chat. The arena reacts and the warning appears on the overlay.
5. Open the overlay link shown on the controller page as an OBS Browser Source (1920x1080, transparent background) above your camera.

## Troubleshooting

| Status | Meaning |
|---|---|
| `LIVE_LOCKED` | The build you are running still has live access disabled. Use this repository's `dist/twitch_endpoints.mjs` with `LIVE_NETWORK_ENABLED=true`. |
| Consent popup closes with an error | Redirect URL does not exactly match the one registered, or the page was opened at a different origin (use `http://localhost:4173/`). |
| Connected but chat is ignored | The token lacks `user:read:chat`, or the broadcaster ID is not the channel you are chatting in. |
| Subscription revoked | Re-authorize; the game stays offline until you do. |

## Verification checklist for the demo video

- [ ] Status shows connected to the live channel.
- [ ] A real viewer message from Twitch chat triggers an attack (not a simulator button).
- [ ] Overlay visible in OBS above the camera.
- [ ] Simulated events are never presented as live ones.
