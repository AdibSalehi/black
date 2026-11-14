'use strict';
// Server-authoritative, social/free-play card games. These are deliberately streamlined rulesets.
const crypto=require('crypto');
const SUITS=['♠','♥','♦','♣'];
const RANKS=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const TYPES={blackjack:{name:'Blackjack',min:2,max:6,desc:'Hit or stand against the dealer'},poker:{name:"Texas Hold’em",min:2,max:6,desc:'Sequential hole cards, flop, turn and river; casual check/fold rounds (no betting)'},color:{name:'Color Match',min:2,max:6,desc:'Match color or number; draw when stuck'},hearts:{name:'Hearts',min:4,max:4,desc:'Trick taking with hearts penalties (no card passing)'},rummy:{name:'Rummy',min:2,max:6,desc:'Draw, discard and declare sets or runs'},teenpatti:{name:'Teen Patti',min:2,max:6,desc:'Three-card showdown; stay or fold'},durak:{name:'Durak',min:2,max:6,desc:'Attack/defend and draw from the talon'}};
function pack(low=2){const d=[];for(const s of SUITS)for(let n=low;n<=14;n++)d.push({rank:RANKS[n-2],suit:s,n,id:crypto.randomUUID()});return shuffle(d);}
function shuffle(d){for(let i=d.length-1;i>0;i--){let j=crypto.randomInt(i+1);[d[i],d[j]]=[d[j],d[i]];}return d;}
function draw(g){return g.deck.pop();}
function label(c){return c?`${c.rank}${c.suit}`:'?';}
function same(a,b){return a&&b&&a.n===b.n&&a.suit===b.suit;}
function tally(cards){const count={};for(let c of cards)count[c.n]=(count[c.n]||0)+1;return count;}
function chooseAct(g){return g.players[g.turn]||null;}
function next(g){g.turn=(g.turn+1)%g.players.length;}
function remove(hand,i){if(!Number.isInteger(i)||i<0||i>=hand.length)throw Error('Invalid card selection');return hand.splice(i,1)[0];}
function ensureTurn(g,id){if(g.phase!=='playing')throw Error('Round is not running.');if(chooseAct(g)?.id!==id)throw Error('Not your turn.');}
function ensureAction(x){if(!x||typeof x!=='object'||Array.isArray(x))throw Error('Invalid action.');}
function start(g){
 g.phase='playing';g.result='';g.pot=0;g.turn=0;g.stage='';g.board=[];g.discard=[];g.trick=[];g.trump=null;g.lastWinner=null;g.completed=[];g.moves=0;g.deck=pack(g.type==='durak'?6:2);
 for(let p of g.players){p.hand=[];p.folded=false;p.finished=false;p.score=0;p.result='';p.pendingDraw=false;}
 switch(g.type){
 case 'poker':
   // Texas Hold'em: deal private hole cards one at a time, then reveal streets separately.
   g.phase='dealing';g.stage='hole';g.dealQueue=[];g.pendingDeal=[];g.pendingStreet=null;
   for(let round=0;round<2;round++)for(const p of g.players)g.dealQueue.push({playerId:p.id,card:draw(g)});
   break;
 case 'teenpatti':g.stage='show-or-fold';for(let i=0;i<3;i++)for(let p of g.players)p.hand.push(draw(g));break;
 case 'color':g.stage='match';g.colors=['Ruby','Emerald','Sapphire','Amber'];g.deck=[];for(let color of g.colors)for(let n=0;n<=9;n++)for(let k=0;k<2;k++)g.deck.push({rank:String(n),suit:color,n,id:crypto.randomUUID()});shuffle(g.deck);for(let i=0;i<7;i++)for(let p of g.players)p.hand.push(draw(g));g.discard=[draw(g)];g.direction=1;break;
 case 'hearts':g.stage='tricks';for(let i=0;i<13;i++)for(let p of g.players)p.hand.push(draw(g));g.heartsBroken=false;g.trickNumber=0;g.leader=0;g.turn=g.players.findIndex(p=>p.hand.some(c=>c.suit==='♣'&&c.rank==='2'));break;
 case 'rummy':g.stage='draw';for(let i=0;i<7;i++)for(let p of g.players)p.hand.push(draw(g));g.discard=[draw(g)];break;
 case 'durak':g.stage='attack';for(let i=0;i<6;i++)for(let p of g.players)p.hand.push(draw(g));g.trump=g.deck[0]?.suit||'♠';g.attackIndex=0;g.defendIndex=1%g.players.length;g.turn=g.attackIndex;g.attackCard=null;g.defendCard=null;break;
 }
 return g;
}
function dealStep(g){
 if(g.type!=='poker'||g.phase!=='dealing')return true;
 if(g.dealQueue?.length){const item=g.dealQueue.shift();const player=g.players.find(p=>p.id===item.playerId);if(player)player.hand.push(item.card);return false;}
 if(g.pendingDeal?.length){g.board.push(g.pendingDeal.shift());return false;}
 if(g.stage==='hole'){
   g.phase='playing';g.stage='preflop';g.turn=firstActive(g);return true;
 }
 if(g.pendingStreet){g.stage=g.pendingStreet;g.pendingStreet=null;g.phase='playing';for(const p of g.players)if(!p.folded)p.finished=false;g.turn=firstActive(g);return true;}
 return true;
}
function firstActive(g){const i=g.players.findIndex(p=>!p.folded);return i<0?0:i;}
function beginStreet(g,street,count){draw(g); // burn one card before each community-card street
 g.phase='dealing';g.stage=street;g.pendingStreet=street;g.pendingDeal=Array.from({length:count},()=>draw(g));}
function finishPokerAction(g,p,op){
 if(op==='fold')p.folded=true;p.finished=true;
 const active=g.players.filter(x=>!x.folded);
 if(active.length===1){finishWinner(g,active[0],active[0].name+' wins uncontested.');return;}
 const pending=active.filter(x=>!x.finished);
 if(pending.length){let idx=(g.turn+1)%g.players.length;while(g.players[idx].folded||g.players[idx].finished)idx=(idx+1)%g.players.length;g.turn=idx;return;}
 if(g.stage==='preflop'){beginStreet(g,'flop',3);return;}
 if(g.stage==='flop'){beginStreet(g,'turn',1);return;}
 if(g.stage==='turn'){beginStreet(g,'river',1);return;}
 finishShowdown(g);
}

function pokerScore(cards){const c=cards.slice().sort((a,b)=>b.n-a.n);const counts=tally(c);const groups=Object.entries(counts).map(([n,k])=>[Number(n),k]).sort((a,b)=>b[1]-a[1]||b[0]-a[0]);const flush=SUITS.find(s=>cards.filter(x=>x.suit===s).length>=5);
 let straight=0;const vals=[...new Set(cards.map(x=>x.n))];if(vals.includes(14))vals.push(1);for(let n=14;n>=5;n--)if([0,1,2,3,4].every(x=>vals.includes(n-x))) {straight=n;break;}
 let sf=0;if(flush){const f=[...new Set(cards.filter(x=>x.suit===flush).map(x=>x.n))];if(f.includes(14))f.push(1);for(let n=14;n>=5;n--)if([0,1,2,3,4].every(x=>f.includes(n-x))){sf=n;break;}}
 let result;
 if(sf)result=[8,sf];else if(groups[0][1]===4)result=[7,groups[0][0],...groups.filter(x=>x[0]!==groups[0][0]).map(x=>x[0])];
 else if(groups[0][1]>=3&&groups.some((x,i)=>i>0&&x[1]>=2))result=[6,groups[0][0],groups.find((x,i)=>i>0&&x[1]>=2)[0]];
 else if(flush)result=[5,...cards.filter(x=>x.suit===flush).map(x=>x.n).sort((a,b)=>b-a).slice(0,5)];
 else if(straight)result=[4,straight];else if(groups[0][1]>=3)result=[3,groups[0][0],...groups.filter(x=>x[0]!==groups[0][0]).map(x=>x[0]).slice(0,2)];
 else if(groups.filter(x=>x[1]>=2).length>=2){const ps=groups.filter(x=>x[1]>=2).slice(0,2).map(x=>x[0]);result=[2,...ps,...groups.filter(x=>!ps.includes(x[0])).map(x=>x[0]).slice(0,1)];}
 else if(groups[0][1]>=2)result=[1,groups[0][0],...groups.filter(x=>x[0]!==groups[0][0]).map(x=>x[0]).slice(0,3)];
 else result=[0,...c.map(x=>x.n).slice(0,5)];return result;
}
function compare(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){if((a[i]||0)!==(b[i]||0))return (a[i]||0)-(b[i]||0);}return 0;}
function teenScore(hand){const n=hand.map(c=>c.n).sort((a,b)=>b-a);const counts=tally(hand);const sameSuit=hand.every(c=>c.suit===hand[0].suit);const straight=(n[0]-n[1]===1&&n[1]-n[2]===1)||(n.join(',')==='14,3,2');const seqHigh=n.join(',')==='14,3,2'?3:n[0];if(new Set(n).size===1)return[5,n[0]];if(straight&&sameSuit)return[4,seqHigh];if(straight)return[3,seqHigh];if(sameSuit)return[2,...n];if(Object.values(counts).includes(2)){const pair=Number(Object.entries(counts).find(x=>x[1]===2)[0]);return[1,pair,n.find(x=>x!==pair)];}return[0,...n];}
function finishShowdown(g){const live=g.players.filter(p=>!p.folded);if(!live.length)throw Error('No contenders.');let best=null,winners=[];for(const p of live){const score=g.type==='poker'?pokerScore([...p.hand,...g.board]):teenScore(p.hand);if(!best||compare(score,best)>0){best=score;winners=[p.id];}else if(compare(score,best)===0)winners.push(p.id);}g.phase='finished';g.stage='showdown';g.winners=winners;g.result='Showdown: '+g.players.filter(p=>winners.includes(p.id)).map(p=>p.name).join(' & ')+' win'+(winners.length>1?' (tie)':'')+'!';for(let p of g.players)p.result=p.folded?'Fold':winners.includes(p.id)?'Win':'Lose';}
function scoreHearts(g){const scores={};for(const p of g.players)scores[p.id]=p.score;let min=Math.min(...g.players.map(p=>p.score));const winners=g.players.filter(p=>p.score===min).map(p=>p.id);g.winners=winners;g.phase='finished';g.result='Hand complete. Lowest penalty: '+min;g.players.forEach(p=>p.result=winners.includes(p.id)?'Win':'Lose');}
function finishWinner(g,p,msg){g.phase='finished';g.winners=[p.id];g.result=msg||p.name+' wins!';g.players.forEach(x=>x.result=x.id===p.id?'Win':'Lose');}
function validMeld(hand){if(hand.length<7)return false;const counts=tally(hand);const opts=[];for(const [key,num] of Object.entries(counts))if(num>=3)opts.push(hand.map((c,i)=>c.n===Number(key)?i:-1).filter(i=>i>=0).slice(0,Math.min(4,num)));
 for(const suit of SUITS){const cards=hand.map((c,i)=>({...c,i})).filter(c=>c.suit===suit).sort((a,b)=>a.n-b.n);for(let i=0;i<cards.length;i++)for(let j=i+2;j<cards.length;j++){const sub=cards.slice(i,j+1);if(sub.every((c,k)=>k===0||c.n===sub[k-1].n+1))opts.push(sub.map(x=>x.i));}}
 function search(used,covered){if(covered===hand.length)return true;for(const opt of opts){if(opt.every(i=>!used.has(i))){let next=new Set([...used,...opt]);if(search(next,covered+opt.length))return true;}}return false;}return search(new Set(),0);
}
function resolveDurak(g){const defender=g.players[g.defendIndex],attacker=g.players[g.attackIndex];if(g.stage==='defended'){g.discard.push(g.attackCard,g.defendCard);g.result=defender.name+' defended.';}else {defender.hand.push(g.attackCard);if(g.defendCard)defender.hand.push(g.defendCard);g.result=defender.name+' takes the attack.';}
 // Refill attacker then defender to six.
 for(const p of [attacker,defender])while(g.deck.length&&p.hand.length<6)p.hand.push(draw(g));
 g.attackCard=null;g.defendCard=null;
 const still=g.players.filter(p=>p.hand.length>0);if(!g.deck.length&&still.length<=1){const winners=g.players.filter(p=>p.hand.length===0);g.phase='finished';g.winners=winners.map(p=>p.id);g.result=still.length?'Durak: '+still[0].name+' is the last player.':'All players are out.';g.players.forEach(p=>p.result=winners.includes(p)?'Win':'Lose');return;}
 const nextAttacker=g.stage==='defended'?g.defendIndex:(g.defendIndex+1)%g.players.length;g.attackIndex=nextAttacker;g.defendIndex=(nextAttacker+1)%g.players.length;g.stage='attack';g.turn=g.attackIndex;
}
function act(g,id,a){ensureAction(a);ensureTurn(g,id);if(g.type==='rummy'&&g.moves++>120){const best=g.players.slice().sort((a,b)=>a.hand.reduce((v,c)=>v+c.n,0)-b.hand.reduce((v,c)=>v+c.n,0))[0];finishWinner(g,best,'Rummy draw limit: '+best.name+' wins with lowest card total.');return;}const p=chooseAct(g);const op=a.op;const i=Number(a.index);
 if(g.type==='poker'){if(!['check','fold'].includes(op))throw Error('Check or fold.');finishPokerAction(g,p,op);return;}
 if(g.type==='teenpatti'){
   if(!['check','fold'].includes(op))throw Error('Stay or fold.');if(op==='fold')p.folded=true;p.finished=true;
   const left=g.players.filter(x=>!x.folded);if(left.length===1){finishWinner(g,left[0],left[0].name+' wins uncontested.');return;}
   const pending=g.players.filter(x=>!x.finished);if(!pending.length){finishShowdown(g);return;}let guard=0;do{next(g);guard++;}while(g.players[g.turn].finished&&guard<g.players.length);return;
 }
 if(g.type==='color'){
   if(op==='play'){
     const c=p.hand[i],top=g.discard[g.discard.length-1];if(!c||!(c.n===top.n||c.suit===top.suit))throw Error('Match the color or number.');g.discard.push(remove(p.hand,i));if(!p.hand.length){finishWinner(g,p);return;}p.pendingDraw=false;next(g);
   }else if(op==='draw'){
     if(!g.deck.length){g.deck=shuffle(g.discard.splice(0,g.discard.length-1));}if(g.deck.length)p.hand.push(draw(g));p.pendingDraw=false;next(g);
   }else throw Error('Play or draw a card.');return;
 }
 if(g.type==='hearts'){
   if(op!=='play')throw Error('Play a card.');const c=p.hand[i];if(!c)throw Error('Select a card.');
   if(g.trick.length){const lead=g.trick[0].card.suit;if(p.hand.some(x=>x.suit===lead)&&c.suit!==lead)throw Error('You must follow suit.');}
   else if(c.suit==='♥'&&!g.heartsBroken&&p.hand.some(x=>x.suit!=='♥'))throw Error('Hearts have not been broken.');
   if(g.trickNumber===0&&g.trick.length===0&&!(c.rank==='2'&&c.suit==='♣'))throw Error('Lead with 2♣.');
   remove(p.hand,i);if(c.suit==='♥')g.heartsBroken=true;g.trick.push({id:p.id,card:c});
   if(g.trick.length===4){const lead=g.trick[0].card.suit;const winner=g.trick.filter(x=>x.card.suit===lead).sort((a,b)=>b.card.n-a.card.n)[0];const points=g.trick.reduce((sum,x)=>sum+(x.card.suit==='♥'?1:0)+(x.card.suit==='♠'&&x.card.rank==='Q'?13:0),0);const w=g.players.find(x=>x.id===winner.id);w.score+=points;g.completed.push({winner:w.name,points,cards:g.trick.map(x=>x.card)});g.trick=[];g.trickNumber++;g.turn=g.players.indexOf(w);if(g.trickNumber===13)scoreHearts(g);}else next(g);return;
 }
 if(g.type==='rummy'){
   if(g.stage==='draw'){
     if(!['draw','take'].includes(op))throw Error('Draw from deck or take discard.');let c;if(op==='take')c=g.discard.pop();else{if(!g.deck.length)g.deck=shuffle(g.discard.splice(0,g.discard.length-1));c=draw(g);}if(!c)throw Error('No cards left.');p.hand.push(c);g.stage='discard';
   }else{
     if(op==='declare'){
       if(p.hand.length!==8||!validMeld(p.hand))throw Error('You need eight cards fully arranged into valid sets or runs (minimum three cards per meld).');finishWinner(g,p);return;
     }
     if(op!=='discard')throw Error('Discard one card.');g.discard.push(remove(p.hand,i));g.stage='draw';next(g);
   }return;
 }
 if(g.type==='durak'){
   if(g.stage==='attack'){
     if(op!=='play')throw Error('Choose a card to attack.');g.attackCard=remove(p.hand,i);g.stage='defend';g.turn=g.defendIndex;
   }else if(g.stage==='defend'){
     if(op==='take'){g.stage='taken';resolveDurak(g);return;}
     if(op!=='play')throw Error('Defend with a higher card of the same suit, or a trump card.');const c=p.hand[i],attack=g.attackCard;if(!c)throw Error('Select a card.');const beats=(c.suit===attack.suit&&c.n>attack.n)||(c.suit===g.trump&&attack.suit!==g.trump);if(!beats)throw Error('That card cannot beat the attack.');g.defendCard=remove(p.hand,i);g.stage='defended';resolveDurak(g);
   }return;
 }
 throw Error('Unsupported game.');
}
function seatState(g,viewer,showAll){return {type:g.type,stage:g.stage,phase:g.phase,turnId:g.phase==='playing'?chooseAct(g)?.id:null,result:g.result||'',winners:g.winners||[],board:g.board||[],trump:g.trump,deckCount:g.deck?.length||0,discard:g.discard?.length?g.discard[g.discard.length-1]:null,roundHistory:g.completed?.slice(-3)||[],trick:g.trick||[],attackCard:g.attackCard,defendCard:g.defendCard,players:g.players.map(p=>({id:p.id,name:p.name,bot:p.bot,hand:p.id===viewer||g.phase==='finished'||showAll?(p.hand||[]):(p.hand||[]).map(()=>null),count:p.hand?.length||0,folded:p.folded,score:p.score,result:p.result,finished:p.finished})),myHand:g.players.find(p=>p.id===viewer)?.hand||[]};}
function botAction(g){const p=chooseAct(g);if(!p)return null;
 if(['poker','teenpatti'].includes(g.type))return{op:'check'};
 if(g.type==='color'){const top=g.discard.at(-1);const i=p.hand.findIndex(c=>c.n===top.n||c.suit===top.suit);return i<0?{op:'draw'}:{op:'play',index:i};}
 if(g.type==='hearts'){const legal=p.hand.map((c,i)=>({c,i})).filter(({c})=>g.trick.length?(!p.hand.some(x=>x.suit===g.trick[0].card.suit)||c.suit===g.trick[0].card.suit):(g.trickNumber===0?c.suit==='♣'&&c.rank==='2':g.heartsBroken||c.suit!=='♥'||p.hand.every(x=>x.suit==='♥')));return{op:'play',index:(legal[0]||{i:0}).i};}
 if(g.type==='rummy'){if(g.stage==='draw')return{op:'draw'};if(p.hand.length===8&&validMeld(p.hand))return{op:'declare'};return{op:'discard',index:p.hand.length-1};}
 if(g.type==='durak'){if(g.stage==='attack')return{op:'play',index:0};const attack=g.attackCard;let i=p.hand.findIndex(c=>(c.suit===attack.suit&&c.n>attack.n)||(c.suit===g.trump&&attack.suit!==g.trump));return i>=0?{op:'play',index:i}:{op:'take'};}
 return null;
}
module.exports={TYPES,start,dealStep,act,seatState,botAction};
