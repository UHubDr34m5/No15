import {VERSION,clone,nickname,createRound,makeEventPlan,scoreMatch,applyResult,defaultConfig} from './core.js?v=20261018-id1';
import {firebaseConfig} from './config.js?v=20261018-id1';

export const configured=()=>!!firebaseConfig.apiKey&&!Object.values(firebaseConfig).some(v=>String(v).includes('YOUR_'));
const uidToken=()=>crypto.randomUUID().replaceAll('-','').slice(0,18);
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codeToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>alphabet[n%alphabet.length]).join('');
const initialState=()=>({phase:'lobby',round:0,match:0,completed:0,revision:0,hidden:false,config:defaultConfig(),progress:{},history:{},revealed:[],submittedCount:0});
// Internal Firebase account identifier; the password is never stored in site code.
export function teacherEmail(id){
  const normalized=String(id??'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(normalized))throw Error('教員IDは3〜32文字の半角英数字・ハイフン・アンダースコアで入力してください（先頭は英数字）。');
  return `${normalized}@teacher.no15.invalid`;
}
export class FirebaseBackend {
  constructor(notify){this.notify=notify;this.online=false;this.offset=0;this.unsubs=[];this.globalUnsubs=[];this.code='';this.role='student';this.pid='';this.sending=false;this.processing=false;this.dirty=false;}
  async init(){
    if(this.sdk)return;
    if(!configured())throw Error('Firebaseの初期設定が必要です。「設定ガイド」を開いてください。体験モードは設定なしで使えます。');
    const [app,auth,db]=await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js')
    ]);
    this.sdk={...app,...auth,...db};
    this.app=app.initializeApp(firebaseConfig);
    this.auth=auth.getAuth(this.app);this.db=db.getDatabase(this.app);
    await auth.setPersistence(this.auth,auth.browserLocalPersistence);
    await new Promise((resolve,reject)=>{const off=auth.onAuthStateChanged(this.auth,()=>{off();resolve();},reject);});
    this.globalUnsubs.push(db.onValue(db.ref(this.db,'.info/connected'),snap=>{this.online=snap.val()===true;if(!this.online)this.presenceRef=null;this.notify();if(this.online)this.setPresence();}));
    this.globalUnsubs.push(db.onValue(db.ref(this.db,'.info/serverTimeOffset'),snap=>{this.offset=snap.val()??0;}));
  }
  now(){return Date.now()+this.offset;}
  async signTeacher(id,password){
    const email=id===undefined?null:teacherEmail(id);
    await this.init();
    if(email){
      if(!password)throw Error('パスワードを入力してください。');
      await this.sdk.signInWithEmailAndPassword(this.auth,email,password);
    }
    const user=this.auth.currentUser;
    if(!user?.providerData?.some(p=>p.providerId==='password'))throw Error('教員IDとパスワードでログインしてください。');
    const allowed=(await this.sdk.get(this.sdk.ref(this.db,`teachers/${user.uid}`))).val();
    if(allowed!==true){await this.sdk.signOut(this.auth);throw Error('このアカウントには教員の利用許可がありません。設定ガイドの教員登録を確認してください。');}
  }
  async signOut(){this.clearRoom();await this.sdk.signOut(this.auth);this.code='';}
  async ensureUser(){await this.init();if(!this.auth.currentUser)await this.sdk.signInAnonymously(this.auth);return this.auth.currentUser.uid;}
  path(suffix=''){return this.sdk.ref(this.db,`games/${this.code}${suffix?'/'+suffix:''}`);}
  async create(capacity,title){
    await this.signTeacher();
    if(!Number.isInteger(capacity)||capacity<2||capacity>16)throw Error('参加人数は2〜16人で設定してください。');
    const owner=this.auth.currentUser.uid;
    for(let tries=0;tries<5;tries++){
      const code=codeToken(),room={meta:{owner,capacity,title:String(title||'NO.15').slice(0,40),createdAt:this.now(),closed:false,version:VERSION},public:initialState()};
      try{
        const result=await this.sdk.runTransaction(this.sdk.ref(this.db,`games/${code}`),s=>s?undefined:room,{applyLocally:false});
        if(!result.committed)continue;
        await this.sdk.set(this.sdk.ref(this.db,`teacherRooms/${owner}/${code}`),{title:room.meta.title,at:room.meta.createdAt});
        await this.open(code);return code;
      }catch(e){if(e.code==='PERMISSION_DENIED'&&tries<4)continue;throw e;}
    }
    throw Error('ルームを作成できませんでした。もう一度お試しください。');
  }
  async savedRooms(){await this.signTeacher();return (await this.sdk.get(this.sdk.ref(this.db,`teacherRooms/${this.auth.currentUser.uid}`))).val()??{};}
  clearRoom(){for(const f of this.unsubs)f();this.unsubs=[];if(this.secretUnsub)this.secretUnsub();if(this.ownUnsub)this.ownUnsub();if(this.presenceRef)this.sdk.remove(this.presenceRef).catch(()=>{});this.presenceRef=null;this.secretUnsub=null;this.ownUnsub=null;this.watchedKey='';this.state=null;this.roster={};this.requests={};this.privateSubmissions={};this.ownSubmission=null;this.pid='';}
  async open(raw){
    await this.ensureUser();this.clearRoom();this.code=String(raw).toUpperCase().replace(/\s/g,'');
    if(!/^[A-Z2-9]{6}$/.test(this.code))throw Error('6文字のルームコードを入力してください。');
    const meta=(await this.sdk.get(this.path('meta'))).val();if(!meta)throw Error('ルームが見つかりません。コードをご確認ください。');
    this.meta=meta;this.role=meta.owner===this.auth.currentUser.uid?'teacher':'student';
    const uid=this.auth.currentUser.uid;
    this.unsubs.push(this.sdk.onValue(this.path('meta'),s=>{this.meta=s.val();this.notify();}));
    this.unsubs.push(this.sdk.onValue(this.path('roster'),s=>{this.roster=s.val()??{};this.notify();}));
    if(this.role==='teacher'){
      this.watchPublic();
      this.unsubs.push(this.sdk.onValue(this.path('joinRequests'),s=>{this.requests=s.val()??{};this.processRequests();this.notify();}));
      this.unsubs.push(this.sdk.onValue(this.path('joinReplies'),s=>{this.replies=s.val()??{};this.notify();}));
      this.unsubs.push(this.sdk.onValue(this.path('presence'),s=>{this.presence=s.val()??{};this.notify();}));
    }else{
      this.unsubs.push(this.sdk.onValue(this.path(`members/${uid}`),s=>{const pid=s.val();if(pid&&pid!==this.pid){this.pid=pid;this.watchPublic();this.setPresence();}else if(!pid&&this.pid){this.pid='';this.state=null;this.notify();}}));
      this.unsubs.push(this.sdk.onValue(this.path(`joinReplies/${uid}`),s=>{const previous=this.reply;this.reply=s.val();if(previous?.status==='rejected'&&!this.reply)this.requestReset=true;this.notify();}));
    }
    this.notify();
  }
  watchPublic(){
    if(this.publicUnsub)this.publicUnsub();
    this.publicUnsub=this.sdk.onValue(this.path('public'),s=>{this.state=s.val();this.watchSubmissions();this.notify();},e=>{this.error=e;this.notify();});
    this.unsubs.push(()=>{this.publicUnsub?.();this.publicUnsub=null;});
  }
  watchSubmissions(){
    const key=this.state?.matchKey??'',watch=`${this.pid}:${key}:${this.role}`;
    if(watch===this.watchedKey)return;this.watchedKey=watch;
    this.secretUnsub?.();this.ownUnsub?.();this.ownSubmission=null;this.privateSubmissions={};
    if(!key)return;
    if(this.role==='teacher')this.secretUnsub=this.sdk.onValue(this.path(`secrets/${key}`),snap=>{
      this.privateSubmissions=snap.val()??{};const count=Object.keys(this.privateSubmissions).length;
      if(this.state?.phase==='collecting'&&this.state.matchKey===key&&this.state.submittedCount!==count){
        this.sdk.runTransaction(this.path('public'),s=>s?.phase==='collecting'&&s.matchKey===key?{...s,submittedCount:count}:undefined,{applyLocally:false}).catch(e=>{this.error=e;this.notify();});
      }
      this.notify();
    });
    else if(this.pid)this.ownUnsub=this.sdk.onValue(this.path(`secrets/${key}/${this.pid}`),s=>{this.ownSubmission=s.val();this.notify();},e=>{this.error=e;this.notify();});
  }
  async setPresence(){
    if(!this.sdk||!this.online||!this.pid||!this.code||this.presenceRef)return;
    this.presenceRef=this.path(`presence/${this.pid}/${uidToken()}`);
    try{await this.sdk.onDisconnect(this.presenceRef).remove();await this.sdk.set(this.presenceRef,this.sdk.serverTimestamp());}catch{this.presenceRef=null;}
  }
  async join(name,kind='join'){
    const n=nickname(name),uid=this.auth.currentUser.uid;
    if(!this.online)throw Error('接続を確認してから参加してください。');
    const existing=(await this.sdk.get(this.path(`joinRequests/${uid}`))).val();
    if(existing){if(this.reply?.status==='rejected')throw Error(this.reply.message+' 別の名前で参加する場合は教員に申請のリセットを依頼してください。');return;}
    await this.sdk.set(this.path(`joinRequests/${uid}`),{name:n.name,kind,at:this.sdk.serverTimestamp()});
    this.notify();
  }
  async processRequests(){
    if(this.role!=='teacher')return;this.dirty=true;if(this.processing)return;this.processing=true;
    try{do{
      this.dirty=false;
      await this.sdk.runTransaction(this.path(),room=>{
        if(!room)return room;
        room=clone(room);room.roster??={};room.members??={};room.joinReplies??={};
        for(const [uid,r] of Object.entries(room.joinRequests??{}).sort((a,b)=>a[1].at-b[1].at)){
          if(r.kind!=='join'||room.joinReplies[uid])continue;
          let n;try{n=nickname(r.name);}catch(e){room.joinReplies[uid]={status:'rejected',message:e.message};continue;}
          const existing=Object.entries(room.roster).find(([,p])=>p.authUid===uid);
          if(existing){room.joinReplies[uid]={status:'accepted',pid:existing[0]};continue;}
          let error='';
          if(room.public.phase!=='lobby')error='ゲーム開始後の新規参加はできません。';
          else if(Object.keys(room.roster).length>=room.meta.capacity)error='ルームが満員です。';
          else if(Object.values(room.roster).some(p=>p.nameKey===n.key))error='同じニックネームが使われています。';
          if(error){room.joinReplies[uid]={status:'rejected',message:error};continue;}
          room.roster[uid]={name:n.name,nameKey:n.key,authUid:uid,joinedAt:r.at};room.members[uid]=uid;room.joinReplies[uid]={status:'accepted',pid:uid};
        }
        return room;
      },{applyLocally:false});
    }while(this.dirty);}catch(e){this.error=e;this.notify();}finally{this.processing=false;}
  }
  async resetRequest(uid){await this.sdk.update(this.path(),{[`joinRequests/${uid}`]:null,[`joinReplies/${uid}`]:null});}
  async recover(uid,pid){
    await this.sdk.runTransaction(this.path(),room=>{
      if(!room)return room;room=clone(room);const target=room.roster?.[pid],r=room.joinRequests?.[uid];
      if(!target||r?.kind!=='recover')return;
      if(room.members?.[uid]&&room.members[uid]!==pid)throw Error('この端末は既に別の参加者として登録されています。');
      delete room.members[target.authUid];room.members[uid]=pid;target.authUid=uid;
      room.joinReplies??={};room.joinReplies[uid]={status:'accepted',pid};delete room.joinRequests[uid];
      return room;
    },{applyLocally:false});
  }
  async removePlayer(pid){
    await this.sdk.runTransaction(this.path(),room=>{
      if(!room)return room;if(room.public.phase!=='lobby')throw Error('参加者の削除は開始前だけできます。');
      room=clone(room);const p=room.roster?.[pid];if(!p)return;
      delete room.roster[pid];delete room.members[p.authUid];room.bans??={};room.bans[p.authUid]=true;room.joinReplies??={};room.joinReplies[p.authUid]={status:'rejected',message:'教員が参加登録を取り消しました。'};return room;
    },{applyLocally:false});
  }
  async mutate(fn){
    if(!this.online)throw Error('接続が戻るまでお待ちください。');
    const r=await this.sdk.runTransaction(this.path('public'),s=>s?fn(clone(s)):s,{applyLocally:false});
    if(!r.committed)throw Error('別の画面で進行状況が更新されました。画面を確認してもう一度操作してください。');return r.snapshot.val();
  }
  async beginRound(config){const plan=makeEventPlan(config),roster=clone(this.roster);await this.mutate(s=>createRound(s,roster,config,plan));}
  async startMatch(){
    const token=uidToken(),now=this.now();await this.mutate(s=>{
      if(!['ready','result'].includes(s.phase)||s.completed>=12)return;
      const match=(s.completed??0)+1;
      return {...s,phase:'collecting',match,matchKey:`r${s.round}m${match}_${token}`,event:s.plan?.[match]??'none',hidden:s.config.hiddenAll||!!s.config.hiddenMatches?.includes(match),deadline:s.config.seconds?now+s.config.seconds*1000:0,startedAt:now,lockedAt:0,submittedCount:0,revealed:[],missed:[],revision:s.revision+1};
    });
  }
  async submit(card,bet){
    if(!this.online)throw Error('オフラインです。接続が戻ってから提出してください。');
    if(this.sending)throw Error('提出を確認しています。');
    if(!this.pid)throw Error('参加登録が必要です。');
    this.sending=true;this.notify();
    try{await this.sdk.set(this.path(`secrets/${this.state.matchKey}/${this.pid}`),{card,bet,at:this.sdk.serverTimestamp()});}
    finally{this.sending=false;this.notify();}
  }
  async closeMatch(){const now=this.now();await this.mutate(s=>s.phase==='collecting'?{...s,phase:'locked',lockedAt:now,revision:s.revision+1}:undefined);}
  async extendTime(seconds=60){const now=this.now();await this.mutate(s=>['collecting','locked'].includes(s.phase)?{...s,phase:'collecting',deadline:now+seconds*1000,lockedAt:0,revision:s.revision+1}:undefined);}
  async cancelMatch(){await this.mutate(s=>{
    if(!['collecting','locked'].includes(s.phase))return;
    return {...s,phase:'ready',match:s.completed,matchKey:'',revealed:[],submittedCount:0,deadline:0,event:'none',revision:s.revision+1};
  });}
  async getPlan(){
    const s=clone(this.state);if(!['locked','reveal'].includes(s?.phase))throw Error('提出を締め切ってください。');
    const stored=(await this.sdk.get(this.path(`host/${s.matchKey}`))).val();
    if(stored?.lockedAt===s.lockedAt)return {...stored,groups:stored.groups??[],missed:stored.missed??[]};
    const submissions=(await this.sdk.get(this.path(`secrets/${s.matchKey}`))).val()??{};
    const plan={...scoreMatch(this.roster,s.progress,submissions,s.event,s.config.battle),lockedAt:s.lockedAt};
    await this.sdk.set(this.path(`host/${s.matchKey}`),plan);return plan;
  }
  async beginReveal(){const plan=await this.getPlan();await this.mutate(s=>s.phase==='locked'?{...s,phase:'reveal',revealed:[],revealDone:plan.groups.length===0,revision:s.revision+1}:undefined);}
  async reveal(all=false){
    const plan=await this.getPlan(),key=this.state.matchKey,step=(this.state.revealed??[]).length,now=this.now();
    await this.mutate(s=>{
      if(s.phase!=='reveal'||s.matchKey!==key||(s.revealed??[]).length!==step||s.lockedAt!==plan.lockedAt)return;
      const groups=plan.groups??[];
      if(all||step>=groups.length)return applyResult(s,this.roster,plan,now);
      return {...s,revealed:groups.slice(0,step+1),revealDone:step+1>=groups.length,revision:s.revision+1};
    });
  }
  async finish(){await this.mutate(s=>s.phase==='roundEnd'?{...s,phase:'finished',hidden:false,revision:s.revision+1}:undefined);await this.sdk.update(this.path('meta'),{closed:true});}
  async deleteRoom(){const code=this.code,owner=this.auth.currentUser.uid;this.clearRoom();await this.sdk.remove(this.sdk.ref(this.db,`games/${code}`));await this.sdk.remove(this.sdk.ref(this.db,`teacherRooms/${owner}/${code}`));}
  destroy(){this.clearRoom();for(const f of this.globalUnsubs)f();this.globalUnsubs=[];}
}

export class DemoBackend {
  constructor(notify){this.notify=notify;this.demo=true;this.online=true;this.role='teacher';this.code='DEMO15';this.pid='p1';this.meta={capacity:16,title:'NO.15 体験ルーム'};this.roster={};this.submissions={};this.ownSubmission=null;this.state=initialState();this.presence={};
    ['ゆうすけ','あおい','はると','さくら','れん','ひなた','みお','そうた','ゆい','りく','あかり','こうき','なな','かいと','しおり','つばさ'].forEach((name,i)=>{this.roster['p'+(i+1)]={name,joinedAt:i,authUid:'p'+(i+1)};});
  }
  now(){return Date.now();}
  emit(){this.ownSubmission=this.submissions?.[this.pid]??null;this.notify();}
  async beginRound(config){this.state=createRound(this.state,this.roster,config);this.emit();}
  async startMatch(){
    const s=this.state,match=s.completed+1;if(!['ready','result'].includes(s.phase))throw Error('次の試合はまだ開始できません。');
    this.state={...s,phase:'collecting',match,matchKey:uidToken(),event:s.plan[match],hidden:s.config.hiddenAll||s.config.hiddenMatches.includes(match),deadline:s.config.seconds?Date.now()+s.config.seconds*1000:0,submittedCount:0,revealed:[],missed:[],lockedAt:0};this.submissions={};
    for(const id of Object.keys(this.roster).filter(id=>id!==this.pid))this.botSubmit(id);
    this.emit();
  }
  botSubmit(id){const p=this.state.progress[id],cards=Array.from({length:15},(_,i)=>i+1).filter(n=>!p.used?.[n]);if(!cards.length)return;const card=cards[Math.floor(Math.random()*cards.length)],bet=!!this.state.config.battle&&!p.betUsed&&Math.random()<1/(13-this.state.match);this.submissions[id]={card,bet};this.state.submittedCount=Object.keys(this.submissions).length;}
  async fill(){for(const id of Object.keys(this.roster))if(!this.submissions[id])this.botSubmit(id);this.emit();}
  async submit(card,bet){if(this.state.phase!=='collecting'||this.state.deadline&&Date.now()>this.state.deadline)throw Error('提出は締め切られました。');if(this.submissions[this.pid])throw Error('提出済みです。');scoreMatch(this.roster,this.state.progress,{[this.pid]:{card,bet}},this.state.event,this.state.config.battle);this.submissions[this.pid]={card,bet};this.state.submittedCount=Object.keys(this.submissions).length;this.emit();}
  async closeMatch(){this.state.phase='locked';this.state.lockedAt=Date.now();this.emit();}
  async extendTime(seconds=60){this.state.phase='collecting';this.state.deadline=Date.now()+seconds*1000;this.emit();}
  async cancelMatch(){this.state={...this.state,phase:'ready',match:this.state.completed,matchKey:'',submittedCount:0,revealed:[]};this.submissions={};this.emit();}
  async beginReveal(){this.plan=scoreMatch(this.roster,this.state.progress,this.submissions,this.state.event,this.state.config.battle);this.state.phase='reveal';this.state.revealDone=this.plan.groups.length===0;this.emit();}
  async reveal(all=false){const n=(this.state.revealed??[]).length;if(all||n>=this.plan.groups.length)this.state=applyResult(this.state,this.roster,this.plan,Date.now());else{this.state.revealed=this.plan.groups.slice(0,n+1);this.state.revealDone=n+1>=this.plan.groups.length;}this.emit();}
  async finish(){this.state.phase='finished';this.state.hidden=false;this.emit();}
  async removePlayer(id){if(this.state.phase!=='lobby')throw Error('開始前だけ削除できます。');delete this.roster[id];this.emit();}
  destroy(){}
}
