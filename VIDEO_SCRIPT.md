# Demo video script (hard limit 3:00; the 1:20-1:50 slot is still open, so the current rows add up to about 2:15)

Rules from the official page: footage must show the project working on Twitch and how it was built with Codex; public on YouTube; no third-party trademarks or copyrighted music. Use no music, or music you own. Keep the game window fully visible and in front (a hidden tab pauses the game).

| Time | Shot | Voiceover (English) |
|---|---|---|
| 0:00-0:15 | Streamer at the desk, camera on, the arena over the picture, balls falling | "Twitch chat drops things on the streamer. The streamer catches balls and dodges pies by leaning their head." |
| 0:15-0:50 | Real Twitch chat (second window, the channel you connected to): a viewer types `!drop 2`, then `!pie 1`. The ball falls, the streamer leans, the result (for example 2PT or PIE DODGED) shows, the viewer's name appears on the marquee strip of the game page. Must be real chat messages. | "A viewer types a command in chat. A middle-lane ball is worth 20 points, a side-lane three-pointer 30. A pie costs 25 if you catch it, and dodging it scores nothing." |
| 0:50-1:20 | Auto drops round: irregular waves, a combo counter, the round timer and score | "With no chat, random waves keep the round going. Combos raise the score." |
| 1:20-1:50 | OPEN: this slot is empty after the mosquito experiment left the project. Replacement shot content is for the owner to decide; draft ideas: docs/team/round_20261030/drafts/ | (owner to write) |
| 1:50-2:05 | Fairness: tracking lost shows UNKNOWN, no damage; the same message twice counts once | "If tracking is lost, the result is unknown, never a wrong hit." |
| 2:05-2:35 | Real Codex thread (`codex resume 01a17b17-befd-76e0-a3e3-be336ebbd556`; show the session ID, then scroll in this order, about 5 s each): (1) the plan document game_template_plan.md is finished; (2) Codex finds three gaps itself: lost tracking read as out-of-bounds, missing confidence treated as valid, no chat-event dedup; (3) the test design, 31 cases covering 81 cell combinations; (4) the order to implement; (5) the fixes and 34/34 tests passing. These numbers are from the early Codex thread about the 3x3 core, not the current suite (382 tests). Check the screen for paths, accounts and keys before recording. Then one caption | "Codex built the rules core, the Twitch adapter and the tests. Final integration, face tracking and the catch game were finished with Claude Code." |
| 2:35-2:45 | Repo URL and project name | "StreamerMayhem. Runs with Node, no install." |

## Honesty checks before recording

- Do not present simulated chat or simulated input as live Twitch events; label anything simulated on screen.
- If a take is not from the camera, say so on screen. For camera segments, show the live camera image under the arena.
- Do not claim EventSub was tested live: only the anonymous IRC path was run against a real channel.
- Do not show tokens, client secrets or the OAuth URL fragment.
- Avoid Twitch or OBS logos as the focus of a shot.
