import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {webcrypto} from 'node:crypto';

const load=async name=>readFile(new URL('../'+name,import.meta.url),'utf8');
async function fixture(){
  let js='';for(const name of ['core.js','config.js','backend.js','view.js','app.js'])js+=(await load(name)).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'')+'\n';
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(`<!doctype html><html><head><style>${await load('styles.css')}</style></head><body data-preview="true"><div id="app"></div><div id="toast"></div><dialog id="modal"><div id="modal-body"></div></dialog><script>${js.replace(/<\/script/gi,'<\\/script')}</script></body></html>`,{url:'https://example.test/no15/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.crypto.randomUUID=()=>webcrypto.randomUUID();w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};}});
  const doc=dom.window.document;
  const wait=async predicate=>{const end=Date.now()+4000;while(!predicate()){if(Date.now()>end)throw Error('UI condition timed out: '+doc.body.textContent.slice(-1000));await new Promise(r=>setTimeout(r,10));}};
  const click=async act=>{await wait(()=>doc.querySelector(`[data-act="${act}"]`)&&!doc.querySelector(`[data-act="${act}"]`).disabled);doc.querySelector(`[data-act="${act}"]`).click();await new Promise(r=>setTimeout(r,25));};
  await wait(()=>doc.querySelector('[data-act="settings"]'));
  return {dom,doc,errors,wait,click};
}
test('実際の画面操作：16人参加→2ラウンド24試合→非公開→最終表彰',async()=>{
  const f=await fixture(),{doc,click,wait}=f;
  try{
    assert.equal(doc.querySelectorAll('.player-chip').length,16);
    for(let round=1;round<=2;round++){
      await click('settings');const form=doc.getElementById('settings-form');form.elements.seconds.value='0';form.elements.hiddenAll.checked=true;form.elements.finalRound.checked=round===2;
      form.dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>doc.querySelector('[data-act="start-match"]'));
      if(round===2)assert.ok(doc.body.textContent.includes('このラウンドが最終ラウンド'));
      for(let match=1;match<=12;match++){
        await click('start-match');await click('demo-role');await wait(()=>doc.querySelectorAll('.number-card').length===15);
        assert.equal(doc.querySelectorAll('.number-card.used').length,match-1);
        const available=doc.querySelector('.number-card:not(:disabled)');available.click();await new Promise(r=>setTimeout(r,25));
        if(match===1)await click('bet');
        await click('submit');await wait(()=>doc.body.textContent.includes('提出完了'));
        await click('demo-role');await click('close-match');await click('begin-reveal');
        if(round===1&&match===1){
          let steps=0;while(doc.querySelector('[data-act="reveal-next"]')?.textContent.includes('次の数字')){await click('reveal-next');if(++steps>15)throw Error('too many groups');}
          assert.ok(doc.querySelector('.reveal-number'));assert.ok(doc.querySelector('[data-act="reveal-next"]').textContent.includes('順位へ'));await click('reveal-next');
        }else await click('reveal-all');
        await wait(()=>doc.querySelector('[data-act="show-result"]'));
        assert.ok(doc.body.textContent.includes('ランキングは非公開'));assert.equal(doc.querySelector('[data-ranking]'),null);
        if(match===12)assert.ok(doc.body.textContent.includes('12試合、おつかれさま'));
      }
    }
    await click('finish');await click('confirm-yes');await wait(()=>doc.querySelector('.podium'));
    assert.ok(doc.getElementById('app').textContent.includes('2ラウンド・24試合'));assert.equal(doc.querySelectorAll('.rank-row').length,16);assert.ok(!doc.getElementById('app').textContent.includes('ランキングは非公開'));
    assert.deepEqual(f.errors,[]);
  }finally{f.dom.window.close();}
});
