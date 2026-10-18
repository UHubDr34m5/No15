import {defaultConfig,validateConfig,csvText,EVENTS} from './core.js?v=20261018-id3';
import {FirebaseBackend,DemoBackend} from './backend.js?v=20261018-id3';
import {renderApp,settingsHTML,rulesHTML,esc,resultRows} from './view.js?v=20261018-id3';

const root=document.getElementById('app'),modal=document.getElementById('modal'),modalBody=document.getElementById('modal-body'),toastEl=document.getElementById('toast');
const ctx={backend:null,role:'student',tab:'game',selected:null,bet:false,busy:false,projection:false,sound:false,privateView:false,rankScope:'total',rankRound:null,historyRound:null,homeTeacher:false,savedRooms:{},joining:false,joinSent:false,recovering:false,draft:{code:'',name:''}};
let renderPending=false,lastKey='',lastRound=0,toastTimer,modalResolve,lastGroup='',audio;
function toast(message,error=false){clearTimeout(toastTimer);toastEl.textContent=message;toastEl.className='show'+(error?' error':'');toastTimer=setTimeout(()=>toastEl.className='',error?10000:4500);}
function message(error){const code=String(error?.code??'').toLowerCase();if(['auth/invalid-credential','auth/wrong-password','auth/user-not-found','auth/invalid-login-credentials'].includes(code))return '教員IDまたはパスワードが違います。入力内容を確認してください。';if(code==='auth/too-many-requests')return 'ログインを繰り返したため、一時的に制限されています。時間をおいて再試行してください。';if(code==='auth/network-request-failed')return '通信できませんでした。ネットワーク接続を確認してください。';if(code==='auth/user-disabled')return 'この教員アカウントは無効になっています。管理者に確認してください。';if(code.includes('popup-closed'))return 'ログイン画面が閉じられました。もう一度お試しください。';if(code.includes('popup-blocked'))return 'ポップアップがブロックされました。このサイトのポップアップを許可してから再試行してください。';if(code.includes('unauthorized-domain'))return 'Firebase Authenticationの「承認済みドメイン」にGitHub Pagesのドメインを追加してください。';if(code.includes('operation-not-allowed'))return 'Firebase Authenticationでメール／パスワード認証・匿名認証を有効にしてください。';if(code.includes('permission')||String(error?.message).toLowerCase().includes('permission_denied'))return '操作が許可されませんでした。締切・提出済み・カード使用済み・参加資格をご確認ください。初回設定中の場合はデータベースルールも確認してください。';return error?.message??String(error);}
function notify(){
  const b=ctx.backend;
  if(b?.requestReset){b.requestReset=false;ctx.joinSent=false;}
  if(b?.state){
    if(ctx.joining){ctx.joining=false;ctx.joinSent=false;}
    if(!b.demo)ctx.role=b.role;
    if(b.state.matchKey!==lastKey){ctx.selected=null;ctx.bet=false;lastKey=b.state.matchKey;}
    if(b.state.round!==lastRound){ctx.historyRound=null;ctx.rankRound=null;lastRound=b.state.round;}
    if(!b.demo)try{localStorage.setItem('no15-room',b.code);}catch{}
    const group=b.state.phase==='reveal'?b.state.revealed?.at(-1):null,gid=group?`${b.state.matchKey}:${group.card}`:'';
    if(gid&&gid!==lastGroup){lastGroup=gid;if(ctx.sound)play(group.count===1);}
  }
  if(b?.error){const e=b.error;b.error=null;toast(message(e),true);}
  if(!renderPending){renderPending=true;requestAnimationFrame(()=>{renderPending=false;render();});}
}
function render(){
  const id=document.activeElement?.id,start=document.activeElement?.selectionStart,end=document.activeElement?.selectionEnd;
  document.body.classList.toggle('projection',ctx.projection);root.innerHTML=renderApp(ctx);
  if(ctx.busy)root.querySelectorAll('button[data-act]').forEach(el=>{if(!['sound','rules','guide','tab'].includes(el.dataset.act))el.disabled=true;});
  if(id){const el=document.getElementById(id);if(el){el.focus({preventScroll:true});try{el.setSelectionRange(start,end);}catch{}}}
  tick();
}
function tick(){
  const b=ctx.backend,s=b?.state;if(!s)return;
  const left=s.deadline?Math.max(0,Math.ceil((s.deadline-b.now())/1000)):0;
  document.querySelectorAll('[data-timer]').forEach(el=>{el.textContent=s.deadline?(left?`残り ${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}`:'受付時間終了'):'時間無制限';el.classList.toggle('urgent',!!s.deadline&&left<=10);});
  if(s.phase==='collecting'&&s.deadline&&left===0){root.querySelectorAll('[data-act="submit"],[data-act="card"],[data-act="bet"]').forEach(el=>el.disabled=true);}
}
setInterval(tick,300);
async function run(fn){if(ctx.busy)return;ctx.busy=true;notify();const warning=setTimeout(()=>toast('通信の完了を確認しています。接続が戻るまでお待ちください。'),12000);try{return await fn();}catch(e){toast(message(e),true);}finally{clearTimeout(warning);ctx.busy=false;notify();}}
function showModal(html){modalBody.innerHTML=html;modal.showModal();modal.scrollTop=0;}
function closeModal(answer=false){modal.close();if(modalResolve){modalResolve(answer);modalResolve=null;}}
function confirmAction(title,text,label='実行する',danger=false){return new Promise(resolve=>{modalResolve=resolve;showModal(`<h2 id="modal-title">${esc(title)}</h2><p>${esc(text)}</p><div class="modal-actions"><button class="btn ghost" data-act="modal-close">戻る</button><button class="btn ${danger?'danger':'primary'}" data-act="confirm-yes">${esc(label)}</button></div>`);});}
modal.addEventListener('cancel',e=>{e.preventDefault();closeModal(false);});
modal.addEventListener('click',e=>{if(e.target===modal&&e.clientX&&(e.clientX<modal.getBoundingClientRect().left||e.clientX>modal.getBoundingClientRect().right))closeModal(false);});
function newFirebase(){if(ctx.backend&&!ctx.backend.demo)return ctx.backend;ctx.backend?.destroy();ctx.backend=new FirebaseBackend(notify);return ctx.backend;}
function startDemo(){ctx.backend?.destroy();ctx.backend=new DemoBackend(notify);ctx.role='teacher';ctx.tab='game';ctx.joining=false;ctx.privateView=false;ctx.selected=null;ctx.bet=false;lastKey='';notify();}
async function openRoom(code){const b=newFirebase();ctx.joining=true;ctx.draft.code=code;await b.open(code);if(b.role==='teacher'){ctx.joining=false;ctx.role='teacher';}else ctx.role='student';ctx.tab='game';notify();}
function roomURL(){const u=new URL('./',location.href);u.search='';u.hash=`join=${ctx.backend.code}`;return u.href;}
function qrModal(){const b=ctx.backend,url=b.demo?'':roomURL();showModal(`<button class="dialog-close" data-act="modal-close" aria-label="閉じる">×</button><h2 id="modal-title">${b.demo?'体験モードのルーム':'スマートフォンで参加'}</h2><div class="qr-layout">${b.demo?'<div class="notice warning">体験モードのコードでは別端末と対戦できません。実際のルームはFirebase設定後に作成してください。</div>':'<div class="qr" id="room-qr"></div>'}<div class="room-code">${esc(b.code)}</div>${!b.demo?`<p class="copy-url">${esc(url)}</p><button class="btn primary" data-act="copy-url">参加URLをコピー</button>`:''}<button class="btn ghost" data-act="modal-close">閉じる</button></div>`);if(!b.demo&&window.qrcode){const q=window.qrcode(0,'M');q.addData(url);q.make();document.getElementById('room-qr').innerHTML=q.createSvgTag({cellSize:5,margin:2,scalable:true});}}
function play(success){try{audio??=new (window.AudioContext||window.webkitAudioContext)();audio.resume();[0,.13,.26].forEach((delay,i)=>{const osc=audio.createOscillator(),gain=audio.createGain();osc.type='sine';osc.frequency.value=(success?[523,659,784]:[330,392,440])[i];gain.gain.setValueAtTime(0,audio.currentTime+delay);gain.gain.linearRampToValueAtTime(.09,audio.currentTime+delay+.015);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+delay+.28);osc.connect(gain);gain.connect(audio.destination);osc.start(audio.currentTime+delay);osc.stop(audio.currentTime+delay+.3);});}catch{}}
function exportCSV(){const b=ctx.backend,blob=new Blob([csvText(b.state,b.roster)],{type:'text/csv;charset=utf-8'}),a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`NO15_${b.code}_${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('確定済みの試合をCSVで保存しました。');}
async function action(act,el){
  const b=ctx.backend,s=b?.state;
  if(act==='modal-close')return closeModal(false);
  if(act==='confirm-yes')return closeModal(true);
  if(act==='rules')return showModal(rulesHTML());
  if(act==='guide'){if(document.body.dataset.preview==='true')return showModal('<h2 id="modal-title">本番用の設定・操作ガイド</h2><p>GitHub Pages用ZIPの中にある「README.html」を開いてください。Firebaseの初期設定、公開手順、教員・生徒の操作、詳しいルールをまとめています。</p><div class="modal-actions"><button class="btn primary" data-act="modal-close">閉じる</button></div>');return window.open('README.html','_blank','noopener');}
  if(act==='sound'){ctx.sound=!ctx.sound;if(ctx.sound)play(true);return notify();}
  if(act==='home'){
    if(s&&!await confirmAction('ホームへ戻りますか？','オンラインのルームデータは保持されます。教員が画面を離れている間は、集計・発表と提出人数の同期が止まります。','ホームへ戻る'))return;
    const teacher=!!b?.auth?.currentUser?.providerData?.some(p=>p.providerId==='password');if(teacher)b.clearRoom();else b?.destroy();ctx.backend=teacher?b:null;ctx.joining=false;ctx.homeTeacher=teacher;ctx.tab='game';ctx.privateView=false;ctx.projection=false;try{localStorage.removeItem('no15-room');}catch{}notify();if(teacher)return run(async()=>{ctx.savedRooms=await b.savedRooms();notify();});return;
  }
  if(act==='demo'){startDemo();return;}
  if(act==='demo-role'){ctx.role=ctx.role==='teacher'?'student':'teacher';ctx.privateView=false;ctx.tab='game';return notify();}
  if(act==='demo-fill')return run(()=>b.fill());
  if(act==='teacher-login'){
    showModal(`<h2 id="modal-title">教員ログイン</h2><p>教員共通のIDとパスワードを入力してください。</p><form id="teacher-login-form" class="stack space-top"><label for="teacher-id">教員ID<input id="teacher-id" name="teacherId" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}" placeholder="例：teacher" required aria-describedby="teacher-id-help"></label><p id="teacher-id-help" class="help-text">半角英数字・ハイフン・アンダースコア（3〜32文字）。</p><label for="teacher-password">パスワード<input id="teacher-password" type="password" name="password" autocomplete="current-password" required></label><p id="teacher-login-error" class="help-text" role="alert"></p><div class="modal-actions"><button type="button" class="btn ghost" data-act="modal-close">戻る</button><button type="submit" class="btn primary">ログイン</button></div></form>`);
    document.getElementById('teacher-id').focus();return;
  }
  if(act==='teacher-logout')return run(async()=>{await b.signOut();b.destroy();ctx.backend=null;ctx.homeTeacher=false;ctx.savedRooms={};ctx.joining=false;try{localStorage.removeItem('no15-room');}catch{}notify();});
  if(act==='open-room')return run(()=>openRoom(el.dataset.code));
  if(act==='recover-home'){
    ctx.recovering=true;showModal(`<h2 id="modal-title">別の端末から復帰する</h2><p>元のプレイヤーへ引き継ぐため、先生の本人確認が必要です。新規登録せず、復帰を申請してください。</p><form id="recover-form" class="stack space-top"><label>ルームコード<input name="code" maxlength="6" required value="${esc(ctx.draft.code)}"></label><label>元のニックネーム<input name="name" maxlength="24" required value="${esc(ctx.draft.name)}"></label><div class="modal-actions"><button type="button" class="btn ghost" data-act="modal-close">戻る</button><button type="submit" class="btn primary">復帰を申請する</button></div></form>`);return;
  }
  if(act==='tab'){ctx.tab=el.dataset.tab;ctx.privateView=false;return notify();}
  if(act==='rank-tab'){ctx.tab='ranking';return notify();}
  if(act==='scope-total'){ctx.rankScope='total';return notify();}
  if(act==='scope-round'){ctx.rankScope='roundTotal';return notify();}
  if(act==='card'){ctx.selected=Number(el.dataset.card);return notify();}
  if(act==='bet'){ctx.bet=!ctx.bet;return notify();}
  if(act==='submit')return run(async()=>{await b.submit(ctx.selected,ctx.bet);toast('提出が確定しました。発表をお待ちください。');});
  if(act==='projection'){ctx.projection=!ctx.projection;ctx.privateView=false;return notify();}
  if(act==='settings')return showModal(settingsHTML({...defaultConfig(),...s.config}));
  if(act==='start-match')return run(()=>b.startMatch());
  if(act==='close-match'){
    const missing=Object.keys(b.roster).length-(s.submittedCount??0);
    if(missing>0&&!await confirmAction('未提出者がいます',`未提出の${missing}人を0点として締め切ります。カードと勝負カードは消費しません。`,'締め切る'))return;
    return run(()=>b.closeMatch());
  }
  if(act==='extend'){
    if(await confirmAction('提出時間を延長しますか？','今から60秒間、提出を受け付けます。既に確定した提出は変更できません。','60秒受け付ける'))return run(()=>b.extendTime());return;
  }
  if(act==='cancel-match'){
    if(await confirmAction('この試合を取り消しますか？','提出されたカードは公開せず、得点にもカード使用にも反映しません。同じ試合番号で再開できます。','試合を取り消す',true))return run(()=>b.cancelMatch());return;
  }
  if(act==='begin-reveal')return run(()=>b.beginReveal());
  if(act==='reveal-next')return run(()=>b.reveal());
  if(act==='reveal-all')return run(()=>b.reveal(true));
  if(act==='finish'){
    if(await confirmAction('最終結果を発表しますか？','全ラウンドの合計得点で順位を確定し、非公開のランキングも全員に公開します。','最終結果を発表'))return run(()=>b.finish());return;
  }
  if(act==='csv')return exportCSV();
  if(act==='qr')return qrModal();
  if(act==='copy-url'){try{await navigator.clipboard.writeText(roomURL());toast('参加URLをコピーしました。');}catch{toast('コピーできませんでした。表示中の参加URLを選択してコピーしてください。',true);}return;}
  if(act==='show-result'){const h=s.history?.[`r${s.round}m${s.match}`];return showModal(`<h2 id="modal-title">R${s.round} · 第${s.match}試合の結果</h2><p>${EVENTS[h?.event]?.name??''}</p><div class="log-results space-top">${resultRows(h)}</div><div class="modal-actions"><button class="btn primary" data-act="modal-close">閉じる</button></div>`);}
  if(act==='private-view'){
    if(ctx.privateView){ctx.privateView=false;return notify();}
    if(await confirmAction('投影を止めてから開いてください','この管理表示では、非公開期間中の順位と得点も表示します。生徒に見えない状態で開いてください。','管理表示を開く')){ctx.privateView=true;ctx.projection=false;notify();}return;
  }
  if(act==='remove-player'){
    if(await confirmAction('参加登録を取り消しますか？',`${b.roster[el.dataset.id]?.name}さんを参加者から外します。この端末からは、このルームへ再登録できなくなります。`,'登録を取り消す',true))return run(()=>b.removePlayer(el.dataset.id));return;
  }
  if(act==='reset-request')return run(async()=>{await b.resetRequest(el.dataset.id);toast('申請をリセットしました。生徒は修正した名前で再申請できます。');});
  if(act==='recover-approve'){
    const uid=el.dataset.id;showModal(`<h2 id="modal-title">本人確認後にプレイヤーを復帰</h2><p>申請名：${esc(b.requests?.[uid]?.name)}<br>目の前の生徒本人と確認し、引き継ぐプレイヤーを選択してください。元の端末は提出できなくなります。</p><form id="recover-approve-form" class="stack space-top"><input type="hidden" name="uid" value="${esc(uid)}"><label>引き継ぐプレイヤー<select name="pid">${Object.entries(b.roster).map(([id,p])=>`<option value="${esc(id)}">${esc(p.name)}</option>`).join('')}</select></label><div class="modal-actions"><button type="button" class="btn ghost" data-act="modal-close">戻る</button><button type="submit" class="btn primary">本人確認済み・引き継ぐ</button></div></form>`);return;
  }
  if(act==='delete-room'){
    if(await confirmAction('ルームを完全に削除しますか？','履歴・得点・参加者を削除します。元に戻せません。必要なCSVを先に保存してください。','完全に削除する',true))return run(async()=>{await b.deleteRoom();ctx.backend=null;ctx.privateView=false;ctx.joining=false;try{localStorage.removeItem('no15-room');}catch{}notify();});return;
  }
}
document.addEventListener('click',e=>{const el=e.target.closest('[data-act]');if(!el||el.disabled)return;e.preventDefault();action(el.dataset.act,el).catch(err=>toast(message(err),true));});
document.addEventListener('input',e=>{const key=e.target.dataset.draft;if(key)ctx.draft[key]=e.target.value;});
document.addEventListener('change',e=>{if(e.target.dataset.select==='history-round'){ctx.historyRound=Number(e.target.value);notify();}if(e.target.dataset.select==='rank-round'){ctx.rankRound=Number(e.target.value);notify();}});
document.addEventListener('submit',e=>{
  const form=e.target,fd=new FormData(form);e.preventDefault();
  if(form.id==='teacher-login-form')return run(async()=>{
    const submit=form.querySelector('[type="submit"]'),error=form.querySelector('[role="alert"]');
    submit.disabled=true;submit.textContent='ログイン中…';error.textContent='';
    try{const backend=newFirebase();await backend.signTeacher(fd.get('teacherId'),fd.get('password'));ctx.savedRooms=await backend.savedRooms();ctx.homeTeacher=true;ctx.joining=false;form.reset();closeModal();notify();}
    catch(e){form.elements.password.value='';error.textContent=message(e);form.elements.password.focus();}
    finally{submit.disabled=false;submit.textContent='ログイン';}
  });
  if(form.id==='join-form')return run(async()=>{ctx.recovering=false;ctx.joinSent=false;ctx.draft={code:String(fd.get('code')).trim().toUpperCase(),name:String(fd.get('name'))};await openRoom(ctx.draft.code);if(ctx.backend.role!=='teacher'){await ctx.backend.join(ctx.draft.name);ctx.joinSent=true;}notify();});
  if(form.id==='room-join-form')return run(async()=>{await ctx.backend.join(fd.get('name'),ctx.recovering?'recover':'join');ctx.joinSent=true;notify();});
  if(form.id==='create-form')return run(async()=>{await ctx.backend.create(Number(fd.get('capacity')),fd.get('title'));ctx.joining=false;ctx.role='teacher';ctx.tab='game';notify();});
  if(form.id==='settings-form'){
    const c={battle:fd.has('battle'),events:fd.has('events'),eventMode:fd.get('eventMode'),eventCount:Number(fd.get('eventCount')),eventMatches:fd.getAll('eventMatches').map(Number),eventTypes:Object.fromEntries(Array.from({length:12},(_,i)=>[i+1,fd.get(`event-${i+1}`)])),hiddenAll:fd.has('hiddenAll'),hiddenMatches:fd.getAll('hiddenMatches').map(Number),seconds:Number(fd.get('seconds')),finalRound:fd.has('finalRound')};
    return run(async()=>{validateConfig(c);await ctx.backend.beginRound(c);closeModal();ctx.tab='game';ctx.rankScope='total';ctx.privateView=false;notify();});
  }
  if(form.id==='recover-form')return run(async()=>{ctx.draft={code:String(fd.get('code')).trim().toUpperCase(),name:String(fd.get('name'))};ctx.recovering=true;ctx.joinSent=false;await openRoom(ctx.draft.code);await ctx.backend.join(ctx.draft.name,'recover');ctx.joinSent=true;closeModal();notify();});
  if(form.id==='recover-approve-form')return run(async()=>{await ctx.backend.recover(fd.get('uid'),fd.get('pid'));closeModal();toast('元の得点とカード履歴を引き継ぎました。');});
});
async function boot(){render();if(document.body.dataset.preview==='true'||new URLSearchParams(location.search).has('demo')){startDemo();return;}const join=location.hash.match(/join=([A-Z2-9]{6})/i);if(join){ctx.draft.code=join[1].toUpperCase();return run(()=>openRoom(ctx.draft.code));}let code;try{code=localStorage.getItem('no15-room');}catch{}if(code)return run(()=>openRoom(code));}
boot();
