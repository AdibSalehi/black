'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {TYPES,start,act,botAction,seatState}=require('./games');
const make=(type)=>({type,players:Array.from({length:TYPES[type].min},(_,i)=>({id:'b'+i,name:'Bot '+i,bot:true}))});
for(const type of Object.keys(TYPES).filter(x=>x!=='blackjack')){
 test(type+' deals and progresses with bots',()=>{
  const g=make(type);start(g);assert.equal(g.phase,'playing');
  assert.equal(g.players.length,TYPES[type].min);
  const snapshot=seatState(g,'unknown');assert.equal(snapshot.players.length,g.players.length);
  const hand=snapshot.players[0].hand;assert.ok(hand.every(x=>x===null),'other hands hidden');
  let steps=0;
  while(g.phase==='playing'&&steps++<550){const p=g.players[g.turn],a=botAction(g);assert.ok(a,`no action for ${type} ${g.stage}`);act(g,p.id,a);}
  if(type!=='rummy'&&type!=='color'&&type!=='durak')assert.equal(g.phase,'finished',type+' should finish by bot simulation');
  console.log(type,steps,g.phase,g.result);
 });
}
