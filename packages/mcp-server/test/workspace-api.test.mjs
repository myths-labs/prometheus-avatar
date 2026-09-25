import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {workspaceApi} from '../.test-workspace/workspace-api.js';
const controller=()=>new AbortController().signal;
const accountId=randomUUID(),operationId=randomUUID();
const input={entryId:randomUUID(),expectedRevision:0,categoryId:'work',kind:'message',content:'Original work',occurredAt:'2026-09-17T08:00:00.000Z',role:'assistant',inputMode:'agent',status:null,dueOn:null,archived:false};
const {entryId,expectedRevision,...fields}=input;
const receipt={accountId,operationId,entry:{id:entryId,sequence:'1',revision:1,...fields,createdAt:'2026-09-17T08:00:01Z',updatedAt:'2026-09-17T08:00:01Z'}};
async function run(reply,work){
  const calls=[];const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const b of req)chunks.push(b);const body=Buffer.concat(chunks).toString();calls.push({url:req.url,method:req.method,body,account:req.headers['x-workspace-account']});
    const response=await reply(req,calls);if(response.disconnect){res.destroy();return;}
    res.writeHead(response.status??200,{'content-type':'application/json',...response.headers});res.end(response.raw??JSON.stringify(response.value));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await work(workspaceApi('http://127.0.0.1:'+server.address().port,'pak_test_owned','test'),calls,server.address().port);}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('same original receipt skips POST while changed content cannot adopt its success',async()=>{
  await run(()=>({value:{accountId,operation:receipt}}),async(api,calls)=>{
    assert.deepEqual(await api.save(accountId,operationId,input,controller()),receipt);assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');
    await assert.rejects(api.save(accountId,operationId,{...input,content:'Changed'},controller()),/workspace_intent_conflict/);assert.equal(calls.some(v=>v.method==='POST'),false);
  });
});
test('original null read leads to exactly one original body and scope; uncertain write is not retried',async()=>{
  await run(req=>req.method==='GET'?{value:{accountId,operation:null}}:{disconnect:true},async(api,calls)=>{
    await assert.rejects(api.save(accountId,operationId,input,controller()),/workspace_result_unconfirmed/);
    assert.equal(calls.length,2);assert.equal(calls[1].account,accountId);assert.deepEqual(JSON.parse(calls[1].body),{operationId,entry:input});
  });
});
test('foreign scope, original ID, changed body and malformed JSON never become receipts',async()=>{
  for(const value of [{accountId:randomUUID(),operation:receipt},{accountId,operation:{...receipt,operationId:randomUUID()}},{accountId,operation:{...receipt,entry:{...receipt.entry,content:'Changed'}}}]){
    await run(()=>({value}),async(api,calls)=>{await assert.rejects(api.save(accountId,operationId,input,controller()),/workspace_(response_invalid|intent_conflict)/);assert.equal(calls.some(v=>v.method==='POST'),false);});
  }
  await run(()=>({raw:'{broken'}),async api=>{await assert.rejects(api.receipt(accountId,operationId,controller()),/workspace_result_unconfirmed/);});
});
test('HTTP rejection is sanitized, response bytes are bounded and redirects are never followed',async()=>{
  for(const response of [{status:401,raw:'private supplier credential'},{raw:'x'.repeat(2*1024*1024+1)},{status:302,headers:{location:'http://127.0.0.1:9/leak'},raw:''},{headers:{'content-type':'text/html'},raw:'private HTML'}]){
    await run(()=>response,async(api,calls)=>{
      await assert.rejects(api.receipt(accountId,operationId,controller()),error=>{assert.doesNotMatch(error.message,/private|credential|pak_/);return /^workspace_/.test(error.message);});
      assert.equal(calls.length,1);
    });
  }
});
test('invalid URLs, missing keys, invalid UTF-8 content bounds, forbidden speech and cancellation cannot mutate',async()=>{
  for(const url of ['http://external.invalid','https://user:secret@example.invalid','https://example.invalid/path','https://example.invalid/?key=secret'])assert.throws(()=>workspaceApi(url,'pak_fixture','test'),/workspace_invalid_api_url/);
  await run(()=>({value:{accountId,operation:null}}),async(api,calls,port)=>{
    for(const entry of [{...input,content:'字'.repeat(22000)},{...input,inputMode:'manual'},{...input,role:'user'}])await assert.rejects(api.save(accountId,operationId,entry,controller()),/workspace_invalid_agent_entry/);
    const c=new AbortController();c.abort();await assert.rejects(api.receipt(accountId,operationId,c.signal),/workspace_cancelled/);
    await assert.rejects(workspaceApi('http://127.0.0.1:'+port,'','test').receipt(accountId,operationId,controller()),/workspace_agent_key_required/);
    assert.equal(calls.length,0);
  });
});
test('canonical paged reads reject chat, another account, widened results and invalid cursors',async()=>{
  const snapshot={accountId,categories:[{id:'work',title:'Work',presentation:'markdown'}],entries:[receipt.entry],nextCursor:'1'};
  await run(()=>({value:snapshot}),async(api,calls)=>{
    assert.deepEqual(await api.read({accountId,category:'work',cursor:'2',limit:1},controller()),snapshot);
    assert.match(calls[0].url,/cursor=2/);await assert.rejects(api.read({category:'work',limit:6},controller()),/workspace_invalid_filter/);
    await assert.rejects(api.read({category:'work',cursor:'9223372036854775808'},controller()),/workspace_invalid_filter/);assert.equal(calls.length,1);
  });
  for(const value of [{...snapshot,accountId:randomUUID()},{...snapshot,categories:[...snapshot.categories,{id:'chat',title:'Chat',presentation:'chat'}]},
    {...snapshot,entries:[{...receipt.entry,categoryId:'other'}]}, {...snapshot,nextCursor:'2'}]){
    await run(()=>({value}),async api=>{await assert.rejects(api.read({accountId,category:'work',limit:1},controller()),/workspace_response_invalid/);});
  }
});
