'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {TYPES,start,dealStep,act,botAction,seatState}=require('./games');
const make=(type)=>({type,players:Array.from({length:TYPES[type].min},(_,i)=>({id:'b'+i,name:'Bot '+i,bot:true}))});
for(const type of Object.keys(TYPES).filter(x=>x!=='blackjack')){
 test(type+' deals and progresses with bots',()=>{
  const g=make(type);start(g);
  assert.equal(g.players.length,TYPES[type].min);
  if(type==='poker'){assert.equal(g.phase,'dealing');assert.equal(g.board.length,0);assert.ok(g.players.every(p=>p.hand.length===0));while(g.phase==='dealing')dealStep(g);assert.equal(g.phase,'playing');assert.equal(g.stage,'preflop');assert.ok(g.players.every(p=>p.hand.length===2));}
  else assert.equal(g.phase,'playing');
  const snapshot=seatState(g,'unknown');assert.equal(snapshot.players.length,g.players.length);
  const hand=snapshot.players[0].hand;assert.ok(hand.every(x=>x===null),'other hands hidden');
  let steps=0;
  while((g.phase==='playing'||g.phase==='dealing')&&steps++<650){if(g.phase==='dealing'){dealStep(g);continue;}const p=g.players[g.turn],a=botAction(g);assert.ok(a,`no action for ${type} ${g.stage}`);act(g,p.id,a);}
  if(type==='poker'||type==='teenpatti'||type==='hearts')assert.equal(g.phase,'finished',type+' should finish by bot simulation');
  console.log(type,steps,g.phase,g.result);
 });
}


test('Texas Hold’em reveals hole cards, flop, turn and river in separate dealing stages',()=>{
 const g=make('poker');start(g);assert.equal(g.phase,'dealing');
 let holeSteps=0;while(g.phase==='dealing'){dealStep(g);holeSteps++;}
 assert.equal(holeSteps,5,'four hole cards plus a final transition');assert.ok(g.players.every(p=>p.hand.length===2));assert.equal(g.board.length,0);
 const actRound=()=>{while(g.phase==='playing'){const p=g.players[g.turn];act(g,p.id,{op:'check'});}};
 actRound();assert.equal(g.phase,'dealing');assert.equal(g.stage,'flop');assert.equal(g.board.length,0);dealStep(g);assert.equal(g.board.length,1);dealStep(g);assert.equal(g.board.length,2);dealStep(g);assert.equal(g.board.length,3);dealStep(g);assert.equal(g.phase,'playing');
 actRound();assert.equal(g.phase,'dealing');assert.equal(g.stage,'turn');assert.equal(g.board.length,3);dealStep(g);assert.equal(g.board.length,4);dealStep(g);assert.equal(g.phase,'playing');
 actRound();assert.equal(g.phase,'dealing');assert.equal(g.stage,'river');assert.equal(g.board.length,4);dealStep(g);assert.equal(g.board.length,5);dealStep(g);assert.equal(g.phase,'playing');
 actRound();assert.equal(g.phase,'finished');
});

// Regression: a new lobby room has no discard pile until the first deal.
for(const type of Object.keys(TYPES).filter(x=>x!=='blackjack')) {
 test(type+' renders state immediately after room creation',()=>{
   const g={...make(type),phase:'lobby',deck:[],chat:[],turn:0};
   g.players.forEach(p=>{p.hand=[];p.result='';p.status='waiting';});
   const state=seatState(g,g.players[0].id);
   assert.equal(state.phase,'lobby');
   assert.equal(state.discard,null);
   assert.equal(state.deckCount,0);
   assert.equal(state.players.length,TYPES[type].min);
 });
}
