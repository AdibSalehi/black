# NOIR CLUB v3.2.0 — Premium social card club

This release improves the card-table experience with server-timed dealing, a host-controlled deal-speed setting, animated cards, Blackjack split/double-down options, and sequential Texas Hold’em streets. It preserves the existing Node.js + Socket.IO project structure.

## What changed

### Realistic dealing and animation
- Blackjack deals one card at a time in round-robin order: each player receives a card, the dealer receives the up-card, then the second player cards and dealer hole card are dealt.
- The dealer hole card remains hidden until the dealer phase. Dealer draws are also revealed one card at a time.
- Texas Hold’em deals each private hole card one at a time. The flop is revealed card-by-card, followed by a separate turn card and river card. A burn card is removed before each community-card street.
- New cards animate from the table/deck area. The UI respects the operating system's `prefers-reduced-motion` preference.
- Room hosts can choose **Fast (300 ms)**, **Realistic (520 ms)**, or **Cinematic (850 ms)** dealing speed.

### Blackjack rules
- Added **Split** for matching-value pairs, up to four hands, provided the player has enough free-play chips for the additional stake.
- Split hands are dealt one card each in sequence. Split aces receive one card each and then stand. A 21 on a split hand is not treated as a natural Blackjack.
- Added **Double down** on eligible two-card hands: the player adds an equal stake, receives exactly one card, then stands.
- Natural Blackjack pays 3:2 in virtual chips; regular wins pay 1:1 profit; pushes return the stake. Dealer stands on soft 17.
- Split and double-down stakes are deducted from the player's non-redeemable chip balance.

### Texas Hold’em scope
- Hole cards, flop, turn and river now arrive in distinct server-controlled stages rather than all at once.
- This release still uses the existing **casual check/fold** decision model; it does **not** yet implement blinds, calls, raises, all-ins, side pots, or full betting rounds. It should not be described as a complete tournament-standard Texas Hold’em client.

### Social-play and legal safeguards
- Registration requires a self-confirmation of age 18+ and acceptance of the current Social Play Terms. Existing accounts must accept the updated terms on their next login. The service records the confirmation timestamp and terms version.
- Added `/terms.html` with a Social Play Terms and Privacy Notice.
- Chips are fictional and non-redeemable. No chip purchases, withdrawals, transfers, crypto, cash prizes, or valuable prizes are implemented. Do not add these without a separate legal review and appropriate licensing/compliance work.
- The terms explicitly say users must not access the service where prohibited.
- This is **not a guarantee of legal compliance in every jurisdiction**. Online games, simulated gambling, age restrictions, privacy and consumer rules vary by location. The operator must obtain local legal advice, add a real privacy contact, and configure access before public launch.

## Files

- `server.js` — Express/Socket.IO server, room state, timed dealing, Blackjack actions and registration checks.
- `games.js` — shared non-Blackjack game engines and staged Texas Hold’em street dealing.
- `public/index.html` — premium dark UI, animation, Split/Double buttons and deal-speed selector.
- `public/terms.html` — Social Play Terms and Privacy Notice.
- `test-games.js` — game simulations and staged Texas Hold’em dealing tests.
- `package.json` — scripts and dependencies.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm start
```

Open `http://localhost:3000`. Use separate browser profiles/accounts to test multiplayer. The `npm test` command checks game-engine simulations and verifies that Texas Hold’em reveals hole cards, flop, turn and river in stages. The test suite does not replace a live Socket.IO browser test of account flows, split-hand actions, and reconnect behavior.

## Deploy safely to Render

1. Keep your currently working deployment untouched. Create a new GitHub branch from the current deployed v3 branch, e.g. `v3.2-staged-deal`.
2. Upload the **contents** of this project folder into the repository root, preserving `public/index.html` and `public/terms.html`. Replace `server.js`, `games.js`, `package.json`, and `test-games.js`.
3. Create a separate Render Web Service from that branch. Use Node, build command `npm install`, start command `npm start`, root directory blank if `package.json` is at repository root, health check `/health`.
4. Confirm `/health` returns `{"ok":true,"version":"3.2.0"}`. Test Blackjack dealing, a pair split, double down, dealer reveal, Texas hole cards, flop, turn and river, bots, and two actual browser sessions.
5. Only after successful testing should you merge the branch into the branch used by your original Render service.

## Important hosting and security limitations

- User records are still stored in a local JSON file. Render's ephemeral filesystem can lose that file on restart/redeploy. Use managed PostgreSQL and backups before a public launch.
- Sessions and active rooms are held in RAM. Restarting the service signs users out and ends active rooms.
- The MVP does not yet include email verification, password reset, full moderation/reporting, robust account deletion/export, persistent sessions, database-backed audit logs, or professional security review.
- Do not store sensitive personal information. Do not reuse passwords from other services.
- The age confirmation is self-declared and is not identity verification.
- Terms and Privacy Notice currently have no operator contact because one has not been supplied; add a real contact and implement user data rights before public launch.

## Current rules limitations

Texas Hold’em is still check/fold only. Teen Patti, Rummy, Hearts and Durak remain simplified casual variants as described in the prior release. Blackjack now supports split and double-down, but does not yet include insurance, surrender, configurable table rules, or a full multi-deck shoe cut-card procedure.
