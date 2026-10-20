/* NO.15 — deterministic game rules. No browser/Firebase dependency. */
export const VERSION = '1.0.0';
export const CARDS = Object.freeze(Array.from({length:15}, (_,i)=>i+1));
export const MATCHES = 12;
export const EVENTS = Object.freeze({
  none:{name:'通常試合',short:'NORMAL',description:'数字 ÷ 被った人数（小数点以下切り捨て）'},
  double:{name:'ダブルスコア',short:'DOUBLE',description:'通常点が2倍になる'},
  low:{name:'ローナンバーボーナス',short:'LOW 1–7',description:'1〜7を出すと通常点が2倍になる'},
  even:{name:'偶数ボーナス',short:'EVEN +3',description:'偶数カードの通常点に3点を加える'}
});
export const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
export function nickname(value){
  const name=String(value??'').normalize('NFKC').replace(/\s+/gu,' ').trim();
  if(!name || [...name].length>12 || /[\u0000-\u001f\u007f]/u.test(name)) throw Error('ニックネームは1〜12文字で入力してください。');
  return {name,key:name.toLocaleLowerCase('ja-JP')};
}
export function defaultConfig(){
  return {practice:false,battle:true,events:true,eventMode:'manual',eventCount:3,eventMatches:[4,8,12],eventTypes:{4:'double',8:'low',12:'even'},hiddenAll:false,hiddenMatches:[],seconds:60,finalRound:false};
}
export function validateConfig(c){
  const cfg={...defaultConfig(),...clone(c)};
  if(typeof cfg.practice!=='boolean'||typeof cfg.battle!=='boolean'||typeof cfg.events!=='boolean'||typeof cfg.finalRound!=='boolean'||typeof cfg.hiddenAll!=='boolean')throw Error('設定値が正しくありません。');
  if(!['manual','random'].includes(cfg.eventMode))throw Error('イベントの設定方法が正しくありません。');
  if(!Number.isInteger(cfg.seconds)||cfg.seconds<0||cfg.seconds>600)throw Error('制限時間は0〜600秒で指定してください。0は時間無制限です。');
  if(!Number.isInteger(cfg.eventCount)||cfg.eventCount<0||cfg.eventCount>12)throw Error('イベント回数は0〜12回で指定してください。');
  for(const key of ['eventMatches','hiddenMatches']){
    if(!Array.isArray(cfg[key])||cfg[key].some(n=>!Number.isInteger(n)||n<1||n>12))throw Error('試合番号は1〜12で指定してください。');
    cfg[key]=[...new Set(cfg[key])].sort((a,b)=>a-b);
  }
  for(const n of cfg.eventMatches)if(!['double','low','even'].includes(cfg.eventTypes?.[n]))throw Error('イベントの種類を選択してください。');
  return cfg;
}
export function makeEventPlan(config,random=Math.random){
  const c=validateConfig(config),plan={};
  for(let i=1;i<=12;i++)plan[i]='none';
  if(!c.events)return plan;
  if(c.eventMode==='manual'){for(const n of c.eventMatches)plan[n]=c.eventTypes[n];}
  else{
    const order=Array.from({length:12},(_,i)=>i+1);
    for(let i=11;i>0;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
    for(const n of order.slice(0,c.eventCount))plan[n]=['double','low','even'][Math.floor(random()*3)];
  }
  return plan;
}
export function isHidden(state){return state?.phase!=='finished' && !!state?.hidden;}
export function ranking(roster,progress,scope='total'){
  const rows=Object.entries(roster??{}).map(([id,p])=>({id,name:p.name,score:Number(progress?.[id]?.[scope]??0),joinedAt:p.joinedAt??0}));
  rows.sort((a,b)=>b.score-a.score || a.joinedAt-b.joinedAt || a.id.localeCompare(b.id));
  return rows.map((p,i,all)=>({...p,rank:i>0&&p.score===all[i-1].score?all.slice(0,i).findIndex(x=>x.score===p.score)+1:i+1}));
}
export function eventScore(base,card,event){
  if(!Object.hasOwn(EVENTS,event))throw Error('未対応のイベントです。');
  if(event==='double'||event==='low'&&card<=7)return base*2;
  if(event==='even'&&card%2===0)return base+3;
  return base;
}
export function scoreMatch(roster,progress,submissions,event='none',battleEnabled=true){
  if(!Object.hasOwn(EVENTS,event))throw Error('未対応のイベントです。');
  const count={};
  for(const [pid,s] of Object.entries(submissions??{})){
    if(!roster?.[pid])throw Error('参加者以外の提出が含まれています。');
    if(!Number.isInteger(s.card)||s.card<1||s.card>15||typeof s.bet!=='boolean')throw Error('提出内容が正しくありません。');
    if(progress?.[pid]?.used?.[s.card])throw Error('使用済みカードは再使用できません。');
    if(s.bet&&(!battleEnabled||progress?.[pid]?.betUsed))throw Error('勝負カードは使用できません。');
    count[s.card]=(count[s.card]??0)+1;
  }
  const results={};
  for(const [id,p] of Object.entries(roster??{})){
    const s=submissions?.[id];
    if(!s){results[id]={id,name:p.name,card:0,bet:false,count:0,base:0,eventPoints:0,score:0,success:false,missed:true};continue;}
    const base=Math.floor(s.card/count[s.card]);
    const eventPoints=eventScore(base,s.card,event);
    const success=s.bet&&count[s.card]===1;
    const score=s.bet?(success?eventPoints*2:0):eventPoints;
    results[id]={id,name:p.name,card:s.card,bet:s.bet,count:count[s.card],base,eventPoints,score,success,missed:false};
  }
  const groups=Object.keys(count).map(Number).sort((a,b)=>a-b).map(card=>({card,count:count[card],players:Object.values(results).filter(p=>p.card===card)}));
  return {results,groups,count,missed:Object.values(results).filter(p=>p.missed)};
}
export function freshProgress(roster,old={}){
  return Object.fromEntries(Object.keys(roster??{}).map(id=>[id,{total:Number(old?.[id]?.total??0),roundTotal:0,used:{},betUsed:false}]));
}
export function createRound(state,roster,config,plan){
  if(!['lobby','roundEnd'].includes(state.phase))throw Error('ラウンドの開始前だけ設定できます。');
  if(Object.keys(roster??{}).length<2)throw Error('開始には2人以上必要です。');
  if(state.practice)throw Error('練習を終了してから本番を設定してください。');
  if(config.practice&&state.phase!=='lobby')throw Error('練習は本番開始前だけ設定できます。');
  const cfg=validateConfig(config),round=Number(state.round??0)+1;
  if(cfg.practice)cfg.finalRound=false;
  return {...state,practice:!!cfg.practice,phase:'ready',round,match:0,completed:0,config:cfg,plan:plan??makeEventPlan(cfg),hidden:cfg.hiddenAll||cfg.hiddenMatches.includes(1),progress:freshProgress(roster,state.progress),revealed:[],submittedCount:0,deadline:0,matchKey:'',event:'none',revision:(state.revision??0)+1};
}
export function applyResult(state,roster,scored,now){
  if(!['locked','reveal'].includes(state.phase))throw Error('この試合は確定できません。');
  const history=clone(state.history??{}),key=`r${state.round}m${state.match}`;
  if(history[key])throw Error('確定済みの試合です。');
  const progress=clone(state.progress??{});
  for(const [id,r] of Object.entries(scored.results)){
    const p=progress[id]??{total:0,roundTotal:0,used:{},betUsed:false};
    p.total+=r.score;p.roundTotal+=r.score;p.used??={};
    if(!r.missed){p.used[r.card]=true;if(r.bet)p.betUsed=true;}
    progress[id]=p;
  }
  history[key]={round:state.round,match:state.match,event:state.event,hidden:!!state.hidden,matchKey:state.matchKey,endedAt:now,results:scored.results,beforeRanks:ranking(roster,state.progress)};
  return {...state,phase:state.match===12?'roundEnd':'result',completed:state.match,progress,history,revealed:scored.groups??[],missed:scored.missed??[],revision:(state.revision??0)+1};
}
export function cardStats(roster,progress){
  const size=Object.keys(roster??{}).length;
  return CARDS.map(card=>{const used=Object.keys(roster??{}).filter(id=>progress?.[id]?.used?.[card]).length;return {card,used,available:size-used};});
}
export function csvText(state,roster){
  const head=['round','match','event','ranking_hidden','player_id','nickname','card','multiplicity','normal_points','event_points','battle_used','battle_success','missed','points','round_total','total','ended_at_utc'];
  const totals={},roundTotals={},rows=[head];
  const history=Object.values(state.history??{}).sort((a,b)=>a.round-b.round||a.match-b.match);
  for(const h of history)for(const [id,r] of Object.entries(h.results)){
    const rk=`${h.round}:${id}`;totals[id]=(totals[id]??0)+r.score;roundTotals[rk]=(roundTotals[rk]??0)+r.score;
    // Leading formula markers are neutralized even when the CSV is opened in a spreadsheet.
    let name=String(roster?.[id]?.name??r.name);if(/^[=+\-@\t\r]/u.test(name))name="'"+name;
    rows.push([h.round,h.match,h.event,h.hidden,id,name,r.card||'',r.count,r.base,r.eventPoints,r.bet,r.success,r.missed,r.score,roundTotals[rk],totals[id],new Date(h.endedAt).toISOString()]);
  }
  return '\ufeff'+rows.map(row=>row.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';
}

export function endPractice(state,roster){
  if(!state.practice)throw Error('練習ラウンドではありません。');
  return {phase:'lobby',practice:false,round:0,match:0,completed:0,revision:(state.revision??0)+1,hidden:false,config:{...state.config,practice:false,finalRound:false},progress:freshProgress(roster),history:{},revealed:[],missed:[],submittedCount:0,deadline:0,matchKey:'',event:'none',plan:{}};
}
