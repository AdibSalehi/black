'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const multi = require('./games');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 16_384 });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, version: '3.2.0' }));
const CODES = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 6, WAGER = 20, STARTING_CHIPS = 1000;
const FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'users.json');
const rooms = new Map(), online = new Map(), sessions = new Map(), authAttempts = new Map();
let database = { users: [] };
try { database = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (!Array.isArray(database.users)) throw Error('Invalid user database');
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(database, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}
function clean(v, max=24) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function findUser(id) { return database.users.find(x=>x.id===id); }
function byName(name) { return database.users.find(x=>x.username.toLowerCase()===name.toLowerCase()); }
function publicUser(u) { return { id:u.id, username:u.username, chips:u.chips, wins:u.wins, losses:u.losses, games:u.games, friends:u.friends.map(id=>findUser(id)?.username).filter(Boolean) }; }
function hashPassword(p, salt) { return crypto.scryptSync(p, salt, 64).toString('hex'); }
function loginThrottle(socket) {
  const ip = socket.handshake.address, now = Date.now();
  const x = authAttempts.get(ip) || {count:0,until:now+60_000};
  if (x.until<now) { x.count=0; x.until=now+60_000; }
  x.count++; authAttempts.set(ip,x);
  if (x.count>12) throw Error('Too many attempts; try again shortly.');
}
function tokenFor(u) { const token = crypto.randomBytes(32).toString('hex'); sessions.set(token,u.id); return token; }
function loginSocket(socket, u) {
  const oldId = online.get(u.id);
  if (oldId && oldId!==socket.id) io.sockets.sockets.get(oldId)?.disconnect(true);
  socket.data.uid = u.id; online.set(u.id, socket.id); socket.join('user:'+u.id);
  socket.emit('me',publicUser(u)); sendSocial(u.id); broadcastLobby();
}
function reply(ack, value) { if (typeof ack==='function') ack(value); }
function run(ack,fn) { try { fn(); } catch(e) { reply(ack,{ok:false,error:e.message||'Request failed'}); } }
function needUser(socket) { const u=findUser(socket.data.uid); if(!u) throw Error('Sign in first.'); return u; }
function roomOf(socket) { const r=rooms.get(socket.data.room); if(!r) throw Error('Join a room first.'); return r; }
function makeCode() { let code; do {code=Array.from({length:6},()=>CODES[crypto.randomInt(CODES.length)]).join('');}while(rooms.has(code));return code; }
function deck() {const d=[];for(let k=0;k<2;k++)for(const suit of ['♠','♥','♦','♣'])for(const rank of ['A','2','3','4','5','6','7','8','9','10','J','Q','K'])d.push({rank,suit,id:crypto.randomUUID()});for(let i=d.length-1;i>0;i--){const j=crypto.randomInt(i+1);[d[i],d[j]]=[d[j],d[i]];}return d;}
function value(hand) {let total=0,aces=0;for(const c of hand){if(c.rank==='A'){total+=11;aces++;}else total+=['J','Q','K'].includes(c.rank)?10:Number(c.rank);}while(total>21&&aces){total-=10;aces--;}return total;}
function natural(hand){return hand.length===2&&value(hand)===21;}
function draw(r){if(!r.deck.length) r.deck=deck();return r.deck.pop();}
function seat(u){return {id:u.id,name:u.username,bot:false,hand:[],hands:[],handIndex:0,status:'waiting',result:'',stake:0};}
function botSeat(r){const taken=new Set(r.players.map(p=>p.name));let i=1;while(taken.has('Bot '+i))i++;return {id:'bot-'+crypto.randomUUID(),name:'Bot '+i,bot:true,hand:[],hands:[],handIndex:0,status:'waiting',result:'',stake:0};}
const DEAL_MS=520;
function dealDelay(r){return [300,520,850].includes(Number(r.dealSpeed))?Number(r.dealSpeed):DEAL_MS;}
function handList(p){if(!Array.isArray(p.hands)||!p.hands.length)p.hands=[{cards:p.hand||[],status:p.status||'waiting',stake:p.stake||0,result:p.result||'',blackjackEligible:true,splitAces:false,doubled:false}];return p.hands;}
function activeBJHand(p){const hs=handList(p);p.handIndex=Math.max(0,Math.min(p.handIndex||0,hs.length-1));return hs[p.handIndex];}
function syncBJ(p){const h=activeBJHand(p);p.hand=h.cards;p.status=h.status;p.stake=h.stake;p.result=h.result;}
function bjCardValue(c){return c.rank==='A'?11:['K','Q','J'].includes(c.rank)?10:Number(c.rank);}
function canSplit(p,u){const h=activeBJHand(p);return !!(h&&h.status==='playing'&&h.cards.length===2&&bjCardValue(h.cards[0])===bjCardValue(h.cards[1])&&handList(p).length<4&&!h.splitAces&&u&&u.chips>=h.stake);}
function canDouble(p,u){const h=activeBJHand(p);return !!(h&&h.status==='playing'&&h.cards.length===2&&!h.splitAces&&u&&u.chips>=h.stake);}
function sendSocial(uid) {const u=findUser(uid);if(!u)return;const sid=online.get(uid);if(!sid)return;io.to(sid).emit('social',{me:publicUser(u),requests:u.requests.map(id=>findUser(id)?.username).filter(Boolean),friends:u.friends.map(id=>({name:findUser(id)?.username,online:online.has(id)})).filter(x=>x.name),invitations:u.invites.slice(-15)});}
function broadcastSocial() {for(const uid of online.keys())sendSocial(uid);}
function lobbyData(){return [...rooms.values()].filter(r=>!r.private).map(r=>({code:r.code,host:findUser(r.host)?.username||'Host',count:r.players.length,phase:r.phase,type:r.type||'blackjack'}));}
function broadcastLobby(){io.emit('lobby',lobbyData());}
function state(r){if(r.type!=='blackjack')return multiState(r);for(const p of r.players.filter(x=>!x.bot)){
  const sid=online.get(p.id);if(!sid)continue;syncBJ(p);
  const u=findUser(p.id);
  io.to(sid).emit('state',{
    code:r.code,type:'blackjack',private:r.private,phase:r.phase,dealSpeed:dealDelay(r),hostId:r.host,you:p.id,turnId:r.phase==='playing'?current(r)?.id:null,turnHandIndex:r.phase==='playing'?(current(r)?.handIndex||0):null,stake:WAGER,
    dealer:{hand:(r.phase==='dealer'||r.phase==='finished')?r.dealer:(r.dealer.length?[r.dealer[0],...(r.dealer.length>1?[null]:[])]:[]),total:(r.phase==='dealer'||r.phase==='finished')?value(r.dealer):null},
    players:r.players.map(x=>{syncBJ(x);const hs=handList(x);return {id:x.id,name:x.name,bot:x.bot,hand:x.hand,total:x.hand.length?value(x.hand):null,status:x.status,result:x.result,stake:x.stake,handIndex:x.handIndex,hands:hs.map((h,i)=>({cards:h.cards,total:h.cards.length?value(h.cards):null,status:h.status,result:h.result,stake:h.stake,active:i===x.handIndex,splitAces:h.splitAces})),connected:x.bot||online.has(x.id)};}),
    canSplit:canSplit(p,u),canDouble:canDouble(p,u),chat:r.chat.slice(-40),myChips:u?.chips||0
  });
}}
function multiState(r){for(const p of r.players.filter(x=>!x.bot)){
 const sid=online.get(p.id);if(!sid)continue;
 io.to(sid).emit('state',{code:r.code,type:r.type,private:r.private,phase:r.phase,dealSpeed:dealDelay(r),hostId:r.host,you:p.id,stake:WAGER,chat:r.chat.slice(-40),myChips:findUser(p.id)?.chips||0,...multi.seatState(r,p.id)});
}}
function settleMulti(r){if(r.settled||r.phase!=='finished')return;r.settled=true;
 const humans=r.players.filter(p=>!p.bot),winners=humans.filter(p=>r.winners?.includes(p.id));
 const pool=humans.length*WAGER;const each=winners.length?Math.floor(pool/winners.length):0;
 for(const p of humans){const u=findUser(p.id);if(!u)continue;u.games++;
  if(winners.includes(p)){u.wins++;u.chips+=each;}else u.losses++;sendSocial(u.id);
 }
 save();sendBoards();broadcastLobby();
}
function scheduleMultiBot(r){if(r.phase!=='playing'||!r.players[r.turn]||( !r.players[r.turn].bot && online.has(r.players[r.turn].id)))return;
 const code=r.code,uid=r.players[r.turn].id;
 setTimeout(()=>{const live=rooms.get(code);if(!live||live.type==='blackjack'||live.phase!=='playing'||live.players[live.turn]?.id!==uid||( !live.players[live.turn].bot && online.has(uid)))return;
  try{const a=multi.botAction(live);if(a)multi.act(live,uid,a);if(live.phase==='finished')settleMulti(live);state(live);if(live.phase==='dealing')scheduleMultiDeal(live);else scheduleMultiBot(live);}catch(e){console.error('Bot error',e.message);}
 },400);
}
function startMulti(r){if(r.phase==='playing'||r.phase==='dealing')throw Error('Round already running.');
 const t=multi.TYPES[r.type];if(r.players.length<t.min)throw Error('This game requires at least '+t.min+' players (bots are allowed).');
 if(r.players.length>t.max)throw Error('Maximum '+t.max+' players for this game.');
 const humans=r.players.filter(p=>!p.bot);if(humans.some(p=>!findUser(p.id)||findUser(p.id).chips<WAGER))throw Error('A player does not have enough chips.');
 for(const p of humans){findUser(p.id).chips-=WAGER;sendSocial(p.id);}save();
 r.settled=false;multi.start(r);state(r);broadcastLobby();
 if(r.phase==='dealing')scheduleMultiDeal(r);else scheduleMultiBot(r);
}
function resetLobby(r){r.phase='lobby';r.dealer=[];r.turn=0;r.stage='';r.result='';r.dealToken=null;for(const p of r.players){p.hand=[];p.hands=[];p.handIndex=0;p.result='';p.stake=0;p.status='waiting';}state(r);broadcastLobby();}
function scheduleMultiDeal(r){const code=r.code,token=(r.multiDealToken=(r.multiDealToken||0)+1);setTimeout(()=>{const live=rooms.get(code);if(!live||live.multiDealToken!==token||live.type==='blackjack'||live.phase!=='dealing')return;
 try{const done=multi.dealStep(live);state(live);broadcastLobby();if(done){scheduleMultiBot(live);}else scheduleMultiDeal(live);}catch(e){console.error('Poker deal error',e);live.phase='finished';live.result='Deal interrupted. Please start a new round.';state(live);}
 },dealDelay(r));}
function scheduleBJDeal(r,queue,after){const code=r.code,token=(r.dealToken=(r.dealToken||0)+1);const step=()=>setTimeout(()=>{const live=rooms.get(code);if(!live||live.dealToken!==token||live.type!=='blackjack')return;
  if(queue.length){const item=queue.shift();if(item.kind==='player'||item.kind==='split'){const p=live.players.find(x=>x.id===item.id);if(p){const h=item.hand??0;handList(p)[h].cards.push(draw(live));syncBJ(p);}}else if(item.kind==='dealer')live.dealer.push(draw(live));state(live);step();return;}
  after(live);
 },dealDelay(r));step();}
function scheduleBot(r){if(r.phase!=='playing'||!current(r)?.bot)return;
 const code=r.code,id=current(r).id;setTimeout(()=>{const live=rooms.get(code);if(!live||live.phase!=='playing'||current(live)?.id!==id)return;
  const bot=current(live),h=activeBJHand(bot),score=value(h.cards);
  if(score<17){h.cards.push(draw(live));if(value(h.cards)>=21){h.status=value(h.cards)>21?'bust':'stood';progress(live);}else{syncBJ(bot);state(live);scheduleBot(live);}}
  else{h.status='stood';progress(live);}
 },700);
}
function current(r){return r.players[r.turn];}
function progress(r){if(r.phase!=='playing')return;
 while(r.turn<r.players.length){const p=r.players[r.turn],hs=handList(p);while(p.handIndex<hs.length&&hs[p.handIndex].status!=='playing')p.handIndex++;
  if(p.handIndex<hs.length){syncBJ(p);state(r);scheduleBot(r);return;}p.handIndex=0;r.turn++;
 }
 settle(r);
}
function start(r){
 if(r.type!=='blackjack')return startMulti(r);
 if(r.phase==='playing'||r.phase==='dealing'||r.phase==='dealer')throw Error('Round already running.');
 const humans=r.players.filter(p=>!p.bot);if(humans.length<1||r.players.length<2)throw Error('Add a friend or a bot first.');
 if(humans.some(p=>!findUser(p.id)||findUser(p.id).chips<WAGER))throw Error('A player does not have enough virtual chips.');
 for(const p of humans){findUser(p.id).chips-=WAGER;sendSocial(p.id);}save();
 r.deck=deck();r.dealer=[];r.turn=0;r.phase='dealing';r.result='';r.players.forEach(p=>{p.hands=[{cards:[],status:'playing',stake:p.bot?0:WAGER,result:'',blackjackEligible:true,splitAces:false,doubled:false}];p.handIndex=0;syncBJ(p);});
 const queue=[];for(let round=0;round<2;round++){for(const p of r.players)queue.push({kind:'player',id:p.id,hand:0});queue.push({kind:'dealer'});}
 state(r);broadcastLobby();scheduleBJDeal(r,queue,live=>{live.phase='playing';for(const p of live.players){const h=activeBJHand(p);if(natural(h.cards)){h.status='stood';h.result='Blackjack';}syncBJ(p);}if(natural(live.dealer)){for(const p of live.players){for(const h of handList(p))if(h.status==='playing')h.status='stood';syncBJ(p);}settle(live);return;}progress(live);broadcastLobby();});
}
function finishBlackjackSettlement(r){const dealerNatural=natural(r.dealer),dv=value(r.dealer);
 for(const p of r.players){const hs=handList(p);let anyWin=false,allPush=true;const labels=[];
  for(const h of hs){const pv=value(h.cards),isNatural=!!h.blackjackEligible&&natural(h.cards);
   if(h.status==='bust'||pv>21){h.result='Bust · Lose';}
   else if(isNatural&&dealerNatural){h.result='Push';if(!p.bot)findUser(p.id).chips+=h.stake;}
   else if(isNatural&&!dealerNatural){h.result='Blackjack · Win';anyWin=true;allPush=false;if(!p.bot)findUser(p.id).chips+=Math.floor(h.stake*2.5);}
   else if(dealerNatural){h.result='Lose';allPush=false;}
   else if(dv>21||pv>dv){h.result='Win';anyWin=true;allPush=false;if(!p.bot)findUser(p.id).chips+=h.stake*2;}
   else if(pv===dv){h.result='Push';if(!p.bot)findUser(p.id).chips+=h.stake;}
   else{h.result='Lose';allPush=false;}
   h.status='done';labels.push(h.result);
  }
  p.result=labels.join(' / ');p.status='done';syncBJ(p);
  if(!p.bot){const u=findUser(p.id);if(u){u.games++;if(anyWin)u.wins++;else if(!allPush)u.losses++;sendSocial(u.id);}}
 }
 r.phase='finished';save();state(r);broadcastLobby();sendBoards();
}
function settle(r){if(r.phase==='dealer'||r.phase==='finished')return;r.phase='dealer';state(r);broadcastLobby();const code=r.code,token=(r.dealerToken=(r.dealerToken||0)+1);
 const step=()=>setTimeout(()=>{const live=rooms.get(code);if(!live||live.dealerToken!==token||live.phase!=='dealer')return;
  const liveHands=live.players.flatMap(p=>handList(p));const needsDraw=liveHands.some(h=>h.status!=='bust'&&value(h.cards)<=21);
  if(needsDraw&&value(live.dealer)<17){live.dealer.push(draw(live));state(live);step();}else finishBlackjackSettlement(live);
 },dealDelay(r));step();
}
function ensureHost(r,u){if(r.host!==u.id)throw Error('Only room host can do this.');}
function leave(socket) {
  const code=socket.data.room;if(!code)return;delete socket.data.room;socket.leave(code);
  const r=rooms.get(code);if(!r)return;
  const idx=r.players.findIndex(p=>p.id===socket.data.uid);if(idx<0)return;
  if(r.phase==='playing'&&r.type!=='blackjack'){state(r);scheduleMultiBot(r);broadcastLobby();return;}
  if(r.phase==='playing'){
    const p=r.players[idx],h=activeBJHand(p);if(h?.status==='playing')h.status='stood';syncBJ(p);
    if(r.turn===idx)progress(r);else state(r);
  } else if(r.phase==='dealing'||r.phase==='dealer'){
    r.players[idx].disconnected=true;state(r);
  } else {
    r.players.splice(idx,1);
    if(!r.players.some(p=>!p.bot)){rooms.delete(code);broadcastLobby();return;}
    if(r.host===socket.data.uid)r.host=r.players.find(p=>!p.bot).id;
    resetLobby(r);
  }
  broadcastLobby();
}
function attach(socket,r,u){
  if(socket.data.room)throw Error('Leave your existing room first.');
  if(r.players.some(p=>p.id===u.id)){
    if(r.phase!=='playing'&&r.phase!=='finished')throw Error('Already in this room.');
  }else{
    if(['playing','dealing','dealer'].includes(r.phase))throw Error('Round in progress. Join after this round.');
    if(r.players.length>=(multi.TYPES[r.type]?.max||MAX_PLAYERS))throw Error('Room is full.');
    r.players.push(seat(u));
    if(r.phase==='finished')resetLobby(r);
  }
  socket.data.room=r.code;socket.join(r.code);state(r);broadcastLobby();
}
function leaderboard(){return database.users.map(u=>({username:u.username,wins:u.wins,games:u.games,chips:u.chips})).sort((a,b)=>b.wins-a.wins||b.chips-a.chips).slice(0,25);}
function sendBoards(){io.emit('leaderboard',leaderboard());}

io.on('connection',socket=>{
  socket.emit('lobby',lobbyData());socket.emit('leaderboard',leaderboard());socket.emit('gameTypes',multi.TYPES);
  socket.on('register',({username,password,ageConfirmed,termsAccepted}={},ack)=>run(ack,()=>{
    loginThrottle(socket);username=clean(username,20);
    if(ageConfirmed!==true||termsAccepted!==true)throw Error('Confirm that you are 18 or older and accept the Social Play Terms.');
    if(!/^[a-zA-Z0-9_]{3,20}$/.test(username))throw Error('Username must be 3–20 letters, digits or underscores.');
    if(typeof password!=='string'||password.length<8||password.length>128)throw Error('Password must be 8–128 characters.');
    if(byName(username))throw Error('Username already taken.');
    const salt=crypto.randomBytes(16).toString('hex');
    const acceptedAt=new Date().toISOString();const u={id:crypto.randomUUID(),username,salt,passwordHash:hashPassword(password,salt),ageConfirmedAt:acceptedAt,termsAcceptedAt:acceptedAt,termsVersion:'2026-11-14',chips:STARTING_CHIPS,wins:0,losses:0,games:0,friends:[],requests:[],invites:[]};
    database.users.push(u);save();const token=tokenFor(u);loginSocket(socket,u);reply(ack,{ok:true,token,user:publicUser(u)});sendBoards();
  }));
  socket.on('login',({username,password,ageConfirmed,termsAccepted}={},ack)=>run(ack,()=>{
    loginThrottle(socket);const u=byName(clean(username,20));
    const valid=u&&typeof password==='string'&&password.length<=128&&crypto.timingSafeEqual(Buffer.from(u.passwordHash,'hex'),Buffer.from(hashPassword(password,u.salt),'hex'));
    if(!valid)throw Error('Invalid username or password.');
    if(u.termsVersion!=='2026-11-14'){if(ageConfirmed!==true||termsAccepted!==true)throw Error('Please confirm that you are 18 or older and accept the updated Social Play Terms.');const acceptedAt=new Date().toISOString();u.ageConfirmedAt=acceptedAt;u.termsAcceptedAt=acceptedAt;u.termsVersion='2026-11-14';save();}
    const token=tokenFor(u);loginSocket(socket,u);reply(ack,{ok:true,token,user:publicUser(u)});
  }));
  socket.on('resume',(token,ack)=>run(ack,()=>{
    if(typeof token!=='string')throw Error('Session not found.');
    const uid=sessions.get(token),u=findUser(uid);if(!u)throw Error('Please sign in again.');
    loginSocket(socket,u);reply(ack,{ok:true,user:publicUser(u)});
    const r=[...rooms.values()].find(x=>x.players.some(p=>p.id===uid));if(r){socket.data.room=r.code;socket.join(r.code);state(r);}
  }));
  socket.on('logout',(_payload,ack)=>run(ack,()=>{leave(socket);const uid=socket.data.uid;for(const [token,id] of sessions)if(id===uid)sessions.delete(token);if(online.get(uid)===socket.id)online.delete(uid);delete socket.data.uid;broadcastSocial();reply(ack,{ok:true});}));
  socket.on('create',({private:priv=true,type='blackjack'}={},ack)=>run(ack,()=>{
    const u=needUser(socket);if(socket.data.room)throw Error('Leave your current room first.');
    if(typeof type!=='string'||!multi.TYPES[type])throw Error('Unknown card game.');
    const code=makeCode(),r={code,type,host:u.id,private:!!priv,players:[seat(u)],phase:'lobby',turn:0,dealer:[],deck:[],chat:[],dealSpeed:520};
    rooms.set(code,r);socket.data.room=code;socket.join(code);state(r);broadcastLobby();reply(ack,{ok:true,code});
  }));
  socket.on('join',({code}={},ack)=>run(ack,()=>{
    const u=needUser(socket);const r=rooms.get(clean(code,6).toUpperCase());if(!r)throw Error('Room not found.');
    attach(socket,r,u);reply(ack,{ok:true,code:r.code});
  }));
  socket.on('leave',(_payload,ack)=>run(ack,()=>{leave(socket);reply(ack,{ok:true});}));
  socket.on('setDealSpeed',(speed,ack)=>run(ack,()=>{
    const u=needUser(socket),r=roomOf(socket);ensureHost(r,u);const n=Number(speed);
    if(![300,520,850].includes(n))throw Error('Choose Fast, Realistic, or Cinematic dealing speed.');
    r.dealSpeed=n;state(r);broadcastLobby();reply(ack,{ok:true,dealSpeed:n});
  }));
  socket.on('addBot',(_payload,ack)=>run(ack,()=>{
    const u=needUser(socket),r=roomOf(socket);ensureHost(r,u);
    if(['playing','dealing','dealer'].includes(r.phase))throw Error('Wait for the round to finish.');
    if(r.players.length>=(multi.TYPES[r.type]?.max||MAX_PLAYERS))throw Error('Room full.');
    r.players.push(botSeat(r));resetLobby(r);reply(ack,{ok:true});
  }));
  socket.on('removeBots',(_payload,ack)=>run(ack,()=>{
    const u=needUser(socket),r=roomOf(socket);ensureHost(r,u);
    if(['playing','dealing','dealer'].includes(r.phase))throw Error('Wait for the round to finish.');
    r.players=r.players.filter(p=>!p.bot);resetLobby(r);reply(ack,{ok:true});
  }));
  socket.on('start',(_payload,ack)=>run(ack,()=>{const u=needUser(socket),r=roomOf(socket);ensureHost(r,u);start(r);reply(ack,{ok:true});}));
  socket.on('move',(action,ack)=>run(ack,()=>{
    const u=needUser(socket),r=roomOf(socket);if(r.type!=='blackjack')throw Error('Use game action for this table.');
    if(r.phase!=='playing')throw Error('Wait for the cards to finish dealing.');
    const p=current(r),h=p&&activeBJHand(p);if(!p||p.id!==u.id||!h||h.status!=='playing')throw Error('Not your turn.');
    const op=typeof action==='string'?action:action?.op;
    if(op==='hit'){
      h.cards.push(draw(r));const v=value(h.cards);if(v>=21){h.status=v>21?'bust':'stood';progress(r);}else{syncBJ(p);state(r);}
    }else if(op==='stand'){h.status='stood';progress(r);}
    else if(op==='split'){
      if(!canSplit(p,u))throw Error('You can split only a matching pair, with enough chips and fewer than four hands.');
      const first=h.cards.shift(),second=h.cards.shift(),stake=h.stake;u.chips-=stake;sendSocial(u.id);
      const aces=first.rank==='A';const a={cards:[first],status:'playing',stake,result:'',blackjackEligible:false,splitAces:aces,doubled:false};const b={cards:[second],status:'playing',stake,result:'',blackjackEligible:false,splitAces:aces,doubled:false};
      p.hands.splice(p.handIndex,1,a,b);p.handIndex=Math.max(0,p.handIndex);syncBJ(p);save();
      r.phase='dealing';const queue=[{kind:'split',id:p.id,hand:p.handIndex},{kind:'split',id:p.id,hand:p.handIndex+1}];state(r);scheduleBJDeal(r,queue,live=>{live.phase='playing';const player=live.players.find(x=>x.id===u.id);if(player){if(aces){player.hands[player.handIndex].status='stood';player.hands[player.handIndex+1].status='stood';}syncBJ(player);}if(aces)progress(live);else state(live);broadcastLobby();});
    }else if(op==='double'){
      if(!canDouble(p,u))throw Error('Double down is available on a two-card hand when you have enough chips.');u.chips-=h.stake;h.stake*=2;h.doubled=true;sendSocial(u.id);save();
      r.phase='dealing';state(r);scheduleBJDeal(r,[{kind:'split',id:p.id,hand:p.handIndex}],live=>{live.phase='playing';const player=live.players.find(x=>x.id===u.id);if(player){const hand=activeBJHand(player);const v=value(hand.cards);hand.status=v>21?'bust':'stood';syncBJ(player);}progress(live);broadcastLobby();});
    }else throw Error('Invalid action.');
    reply(ack,{ok:true});if(r.phase==='finished')sendBoards();
  }));
  socket.on('gameAction',(action,ack)=>run(ack,()=>{
    const u=needUser(socket),r=roomOf(socket);if(r.type==='blackjack')throw Error('Use Hit or Stand.');
    multi.act(r,u.id,action);if(r.phase==='finished')settleMulti(r);
    state(r);broadcastLobby();if(r.phase==='dealing')scheduleMultiDeal(r);else scheduleMultiBot(r);reply(ack,{ok:true});
  }));
  socket.on('chat',(message,ack)=>run(ack,()=>{
    const u=needUser(socket),r=roomOf(socket),text=clean(message,240);
    if(!text)throw Error('Enter a message.');
    const now=Date.now();if(now-(socket.data.lastChat||0)<750)throw Error('Sending messages too quickly.');socket.data.lastChat=now;
    r.chat.push({sender:u.username,text,time:now});r.chat=r.chat.slice(-40);state(r);reply(ack,{ok:true});
  }));
  socket.on('friendRequest',(username,ack)=>run(ack,()=>{
    const u=needUser(socket),other=byName(clean(username,20));
    if(!other||other.id===u.id)throw Error('User not found.');
    if(u.friends.includes(other.id))throw Error('Already friends.');
    if(other.requests.includes(u.id))throw Error('Request already sent.');
    other.requests.push(u.id);save();sendSocial(other.id);reply(ack,{ok:true});
  }));
  socket.on('friendAccept',(username,ack)=>run(ack,()=>{
    const u=needUser(socket),other=byName(clean(username,20));
    if(!other||!u.requests.includes(other.id))throw Error('Friend request not found.');
    u.requests=u.requests.filter(id=>id!==other.id);if(!u.friends.includes(other.id))u.friends.push(other.id);if(!other.friends.includes(u.id))other.friends.push(u.id);
    save();sendSocial(u.id);sendSocial(other.id);reply(ack,{ok:true});
  }));
  socket.on('invite',(username,ack)=>run(ack,()=>{
    const u=needUser(socket),r=roomOf(socket),other=byName(clean(username,20));
    if(!other||!u.friends.includes(other.id))throw Error('Invite a friend from your friends list.');
    other.invites.push({from:u.username,code:r.code,time:Date.now()});other.invites=other.invites.slice(-15);
    save();sendSocial(other.id);reply(ack,{ok:true});
  }));
  socket.on('disconnect',()=>{const uid=socket.data.uid;if(!uid)return;
    if(online.get(uid)===socket.id){online.delete(uid);leave(socket);broadcastSocial();}
  });
});
const port=Number(process.env.PORT)||3000;
server.listen(port,'0.0.0.0',()=>console.log('NOIR CLUB v3.2.0 listening on '+port));
