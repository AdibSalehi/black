# Blackjack — online multiplayer private rooms

A small, free-to-play social Blackjack website: 2–6 live players per room, no accounts, no real-money betting.

## Prerequisites
- Node.js 20 or later (includes npm).

## Run on your computer
1. Open a terminal in this project folder.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` in your browser.
5. Open a second tab and join with another name and the displayed room code to test locally.

## Play with someone on a different network
The server must be publicly hosted, e.g. Render:
1. Create a GitHub repository containing `package.json`, `server.js`, and `public/index.html`.
2. In Render choose **New → Web Service**, connect the GitHub repository.
3. Select Node and set Build command `npm install`; Start command `npm start`.
4. Deploy and visit the assigned HTTPS URL.
5. Click **Create a room**, share **Copy invite link** with friends, and click **Start game** once at least 2 people join.

## Rules
- Multiplayer is cooperative timing: players take turns against the SAME dealer, not directly against each other.
- Dealer draws until reaching at least 17 and stands on all 17s, including soft 17.
- Natural Blackjack (initial Ace + 10-value card) beats ordinary 21; matching naturals push.
- No splitting, doubling, insurance, betting, account system, persistent scores, or matchmaking.
- 2 decks are shuffled per round using cryptographic randomness. Each room supports 2–6 players.
- Scores and room state are **in-memory** and reset if the server restarts. Refreshing disconnects you; rejoin with the code. Avoid using multiple server instances without shared state.
- New players may join when the round is not in progress; doing so resets the lobby for the next round.

## Security & production note
This is a learning prototype, not a gambling or financial system. Card draws, scoring, and turn validation happen server-side. Before public scale add authentication, persistent storage, rate limits, room expiry, reconnection, observability, tests, and abuse protection.
