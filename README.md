# NOIR CLUB — Multiplayer Card Casino v3

A **social free-play** 7-game website built on the existing Blackjack Social v2 project. This package includes accounts, public/private lobby, room codes, friend requests/invitations, live room chat, computer opponents, animated cards, wins leaderboard, and virtual (non-redeemable) chips.

## Games and rule variants

| Game | Players | Rules in this release |
|---|---:|---|
| Blackjack | 2–6 | Original working Blackjack engine; dealer stands on soft 17; Hit/Stand |
| Texas Hold'em | 2–6 | **Simplified**: 2 private cards, 5 community cards shown immediately, one **Check / Fold** decision per player, evaluated poker hand showdown. **No betting rounds, raises, blinds or side pots.** |
| Color Match | 2–6 | Match number/color or draw; first to finish wins. Similar general matching mechanism to classic card-shedding games; no brand assets or special action cards. |
| Hearts | exactly 4 | Follow suit, 2♣ lead, hearts can't be led until broken, hearts = 1 point and Q♠ = 13. Lowest penalty wins. **No passing or shooting the moon.** |
| Rummy | 2–6 | Draw/discard; declare an 8-card hand only when completely partitionable into 3+ card same-rank sets or suit-consecutive runs. After 120 turns, lower card-sum wins. **Casual variant.** |
| Teen Patti | 2–6 | Three cards, **Stay / Fold** then showdown. No real betting or blind/seen rounds. |
| Durak | 2–6 | **Streamlined one-attack/one-defense rounds** using a 36-card deck and trump suit; defender beats attack or takes it. Not the full traditional multi-attack rule set. |

All rounds use **20 free-play chips per human**. The pool is split among human winners. A bot victory is a house win. There is no purchasing, cash-out, crypto, or transfer functionality.

## Run locally

Install Node.js 20+.

```bash
npm install
npm start
```

Open http://localhost:3000. Register two different accounts in separate browser profiles or tabs, or create a room and add bots.

Check test engine:

```bash
npm test
```

## Deploy to GitHub and Render

**Strong recommendation: test on a separate Render service/branch before replacing your currently working site.**

1. Extract the ZIP. Upload **contents of the `blackjack-casino-v3` folder** into the GitHub repository `AdibSalehi/black` on a new branch named `v3-noir-club`. Keep `server.js`, `games.js`, `package.json`, and `public/index.html` at their shown relative paths.
2. Render Dashboard → New → Web Service → Connect repository `AdibSalehi/black` → select branch `v3-noir-club`.
3. Language: Node. Root Directory: blank, assuming package.json at repo root. Build: `npm install`. Start: `npm start`. Health check path: `/health`.
4. Deploy and open the **new Render test URL**. Test both actual devices and bot rounds; check that every game appears, rooms can be joined, a round resolves, friends/invites/chat work, and score/balance changes. 
5. Only after successful testing, merge `v3-noir-club` into `main`, so your existing Render service deploys the update. Consider keeping a `backup-v2` Git branch before merging.

## Important limitations before public use

- `data/users.json` is a **local file**; Render free service filesystems are ephemeral. Accounts, password hashes, friends and leaderboard can disappear across restart/deploy. Use a persistent database (PostgreSQL) before inviting long-term users. Do not rely on this storage for valuable data.
- Session tokens are held **in RAM** and do not persist across service restarts. Players will have to sign in again.
- Rooms and active game rounds live **in RAM**; a restart empties rooms and ends active games.
- This is an educational/social MVP, **not a production-hardened gaming service**. Before public launch, add persistent database, stronger authentication and session security, chat moderation, account recovery, privacy policy, request/socket rate limits, tests, and monitoring.
- Game rules are **not full tournament-standard implementations**, particularly Texas Hold'em, Teen Patti and Durak. Treat them as casual social variants. The website says this.
- No currency payment functionality or real-money gambling is supported.

## Project files

- `server.js`: Node/Express/Socket.IO multiplayer, auth/social, original Blackjack, game routing.
- `games.js`: server-authoritative six new card-game engines.
- `public/index.html`: responsive premium dark theme + seven-game selector and game controls.
- `test-games.js`: automated engine simulation tests.
- `package.json`: launch and dependency config.

## Troubleshooting

- `Cannot GET /`: check that `public/index.html` is uploaded in `public/` and Render's Root Directory is correct.
- New games missing: check that **games.js** is at repository root and the correct branch is deployed.
- `Cannot find module`: run `npm install` / check the Render build log.
- Accounts disappeared: free Render filesystem is temporary; migrate to PostgreSQL.
- In multiplayer games, make sure participants use different signed-in accounts and can connect over Socket.IO.
