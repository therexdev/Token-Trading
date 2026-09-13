const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
async function load(file) {
 const source = fs.readFileSync(require('node:path').join(__dirname, '../src', file), 'utf8').replaceAll('import.meta.env', '({})');
 const output = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 return import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));
}
test('market initialization preserves launchpad, detail, create, and locks URLs', async () => {
 const { writeMarketHash } = await load('lib/marketLink.ts');
 const market = {base:{address:'base'},quote:{address:'quote'}};
 const writes=[];global.history={replaceState:(_s,_t,url)=>writes.push(url)};
 for(const hash of ['#/launchpads','#/launchpad/1','#/launchpad/create','#/locks']) {
  global.window={location:{hash,pathname:'/',search:''}};
  writeMarketHash(market);
 }
 assert.deepEqual(writes,[]);
 global.window.location.hash='#/';writeMarketHash(market);
 assert.deepEqual(writes,['/#/market/base_quote']);
});
test('Vault sends operations through the approval relay and returns approved transaction ID', async () => {
 const { BioWalletSigner }=await load('lib/bioWallet.ts');
 const calls=[];const originalFetch=global.fetch,originalTimer=global.setTimeout;
 global.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>options?.method==='POST'?{ok:true,requestId:'request'}:{ok:true,status:'approved',txid:'approved-id'}}};
 global.setTimeout=(callback)=>{queueMicrotask(callback);return 0};
 try {
  const signer=new BioWalletSigner({sessionId:'session',secret:'secret',address:'owner'});
  const operations=[{call_contract:{contract_id:'launchpad',entry_point:1,args:'AA'}}];
  const result=await signer.sendTransaction({operations});
  assert.equal(result.transaction.id,'approved-id');
  assert.deepEqual(JSON.parse(calls[0].options.body).operations,operations);
  assert.match(calls[0].url,/\/api\/dapp\/request$/);
  assert.match(calls[1].url,/\/api\/dapp\/request-status\?/);
  await assert.rejects(()=>signer.signMessage('message'),/requires Google or Kondor/);
 } finally {global.fetch=originalFetch;global.setTimeout=originalTimer}
});
