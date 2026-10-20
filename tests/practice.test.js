import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoBackend} from '../backend.js';
import {defaultConfig,csvText} from '../core.js';
test('練習12試合を完了後、本番の第1試合だけを集計する',async()=>{
 const b=new DemoBackend(()=>{});await b.beginRound({...defaultConfig(),practice:true,seconds:0,finalRound:true});assert.equal(b.state.config.finalRound,false);
 for(let i=0;i<12;i++){await b.startMatch();await b.fill();await b.closeMatch();await b.beginReveal();await b.reveal(true);}
 assert.equal(b.state.phase,'roundEnd');assert.equal(Object.keys(b.state.history).length,12);await assert.rejects(()=>b.finish());await assert.rejects(()=>b.beginRound(defaultConfig()));
 await b.endPractice();assert.equal(b.state.round,0);assert.deepEqual(b.state.history,{});for(const p of Object.values(b.state.progress)){assert.equal(p.total,0);assert.deepEqual(p.used,{});assert.equal(p.betUsed,false);}
 await b.beginRound({...defaultConfig(),seconds:0});assert.equal(b.state.round,1);await b.startMatch();await b.fill();await b.closeMatch();await b.beginReveal();await b.reveal(true);assert.equal(Object.keys(b.state.history).length,1);assert.equal(csvText(b.state,b.roster).trim().split('\r\n').length,17);
 await assert.rejects(()=>b.endPractice());
});
