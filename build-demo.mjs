// Run: node build-demo.mjs
// Rebuilds the offline demo from the SAME application source files.
import {readFile,writeFile} from 'node:fs/promises';
const read=name=>readFile(new URL(name,import.meta.url),'utf8');
let script='';
for(const name of ['core.js','config.js','backend.js','view.js','app.js']){
  script+=(await read(name)).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'')+'\n';
}
const css=await read('styles.css'),qr=await read('vendor/qrcode.js');
script=script.replace(/<\/script/gi,'<\\/script');
const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><title>NO.15 | 操作できる体験版</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><style>${css}</style></head><body data-preview="true"><div id="app"></div><div id="toast" role="status" aria-live="polite"></div><dialog id="modal" aria-labelledby="modal-title"><div id="modal-body"></div></dialog><script>${qr.replace(/<\/script/gi,'<\\/script')}</script><script>${script}</script></body></html>`;
await writeFile(new URL('demo.html',import.meta.url),html);
console.log('demo.html generated from the application source.');
