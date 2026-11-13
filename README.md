# Blackjack Social v2

A free-play multiplayer Blackjack site using Node.js, Express and Socket.IO. Includes accounts, public/private room lobby, virtual play chips, room chat, friends, invitations, basic CSS card animations, a leaderboard and basic dealer-strategy bots. No real-money gameplay.

## Run locally

1. Install Node.js 20+.
2. From this directory run `npm install` and then `npm start`.
3. Open http://localhost:3000.
4. Register two different accounts in two browsers, or create a room and click **+ Bot**.
5. Enter a room, use **Deal**, then **Hit** / **Stand**.

## Updating the existing GitHub repository

**Back up your working `main` branch first.** Create a new branch named `v2-social`. Upload these files to the repository root (not into an extra outer folder), replacing the existing files; preserve `public/index.html` inside the public folder. Commit to the test branch. Configure a *separate* Render Web Service tracking that branch to test before merging to `main`.

- Language: Node
- Build: `npm install`
- Start: `npm start`
- Root directory: blank if `server.js` and `package.json` are at the repository root
- Health check path: `/health`

The existing Render `main` deployment can stay untouched while the new service is tested. Once tested, merge `v2-social` into `main` to update your existing site.

## Important operational limitations

- **Prototype accounts**: password hashes are made with scrypt and unique salts; the session tokens live in server memory and are stored in browser localStorage. Logging in again is required after server restarts. For a production service, use secure HttpOnly cookies, CSRF protections where applicable, audited auth, abuse controls, and password recovery.
- **Data persistence**: user records (including passwords hashes, chips, friend data and stats) are written to `data/users.json` by default. This is suitable for local testing or a server with persistent storage, **not Render's free ephemeral filesystem**. On Render's free tier, accounts, chips and leaderboards can disappear after a restart or deployment. For real lasting accounts, migrate data to a managed database (e.g. Postgres) or use an appropriately persistent disk on a paid deployment.
- **Single process only**: rooms, chat and login sessions live in Node memory. Do not deploy multiple replicas; scaling needs shared storage and the Socket.IO adapter.
- **Room disconnects**: if a player disconnects during a round, their hand automatically stands and settles; their seat stays through the round so chips are not lost. Rooms do not survive a server restart.
- **Chips are fictional**: each human starts with 1,000 play-only chips. Every round stakes 20 play chips per human. A win returns 40, a natural blackjack returns 50, a push returns 20, and a loss returns 0. Bots neither earn nor spend chips. There is no payment, transfer, purchase or cash-out function. There is no automatic chip replenishment.
- **Gameplay rules**: simplified Blackjack: one hand per player, two shuffled decks, dealer stands on soft 17, no split, insurance, surrender or doubling. Accounts with fewer than 20 chips cannot start a round.
- **Friends**: send a request using the exact username; accept the request; then use the room's friend list to invite. Private rooms require the room code or invitation.
- For public deployment, add privacy policy, reporting/moderation and stronger abuse prevention before inviting strangers.

## File layout

- `server.js` — authoritative game rules and Socket.IO events
- `public/index.html` — responsive lobby, chat and Blackjack interface
- `data/users.json` — generated at runtime, excluded from Git
- `package.json` — scripts and dependencies

## Checks

Run `npm run check` to check server syntax. `/health` should return `{"ok":true,"version":"2.0.0"}`.
