'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { randomInt } = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();
const MAX_PLAYERS = 6;
const CODES = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true }));
function makeCode() {
  let code;
  do { code = Array.from({ length: 6 }, () => CODES[randomInt(CODES.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
function deck() {
  const cards = [];
  for (let n = 0; n < 2; n++) for (const suit of ['♠','♥','♦','♣']) for (const rank of ['A','2','3','4','5','6','7','8','9','10','J','Q','K']) cards.push({ rank, suit });
  for (let i = cards.length - 1; i > 0; i--) { const j = randomInt(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  return cards;
}
function value(hand) {
  let total = 0, aces = 0;
  for (const card of hand) {
    if (card.rank === 'A') { total += 11; aces++; }
    else total += ['J','Q','K'].includes(card.rank) ? 10 : Number(card.rank);
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return total;
}
const blackjack = hand => hand.length === 2 && value(hand) === 21;
function take(room) { if (!room.deck.length) room.deck = deck(); return room.deck.pop(); }
function current(room) { return room.players[room.turn]; }
function sanitizeName(v) { return typeof v === 'string' ? v.trim().slice(0, 22) : ''; }
function emit(room) {
  for (const p of room.players) {
    const showDealer = room.phase === 'finished';
    io.to(p.id).emit('state', {
      code: room.code, phase: room.phase, hostId: room.hostId,
      you: p.id, turnId: room.phase === 'playing' ? current(room)?.id : null,
      dealer: { hand: showDealer ? room.dealer : (room.phase === 'playing' ? [room.dealer[0], null] : []), total: showDealer ? value(room.dealer) : null },
      players: room.players.map(x => ({ id:x.id, name:x.name, hand:x.hand, total: x.hand.length ? value(x.hand) : null, status:x.status, result:x.result, wins:x.wins }))
    });
  }
}
function finish(room) {
  room.phase = 'finished';
  const active = room.players.some(p => p.status !== 'bust' && !blackjack(p.hand));
  if (active) while (value(room.dealer) < 17) room.dealer.push(take(room)); // dealer stands on soft 17
  const dv = value(room.dealer);
  for (const p of room.players) {
    const pv = value(p.hand);
    if (p.status === 'bust') p.result = 'Lose';
    else if (blackjack(p.hand) && !blackjack(room.dealer)) p.result = 'Blackjack!';
    else if (blackjack(room.dealer) && !blackjack(p.hand)) p.result = 'Lose';
    else if (dv > 21 || pv > dv) p.result = 'Win';
    else if (pv === dv) p.result = 'Push';
    else p.result = 'Lose';
    if (p.result === 'Win' || p.result === 'Blackjack!') p.wins++;
    p.status = 'done';
  }
  emit(room);
}
function nextTurn(room) {
  while (++room.turn < room.players.length && room.players[room.turn].status !== 'playing') {}
  if (room.turn >= room.players.length) finish(room);
  else emit(room);
}
function start(room) {
  room.deck = deck(); room.dealer = []; room.turn = 0; room.phase = 'playing';
  for (const p of room.players) { p.hand = []; p.status = 'playing'; p.result = ''; }
  for (let round = 0; round < 2; round++) {
    for (const p of room.players) p.hand.push(take(room));
    room.dealer.push(take(room));
  }
  for (const p of room.players) if (blackjack(p.hand)) p.status = 'stood';
  if (room.players.every(p => p.status !== 'playing')) finish(room);
  else { while (room.turn < room.players.length && room.players[room.turn].status !== 'playing') room.turn++; emit(room); }
}
function leave(socket) {
  const code = socket.data.room;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code); delete socket.data.room;
  if (!room) return;
  const index = room.players.findIndex(p => p.id === socket.id);
  if (index === -1) return;
  const wasTurn = room.phase === 'playing' && room.turn === index;
  room.players.splice(index, 1);
  if (!room.players.length) { rooms.delete(code); return; }
  if (room.hostId === socket.id) room.hostId = room.players[0].id;
  if (room.phase === 'playing') {
    if (index < room.turn) room.turn--;
    if (wasTurn) { room.turn = index - 1; nextTurn(room); return; }
    if (room.turn >= room.players.length) { finish(room); return; }
  }
  emit(room);
}
function reply(ack, result) { if (typeof ack === 'function') ack(result); }
function handle(socket, action, fn, ack) { try { fn(); } catch(e) { reply(ack, {ok:false,error:e.message || `Cannot ${action}`}); } }
io.on('connection', socket => {
  socket.on('create', (name, ack) => handle(socket,'create', () => {
    if (socket.data.room) throw Error('Leave your current room first.');
    const clean = sanitizeName(name); if (!clean) throw Error('Enter your name.');
    const code = makeCode();
    const room = { code, hostId: socket.id, players:[{id:socket.id,name:clean,hand:[],status:'waiting',result:'',wins:0}], phase:'lobby', turn:0, dealer:[], deck:[] };
    rooms.set(code,room); socket.data.room = code; socket.join(code);
    reply(ack,{ok:true,code}); emit(room);
  },ack));
  socket.on('join', ({name,code} = {}, ack) => handle(socket,'join', () => {
    if (socket.data.room) throw Error('Leave your current room first.');
    const clean = sanitizeName(name); if (!clean) throw Error('Enter your name.');
    const key = String(code || '').trim().toUpperCase();
    const room = rooms.get(key);
    if (!room) throw Error('Room not found. Check the code.');
    if (room.phase === 'playing') throw Error('Game in progress. Join after this round.');
    if (room.players.length >= MAX_PLAYERS) throw Error('Room is full.');
    room.players.push({id:socket.id,name:clean,hand:[],status:'waiting',result:'',wins:0});
    socket.data.room = key; socket.join(key); room.phase = 'lobby';
    for (const p of room.players) { p.hand=[];p.status='waiting';p.result=''; }
    room.dealer=[];
    reply(ack,{ok:true,code:key}); emit(room);
  },ack));
  socket.on('start', (_, ack) => handle(socket,'start', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.hostId !== socket.id) throw Error('Only the host can start.');
    if (room.phase === 'playing') throw Error('Round already active.');
    if (room.players.length < 2) throw Error('At least two players are required.');
    start(room); reply(ack,{ok:true});
  },ack));
  socket.on('move', (move, ack) => handle(socket,'move', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.phase !== 'playing') throw Error('No round in progress.');
    const p = current(room);
    if (!p || p.id !== socket.id || p.status !== 'playing') throw Error('Not your turn.');
    if (move === 'hit') {
      p.hand.push(take(room));
      if (value(p.hand) >= 21) { p.status = value(p.hand) > 21 ? 'bust' : 'stood'; nextTurn(room); }
      else emit(room);
    } else if (move === 'stand') { p.status = 'stood'; nextTurn(room); }
    else throw Error('Unknown move.');
    reply(ack,{ok:true});
  },ack));
  socket.on('leave', (_, ack) => { leave(socket); reply(ack,{ok:true}); });
  socket.on('disconnect', () => leave(socket));
});
const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Blackjack running on http://localhost:${port}`));
