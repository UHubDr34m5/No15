import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import * as dbSDK from 'firebase/database';
import {FirebaseBackend} from '../backend.js';
import {defaultConfig,freshProgress} from '../core.js';

// These tests communicate only with the local emulators. The database SDK's
// WebSocket transport otherwise applies HTTP_PROXY even for loopback hosts.
for(const key of ['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy'])delete process.env[key];

const {ref,set,get,update,serverTimestamp,runTransaction,goOffline,goOnline,onValue}=dbSDK;
let env;
const code='TEST15',roomPath=`games/${code}`;
const actor=(uid,teacher=false)=>env.authenticatedContext(uid,{firebase:{sign_in_provider:teacher?'google.com':'anonymous'}}).database();
const p=(db,path='')=>ref(db,`${roomPath}${path?'/'+path:''}`);
const waitConnected=db=>new Promise((resolve,reject)=>{let stop;const timeout=setTimeout(()=>{stop?.();reject(Error('reconnect timed out'));},10000);stop=onValue(ref(db,'.info/connected'),s=>{if(s.val()){clearTimeout(timeout);stop?.();resolve();}});});
function seed(n=16,phase='collecting'){
  const roster=Object.fromEntries(Array.from({length:n},(_,i)=>['p'+(i+1),{name:'生徒'+(i+1),nameKey:'生徒'+(i+1),authUid:'p'+(i+1),joinedAt:i}]));
  return {meta:{owner:'teacher',capacity:16,createdAt:1,closed:false,title:'test'},roster,members:Object.fromEntries(Object.keys(roster).map(id=>[id,id])),public:{phase,round:1,match:1,completed:0,matchKey:'match1',lockedAt:0,event:'none',config:defaultConfig(),progress:freshProgress(roster),history:{},revealed:[],submittedCount:0,deadline:0,revision:0}};
}
async function reset(n=16,phase='collecting'){await env.clearDatabase();await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),roomPath),seed(n,phase)));}
async function hostBackend(){const db=actor('teacher',true),b=new FirebaseBackend(()=>{});b.sdk=dbSDK;b.db=db;b.auth={currentUser:{uid:'teacher'}};b.online=true;b.role='teacher';b.code=code;b.roster=(await get(p(db,'roster'))).val();b.state=(await get(p(db,'public'))).val();return b;}
async function sync(b){b.state=(await get(p(b.db,'public'))).val();b.roster=(await get(p(b.db,'roster'))).val();}
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-no15',database:{host:'127.0.0.1',port:9000,rules:await readFile(new URL('../database.rules.json',import.meta.url),'utf8')}});});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>reset());
test('部屋全体・未発表カード一覧・他人のカードは生徒に読ませない',async()=>{
  const a=actor('p1'),b=actor('p2'),host=actor('teacher',true);
  await assertSucceeds(set(p(a,'secrets/match1/p1'),{card:15,bet:true,at:serverTimestamp()}));
  await assertSucceeds(get(p(a,'secrets/match1/p1')));
  await assertFails(get(p(b,'secrets/match1/p1')));
  await assertFails(get(p(a,'secrets/match1')));
  await assertFails(get(p(a)));
  await assertSucceeds(get(p(host,'secrets/match1')));
  await assertSucceeds(get(p(a,'public')));
  await assertFails(get(p(actor('outsider'),'public')));
});
test('生徒による進行・得点・参加者・権限・教員用計算結果の改変を拒否',async()=>{
  const a=actor('p1');
  for(const [path,value]of [['public/phase','finished'],['public/progress/p1/total',999],['meta/owner','p1'],['members/p1','p2'],['roster/p1/authUid','p2'],['host/match1',{foo:1}]])await assertFails(set(p(a,path),value));
  await assertFails(get(p(a,'host')));
  await assertFails(set(ref(a,'teacherRooms/teacher/TEST15'),{at:1}));
});
test('匿名生徒は教員ルームを作成できず、Google認証の教員は作成できる',async()=>{
  const room=seed(2,'lobby');room.meta.owner='newteacher';
  await assertFails(set(ref(actor('p1'),'games/NEW234'),room));
  await assertSucceeds(set(ref(actor('newteacher',true),'games/NEW234'),room));
});
test('確定済み提出の書き換え・削除・他人としての提出を拒否',async()=>{
  const a=actor('p1');await set(p(a,'secrets/match1/p1'),{card:10,bet:false,at:serverTimestamp()});
  await assertFails(set(p(a,'secrets/match1/p1'),{card:15,bet:false,at:serverTimestamp()}));
  await assertFails(set(p(a,'secrets/match1/p1'),null));
  await assertFails(set(p(a,'secrets/match1/p2'),{card:15,bet:false,at:serverTimestamp()}));
});
test('範囲外・小数・不正な型・追加フィールドをDBで拒否',async()=>{
  for(const card of [0,16,1.1,'15'])await assertFails(set(p(actor('p1'),'secrets/match1/p1'),{card,bet:false,at:serverTimestamp()}));
  await assertFails(set(p(actor('p1'),'secrets/match1/p1'),{card:2,bet:'true',at:serverTimestamp()}));
  await assertFails(set(p(actor('p1'),'secrets/match1/p1'),{card:2,bet:false,at:serverTimestamp(),score:999}));
});
test('使用済み数字・勝負再使用・無効の勝負をDBで拒否',async()=>{
  const h=actor('teacher',true),a=actor('p1');
  await set(p(h,'public/progress/p1/used/15'),true);
  await assertFails(set(p(a,'secrets/match1/p1'),{card:15,bet:false,at:serverTimestamp()}));
  await set(p(h,'public/progress/p1/betUsed'),true);
  await assertFails(set(p(a,'secrets/match1/p1'),{card:14,bet:true,at:serverTimestamp()}));
  await set(p(h,'public/progress/p1/betUsed'),false);await set(p(h,'public/config/battle'),false);
  await assertFails(set(p(a,'secrets/match1/p1'),{card:14,bet:true,at:serverTimestamp()}));
  await assertSucceeds(set(p(a,'secrets/match1/p1'),{card:14,bet:false,at:serverTimestamp()}));
});
test('期限後・締切後・別試合への提出をDBで拒否',async()=>{
  const h=actor('teacher',true),a=actor('p1');await set(p(h,'public/deadline'),Date.now()-1000);
  await assertFails(set(p(a,'secrets/match1/p1'),{card:1,bet:false,at:serverTimestamp()}));
  await update(p(h,'public'),{deadline:0,phase:'locked'});
  await assertFails(set(p(a,'secrets/match1/p1'),{card:1,bet:false,at:serverTimestamp()}));
  await set(p(h,'public/phase'),'collecting');
  await assertFails(set(p(a,'secrets/oldmatch/p1'),{card:1,bet:false,at:serverTimestamp()}));
});
test('16人がほぼ同時に提出しても16件が保持され、集計は一度だけ',async()=>{
  const writes=Array.from({length:16},(_,i)=>set(p(actor('p'+(i+1)),`secrets/match1/p${i+1}`),{card:i%15+1,bet:false,at:serverTimestamp()}));
  await Promise.all(writes);const b=await hostBackend();await b.closeMatch();await sync(b);
  assert.equal(Object.keys((await get(p(b.db,'secrets/match1'))).val()).length,16);
  await b.beginReveal();await sync(b);await b.reveal(true);await sync(b);
  assert.equal(Object.keys(b.state.history).length,1);assert.equal(b.state.progress.p1.total,0);assert.equal(b.state.progress.p16.total,0);assert.equal(b.state.progress.p15.total,15);
  await assert.rejects(()=>b.reveal(true));await sync(b);assert.equal(Object.keys(b.state.history).length,1);
});
test('段階公開は次の数字を含まず、最後の数字も表示してから確定',async()=>{
  await reset(2);const a=actor('p1'),c=actor('p2'),b=await hostBackend();
  await set(p(a,'secrets/match1/p1'),{card:1,bet:false,at:serverTimestamp()});await set(p(c,'secrets/match1/p2'),{card:15,bet:true,at:serverTimestamp()});
  await b.closeMatch();await sync(b);await b.beginReveal();await sync(b);await b.reveal();await sync(b);
  assert.equal(b.state.revealed.length,1);assert.equal(b.state.revealed[0].card,1);assert.equal(b.state.history??null,null);
  const publicData=(await get(p(a,'public'))).val();assert.ok(!JSON.stringify(publicData.revealed).includes('生徒2'));
  await b.reveal();await sync(b);assert.equal(b.state.phase,'reveal');assert.equal(b.state.revealed[1].card,15);assert.equal(b.state.revealDone,true);
  await b.reveal();await sync(b);assert.equal(b.state.phase,'result');assert.equal(b.state.progress.p2.total,30);
});
test('全員未提出でも0点で確定し、カードを消費しない',async()=>{
  await reset(2);const b=await hostBackend();await b.closeMatch();await sync(b);await b.beginReveal();await sync(b);await b.reveal(true);await sync(b);assert.equal(b.state.phase,'result');assert.equal(b.state.progress.p1.total,0);assert.equal(b.state.progress.p1.used??null,null);assert.equal(b.state.progress.p1.betUsed,false);
});
test('未発表の試合取消→再試合は新しい提出先になり、使用を消費しない',async()=>{
  await reset(2);const b=await hostBackend(),a=actor('p1');await set(p(a,'secrets/match1/p1'),{card:15,bet:true,at:serverTimestamp()});
  await b.cancelMatch();await sync(b);assert.equal(b.state.completed,0);assert.equal(b.state.phase,'ready');await b.startMatch();await sync(b);assert.notEqual(b.state.matchKey,'match1');assert.equal(b.state.match,1);
  await assertSucceeds(set(p(a,`secrets/${b.state.matchKey}/p1`),{card:15,bet:true,at:serverTimestamp()}));
});
test('受付再開後は提出を受け付け、既に提出した人は変更できない',async()=>{
  await reset(2);const b=await hostBackend(),a=actor('p1'),c=actor('p2');await set(p(a,'secrets/match1/p1'),{card:10,bet:false,at:serverTimestamp()});await b.closeMatch();await sync(b);await b.extendTime(60);await sync(b);
  await assertSucceeds(set(p(c,'secrets/match1/p2'),{card:11,bet:false,at:serverTimestamp()}));
  await assertFails(set(p(a,'secrets/match1/p1'),{card:12,bet:false,at:serverTimestamp()}));
});
test('接続を切っている間も保存済み提出が残り、再接続後に取得できる',async()=>{
  const a=actor('p1');await set(p(a,'secrets/match1/p1'),{card:9,bet:false,at:serverTimestamp()});goOffline(a);goOnline(a);await waitConnected(a);const fresh=actor('p1');assert.equal((await get(p(fresh,'secrets/match1/p1'))).val().card,9);
});
test('切断中にキューに入った提出も、再接続が期限後なら拒否',async()=>{
  const a=actor('p1'),h=actor('teacher',true);await waitConnected(a);goOffline(a);const pending=set(p(a,'secrets/match1/p1'),{card:15,bet:false,at:serverTimestamp()});const rejected=assertFails(pending);await set(p(h,'public/deadline'),Date.now()-1000);goOnline(a);await rejected;assert.equal((await get(p(h,'secrets/match1/p1'))).exists(),false);
});
test('同名・同一端末・定員の参加管理を競合なく処理',async()=>{
  await reset(2,'lobby');const b=await hostBackend();await set(p(b.db,'meta/capacity'),3);
  await Promise.all(['new1','new2'].map(id=>set(p(actor(id),`joinRequests/${id}`),{name:'同じ名前',kind:'join',at:serverTimestamp()})));
  await b.processRequests();await sync(b);assert.equal(Object.keys(b.roster).length,3);const replies=(await get(p(b.db,'joinReplies'))).val();assert.equal(Object.values(replies).filter(r=>r.status==='accepted').length,1);assert.equal(Object.values(replies).filter(r=>r.status==='rejected').length,1);
  await assertFails(set(p(actor('new1'),'joinRequests/new1'),{name:'別名',kind:'join',at:serverTimestamp()}));
});
test('途中参加は拒否し、復帰申請は受け付ける。引継ぎ後は旧端末が提出不可',async()=>{
  const old=actor('p1'),newdb=actor('replacement'),b=await hostBackend();
  await assertFails(set(p(newdb,'joinRequests/replacement'),{name:'生徒1',kind:'join',at:serverTimestamp()}));
  await set(p(newdb,'joinRequests/replacement'),{name:'生徒1',kind:'recover',at:serverTimestamp()});
  await b.recover('replacement','p1');
  await assertFails(set(p(old,'secrets/match1/p1'),{card:15,bet:false,at:serverTimestamp()}));
  await assertSucceeds(set(p(newdb,'secrets/match1/p1'),{card:15,bet:false,at:serverTimestamp()}));
  await assertFails(get(p(old,'public')));await assertSucceeds(get(p(newdb,'public')));
});
test('生徒自身の申請以外を書き込めず、教員だけが参加者を除外できる',async()=>{
  await reset(2,'lobby');const a=actor('outsider'),b=await hostBackend();
  await assertFails(set(p(a,'joinRequests/somebody'),{name:'test',kind:'join',at:serverTimestamp()}));
  await b.removePlayer('p1');await assertFails(set(p(actor('p1'),'joinRequests/p1'),{name:'新しい名前',kind:'join',at:serverTimestamp()}));
});
test('本番と同じDB経由で24試合を進行し、カード復活・累積・最終公開を確認',async()=>{
  await reset(2,'lobby');const b=await hostBackend();
  // The lobby starts at round 0 in the actual application.
  await update(p(b.db,'public'),{round:0,match:0});await sync(b);
  const a=actor('p1'),c=actor('p2');
  for(let round=1;round<=2;round++){
    await b.beginRound({...defaultConfig(),seconds:0,events:false,hiddenAll:true,finalRound:round===2});await sync(b);
    assert.equal(b.state.round,round);assert.equal(b.state.progress.p1.used??null,null);
    for(let match=1;match<=12;match++){
      await b.startMatch();await sync(b);assert.equal(b.state.hidden,true);
      await Promise.all([set(p(a,`secrets/${b.state.matchKey}/p1`),{card:match,bet:false,at:serverTimestamp()}),set(p(c,`secrets/${b.state.matchKey}/p2`),{card:match,bet:false,at:serverTimestamp()})]);
      await b.closeMatch();await sync(b);await b.beginReveal();await sync(b);await b.reveal(true);await sync(b);
    }
    assert.equal(b.state.phase,'roundEnd');assert.equal(b.state.progress.p1.total,36*round);assert.equal(b.state.progress.p1.roundTotal,36);
  }
  await b.finish();await sync(b);assert.equal(b.state.phase,'finished');assert.equal(b.state.hidden,false);assert.equal(Object.keys(b.state.history).length,24);
});
test('実アプリの購読経路：ルーム作成→参加→人数同期→段階発表→リロード復帰',async()=>{
  const backends=[];
  function backend(uid,teacher=false){const b=new FirebaseBackend(()=>{});b.sdk=dbSDK;b.db=actor(uid,teacher);b.auth={currentUser:{uid,providerData:teacher?[{providerId:'google.com'}]:[]}};b.init=async()=>{};b.online=true;backends.push(b);return b;}
  async function until(fn){const end=Date.now()+6000;while(!fn()){if(Date.now()>end)throw Error('subscription timed out');await new Promise(r=>setTimeout(r,10));}}
  try{
    const host=backend('realhost',true);const newcode=await host.create(16,'購読テスト');
    const a=backend('reala'),b=backend('realb');await a.open(newcode);await b.open(newcode);
    await Promise.all([a.join('プレイヤーA'),b.join('プレイヤーB')]);await until(()=>Object.keys(host.roster).length===2&&a.state&&b.state);
    await host.beginRound({...defaultConfig(),seconds:0,events:false});await until(()=>host.state.phase==='ready');
    await host.startMatch();await until(()=>a.state.phase==='collecting'&&b.state.phase==='collecting');
    await Promise.all([a.submit(15,true),b.submit(10,false)]);await until(()=>host.state.submittedCount===2&&a.ownSubmission&&b.ownSubmission);
    await host.closeMatch();await until(()=>host.state.phase==='locked');await host.beginReveal();await until(()=>host.state.phase==='reveal');
    await host.reveal();await until(()=>a.state.revealed?.length===1);assert.equal(a.state.revealed[0].card,10);assert.equal(a.state.progress.reala.used??null,null);
    await host.reveal();await until(()=>host.state.revealDone);assert.equal(host.state.phase,'reveal');
    await host.reveal();await until(()=>a.state.phase==='result');assert.equal(a.state.progress.reala.total,30);assert.equal(b.state.progress.realb.total,10);
    a.destroy();const reload=backend('reala');await reload.open(newcode);await until(()=>reload.state?.phase==='result');assert.equal(reload.state.progress.reala.total,30);assert.equal(reload.pid,'reala');assert.equal(reload.ownSubmission.card,15);
  }finally{for(const b of backends)b.destroy();}
});
