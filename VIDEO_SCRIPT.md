# Demo video script (target 2:45, hard limit 3:00)

Rules from the official page: footage must show the project working on Twitch and how it was built with Codex; public on YouTube; no third-party trademarks or copyrighted music. Use no music, or music you own. Keep the game window fully visible and in front (a hidden tab pauses the game).

| Time | Shot | Voiceover (English) |
|---|---|---|
| 0:00-0:15 | Streamer at the desk, camera on, the arena over the picture, gold items falling | "Twitch chat drops things on the streamer. The streamer catches gold and dodges bombs by leaning their head." |
| 0:15-0:50 | Real Twitch chat (second window, the channel you connected to): a viewer types `!drop 2`, then `!bomb 1`. The item falls, the streamer leans, CATCH / AVOID shows, the viewer's name appears on the overlay. Must be real chat messages. | "A viewer types a command in chat. Gold is worth 25 points. A bomb costs 25 if you catch it and gives 10 if you dodge." |
| 0:50-1:20 | Auto drops round: irregular waves, a combo counter, the round timer and score | "With no chat, random waves keep the round going. Combos raise the score." |
| 1:20-1:50 | `!mosquito` from chat: the mosquito flies an S-shaped path to the face; swat it with a hand or slap your own face within two seconds (show a real take; if it misses, show the dodge) | "A viewer sends a mosquito. It heads for your face. Swat it, or slap your own face before it bites." |
| 1:50-2:05 | Fairness: tracking lost shows UNKNOWN, no damage; the same message twice counts once | "If tracking is lost, the result is unknown, never a wrong hit." |
| 2:05-2:35 | Codex thread on screen: the plan document, a failing test, the fix, tests passing; then one caption | "Codex built the rules core, the Twitch adapter and the tests. Final integration, face tracking and the catch game were finished with Claude Code." |
| 2:35-2:45 | Repo URL and project name | "StreamerMayhem. Runs with Node, no install." |

## Honesty checks before recording

- Do not present simulated chat or simulated input as live Twitch events; label anything simulated on screen.
- If a take is not from the camera, say so on screen. For camera segments, show the live camera image under the arena.
- Do not claim EventSub was tested live: only the anonymous IRC path was run against a real channel.
- Do not show tokens, client secrets or the OAuth URL fragment.
- Avoid Twitch or OBS logos as the focus of a shot.
