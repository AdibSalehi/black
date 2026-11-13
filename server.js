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
app.get('/health', (_req, res) => res.json({ ok: true, version: '3.0.0' }));
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
function deck() {const d=[];for(let k=0;k<2;k++)for(const suit of ['♠','♥','♦','♣'])for(const rank of ['A','2','3','4','5','6','7','8','9','10','J','Q','K'])d.push({rank,suit});for(let i=d.length-1;i>0;i--){const j=crypto.randomInt(i+1);[d[i],d[j]]=[d[j],d[i]];}return d;}
function value(hand) {let total=0,aces=0;for(const c of hand){if(c.rank==='A'){total+=11;aces++;}else total+=['J','Q','K'].includes(c.rank)?10:Number(c.rank);}while(total>21&&aces){total-=10;aces--;}return total;}
function natural(hand){return hand.length===2&&value(hand)===21;}
function draw(r){if(!r.deck.length) r.deck=deck();return r.deck.pop();}
function current(r){return r.players[r.turn];}
function seat(u){return {id:u.id,name:u.username,bot:false,hand:[],status:'waiting',result:'',stake:0};}
function botSeat(r){const taken=new Set(r.players.map(p=>p.name));let i=1;while(taken.has('Bot '+i))i++;return {id:'bot-'+crypto.randomUUID(),name:'Bot '+i,bot:true,hand:[],status:'waiting',result:'',stake:0};}
function sendSocial(uid) {const u=findUser(uid);if(!u)return;const sid=online.get(uid);if(!sid)return;io.to(sid).emit('social',{me:publicUser(u),requests:u.requests.map(id=>findUser(id)?.username).filter(Boolean),friends:u.friends.map(id=>({name:findUser(id)?.username,online:online.has(id)})).filter(x=>x.name),invitations:u.invites.slice(-15)});}
function broadcastSocial() {for(const uid of online.keys())sendSocial(uid);}
function lobbyData(){return [...rooms.values()].filter(r=>!r.private).map(r=>({code:r.code,host:findUser(r.host)?.username||'Host',count:r.players.length,phase:r.phase,type:r.type||'blackjack'}));}
function broadcastLobby(){io.emit('lobby',lobbyData());}
function state(r){if(r.type!=='blackjack')return multiState(r);for(const p of r.players.filter(x=>!x.bot)){
  const sid=online.get(p.id);if(!sid)continue;
  io.to(sid).emit('state',{
    code:r.code,type:'blackjack',private:r.private,phase:r.phase,hostId:r.host,you:p.id,turnId:r.phase==='playing'?current(r)?.id:null,stake:WAGER,
    dealer:{hand:r.phase==='finished'?r.dealer:(r.phase==='playing'?[r.dealer[0],null]:[]),total:r.phase==='finished'?value(r.dealer):null},
    players:r.players.map(x=>({id:x.id,name:x.name,bot:x.bot,hand:x.hand,total:x.hand.length?value(x.hand):null,status:x.status,result:x.result,stake:x.stake,connected:x.bot||online.has(x.id)})),
    chat:r.chat.slice(-40),myChips:findUser(p.id)?.chips||0
  });
}}
function multiState(r){for(const p of r.players.filter(x=>!x.bot)){
 const sid=online.get(p.id);if(!sid)continue;
 io.to(sid).emit('state',{code:r.code,type:r.type,private:r.private,phase:r.phase,hostId:r.host,you:p.id,stake:WAGER,chat:r.chat.slice(-40),myChips:findUser(p.id)?.chips||0,...multi.seatState(r,p.id)});
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
  try{const a=multi.botAction(live);if(a)multi.act(live,uid,a);if(live.phase==='finished')settleMulti(live);state(live);scheduleMultiBot(live);}catch(e){console.error('Bot error',e.message);}
 },400);
}
function startMulti(r){if(r.phase==='playing')throw Error('Round already running.');
 const t=multi.TYPES[r.type];if(r.players.length<t.min)throw Error('This game requires at least '+t.min+' players (bots are allowed).');
 if(r.players.length>t.max)throw Error('Maximum '+t.max+' players for this game.');
 const humans=r.players.filter(p=>!p.bot);if(humans.some(p=>findUser(p.id).chips<WAGER))throw Error('A player does not have enough chips.');
 for(const p of humans){findUser(p.id).chips-=WAGER;sendSocial(p.id);}save();
 r.settled=false;multi.start(r);
 if(r.type==='hearts'){const first=r.players.findIndex(p=>p.hand.some(c=>c.suit==='♣'&&c.rank==='2'));r.turn=first;}
 state(r);broadcastLobby();scheduleMultiBot(r);
}
function resetLobby(r){r.phase='lobby';r.dealer=[];r.turn=0;r.stage='';r.result='';for(const p of r.players){p.hand=[];p.result='';p.stake=0;p.status='waiting';}state(r);broadcastLobby();}
function settle(r) {
  r.phase='finished';
  if(r.players.some(p=>p.status!=='bust'&&!natural(p.hand)))while(value(r.dealer)<17)r.dealer.push(draw(r));
  const dv=value(r.dealer);
  for(const p of r.players){
    const pv=value(p.hand);
    if(p.status==='bust')p.result='Lose';
    else if(natural(p.hand)&&!natural(r.dealer))p.result='Blackjack!';
    else if(natural(r.dealer)&&!natural(p.hand))p.result='Lose';
    else if(dv>21||pv>dv)p.result='Win';
    else if(pv===dv)p.result='Push';
    else p.result='Lose';
    p.status='done';
    if(!p.bot){const u=findUser(p.id);u.games++;
      if(p.result==='Win'||p.result==='Blackjack!'){u.wins++;u.chips+=p.result==='Blackjack!'?Math.floor(p.stake*2.5):p.stake*2;}
      else if(p.result==='Push')u.chips+=p.stake;
      else u.losses++;
      sendSocial(u.id);
    }
  }
  save();state(r);broadcastLobby();sendBoards();
}
let botTimeout=null;
function progress(r){while(r.turn<r.players.length&&r.players[r.turn].status!=='playing')r.turn++;if(r.turn>=r.players.length){settle(r);return;}state(r);scheduleBot(r);}
function scheduleBot(r){if(r.phase!=='playing'||!current(r)?.bot)return;
  const code=r.code, id=current(r).id;
  setTimeout(()=>{const live=rooms.get(code);if(!live||live.phase!=='playing'||current(live)?.id!==id)return;
    const bot=current(live);const score=value(bot.hand);
    if(score<17){bot.hand.push(draw(live));if(value(bot.hand)>=21){bot.status=value(bot.hand)>21?'bust':'stood';live.turn++;progress(live);}else{state(live);scheduleBot(live);}}
    else{bot.status='stood';live.turn++;progress(live);}
  },650);
}
function start(r){
  if(r.type!=='blackjack')return startMulti(r);
  if(r.phase==='playing')throw Error('Round already running.');
  const humans=r.players.filter(p=>!p.bot);if(humans.length<1||r.players.length<2)throw Error('Add a friend or a bot first.');
  if(humans.some(p=>findUser(p.id).chips<WAGER))throw Error('A player does not have enough virtual chips.');
  for(const p of humans){findUser(p.id).chips-=WAGER;sendSocial(p.id);}save();
  r.deck=deck();r.dealer=[];r.turn=0;r.phase='playing';
  for(const p of r.players){p.hand=[];p.status='playing';p.result='';p.stake=p.bot?0:WAGER;}
  for(let round=0;round<2;round++){for(const p of r.players)p.hand.push(draw(r));r.dealer.push(draw(r));}
  for(const p of r.players)if(natural(p.hand))p.status='stood';
  progress(r);broadcastLobby();
}
function ensureHost(r,u){if(r.host!==u.id)throw Error('Only room host can do this.');}
function leave(socket) {
  const code=socket.data.room;if(!code)return;delete socket.data.room;socket.leave(code);
  const r=rooms.get(code);if(!r)return;
  const idx=r.players.findIndex(p=>p.id===socket.data.uid);if(idx<0)return;
  if(r.phase==='playing'&&r.type!=='blackjack'){state(r);scheduleMultiBot(r);broadcastLobby();return;}
  if(r.phase==='playing'){
    // Disconnecting mid-round counts as standing. Settlement remains valid and stake cannot disappear.
    const p=r.players[idx];if(p.status==='playing')p.status='stood';
    if(r.turn===idx){r.turn++;progress(r);}else state(r);
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
    if(r.phase==='playing')throw Error('Round in progress. Join after this round.');
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
  socket.on('register',({username,password}={},ack)=>run(ack,()=>{
    loginThrottle(socket);username=clean(username,20);
    if(!/^[a-zA-Z0-9_]{3,20}$/.test(username))throw Error('Username must be 3–20 letters, digits or underscores.');
    if(typeof password!=='string'||password.length<8||password.length>128)throw Error('Password must be 8–128 characters.');
    if(byName(username))throw Error('Username already taken.');
    const salt=crypto.randomBytes(16).toString('hex');
    const u={id:crypto.randomUUID(),username,salt,passwordHash:hashPassword(password,salt),chips:STARTING_CHIPS,wins:0,losses:0,games:0,friends:[],requests:[],invites:[]};
    database.users.push(u);save();const token=tokenFor(u);loginSocket(socket,u);reply(ack,{ok:true,token,user:publicUser(u)});sendBoards();
  }));
  socket.on('login',({username,password}={},ack)=>run(ack,()=>{
    loginThrottle(socket);const u=byName(clean(username,20));
    const valid=u&&typeof password==='string'&&password.length<=128&&crypto.timingSafeEqual(Buffer.from(u.passwordHash,'hex'),Buffer.from(hashPassword(password,u.salt),'hex'));
    if(!valid)throw Error('Invalid username or password.');
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
    const code=makeCode(),r={code,type,host:u.id,private:!!priv,players:[seat(u)],phase:'lobby',turn:0,dealer:[],deck:[],chat:[]};
    rooms.set(code,r);socket.data.room=code;socket.join(code);reply(ack,{ok:true,code});state(r);broadcastLobby();
  }));
  socket.on('join',({code}={},ack)=>run(ack,()=>{
    const u=needUser(socket);const r=rooms.get(clean(code,6).toUpperCase());if(!r)throw Error('Room not found.');
    attach(socket,r,u);reply(ack,{ok:true,code:r.code});
  }));
  socket.on('leave',(_payload,ack)=>run(ack,()=>{leave(socket);reply(ack,{ok:true});}));
  socket.on('addBot',(_payload,ack)=>run(ack,()=>{
    const u=needUser(socket),r=roomOf(socket);ensureHost(r,u);
    if(r.phase==='playing')throw Error('Wait for the round to finish.');
    if(r.players.length>=(multi.TYPES[r.type]?.max||MAX_PLAYERS))throw Error('Room full.');
    r.players.push(botSeat(r));resetLobby(r);reply(ack,{ok:true});
  }));
  socket.on('removeBots',(_payload,ack)=>run(ack,()=>{
    const u=needUser(socket),r=roomOf(socket);ensureHost(r,u);
    if(r.phase==='playing')throw Error('Wait for the round to finish.');
    r.players=r.players.filter(p=>!p.bot);resetLobby(r);reply(ack,{ok:true});
  }));
  socket.on('start',(_payload,ack)=>run(ack,()=>{const u=needUser(socket),r=roomOf(socket);ensureHost(r,u);start(r);reply(ack,{ok:true});}));
  socket.on('move',(action,ack)=>run(ack,()=>{
    const u=needUser(socket),r=roomOf(socket);
    if(r.type!=='blackjack')throw Error('Use game action for this table.');
    if(r.phase!=='playing')throw Error('No round in progress.');
    const p=current(r);if(!p||p.id!==u.id||p.status!=='playing')throw Error('Not your turn.');
    if(action==='hit'){
      p.hand.push(draw(r));if(value(p.hand)>=21){p.status=value(p.hand)>21?'bust':'stood';r.turn++;progress(r);}else state(r);
    }else if(action==='stand'){p.status='stood';r.turn++;progress(r);}else throw Error('Invalid action.');
    reply(ack,{ok:true});if(r.phase==='finished')sendBoards();
  }));
  socket.on('gameAction',(action,ack)=>run(ack,()=>{
    const u=needUser(socket),r=roomOf(socket);if(r.type==='blackjack')throw Error('Use Hit or Stand.');
    multi.act(r,u.id,action);if(r.phase==='finished')settleMulti(r);
    state(r);broadcastLobby();scheduleMultiBot(r);reply(ack,{ok:true});
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
server.listen(port,'0.0.0.0',()=>console.log('Blackjack Social v2 listening on '+port));
