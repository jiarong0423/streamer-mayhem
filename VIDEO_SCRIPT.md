# Demo video script (target 2:45, hard limit 3:00)

Rules from the official page: footage must show the project working on Twitch and how it was built with Codex; public on YouTube; no third-party trademarks or copyrighted music. Use no music, or music you own.

| Time | Shot | Voiceover (English) |
|---|---|---|
| 0:00-0:12 | Streamer in front of camera, overlay grid visible | "Chat attacks. The streamer dodges." |
| 0:12-0:50 | Real Twitch chat (second window): a viewer types `!throw 5` in the channel you connected to (anonymous read-only IRC or EventSub). Overlay warns, streamer steps aside. Show the HP/score update. Must be a real chat message. | "A viewer sends a command in Twitch chat. A warning appears on the overlay. The streamer has half a second." |
| 0:50-1:20 | Cross Inferno from the controller: five cells warn, streamer moves to a corner | "Cross Inferno hits five cells. Only the corners are safe." |
| 1:20-1:45 | Freeze, Mosquito, Lava, a few seconds each. Label on screen: `SIMULATED` where input is synthetic | "Three more modes share the same rules core." |
| 1:45-2:10 | Fairness: duplicate message ignored; tracking lost shows UNKNOWN, no damage | "Duplicates are dropped. If tracking is lost, the result is unknown, not a wrong hit." |
| 2:10-2:40 | Codex thread on screen: prompts, a failing test, the fix, tests passing | "Codex built the rules core, the Twitch adapter and the tests. When review found a bug, Codex fixed it." |
| 2:40-2:45 | Repo URL and project name | "StreamerMayhem. Open source, runs with Node, no install." |

## Honesty checks before recording

- Do not present simulator events as live Twitch events.
- Say on screen that body tracking is synthetic input if the camera model is not used.
- Do not show tokens, client secrets or the OAuth URL fragment.
- Avoid Twitch or OBS logos as the focus of a shot.
