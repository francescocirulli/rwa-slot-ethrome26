import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHardware} from '../lib/hardware';
const origin = 'https://slot.example', token = 'test-only-hardware-token-32-characters';
function fixture() {
  let now = 100000, seq = 0, cookie = '';
  const hardware = createHardware({origin, token, now: () => now});
  async function call(path: string, body: unknown, headers: Record<string,string> = {}) {
    const res = await hardware.handle(new Request(origin + '/api/hardware/' + path, {method:'POST', headers:{'Content-Type':'application/json',Origin:origin,'X-Slot-Request':'1', Cookie:cookie,...headers},body:JSON.stringify(body)}));
    return {status:res.status, body:await res.json(), cookie:res.headers.get('set-cookie')};
  }
  const device = (events: unknown[] = [], override = {}) => call('device', {deviceId:'a'.repeat(32),seq:++seq,online:true,events,...override},{Authorization:'Bearer '+token});
  const tablet = (gate = '', cmd = 'ready') => call('tablet',{gate,command:{cmd}});
  return {call,device,tablet,advance:(ms:number)=>now+=ms, pair:async()=>{const d=await device(); const p=await call('pair',{code:d.body.code});cookie=p.cookie!.split(';')[0];assert.match(p.cookie!, /HttpOnly; SameSite=Strict; Secure/);}};
}
test('hardware requires device secret, same origin and physical pairing; code is single use',async()=>{
  const f=fixture(); assert.equal((await f.call('device',{})).status,401);
  assert.equal((await f.tablet()).status,401);
  const d=await f.device(); assert.equal((await f.call('pair',{code:d.body.code},{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.call('pair',{code:d.body.code})).status,200);
  assert.equal((await f.call('pair',{code:d.body.code})).status,403);
});
test('lever is consumed once per readiness gate; motion cannot arm a spin; stale and busy pulls discarded',async()=>{
  const f=fixture();await f.pair();await f.tablet('turn-1');
  await f.device([{evt:'lever',gate:'turn-1'},{evt:'lever',gate:'turn-1'}]);
  assert.deepEqual((await f.tablet('turn-1')).body.events,[{evt:'lever',gate:'turn-1'}]);
  await f.device([{evt:'lever',gate:'turn-1'}]); assert.deepEqual((await f.tablet('turn-1')).body.events,[]);
  await f.tablet('','spin');await f.device([{evt:'lever',gate:'turn-1'},{evt:'motion'}]);
  assert.deepEqual((await f.tablet('','spin')).body.events,[{evt:'motion'}]);
  await f.tablet('turn-2');await f.device([{evt:'lever',gate:'turn-1'}]);assert.deepEqual((await f.tablet('turn-2')).body.events,[]);
  await f.device([{evt:'lever',gate:'turn-2'}]);f.advance(1100);assert.deepEqual((await f.tablet('turn-2')).body.events,[]);
});
test('hidden/disconnected tablet cannot accumulate pulls or leave spin lights active',async()=>{
  const f=fixture();await f.pair();await f.tablet('turn-1','spin');f.advance(2100);
  const d=await f.device([{evt:'lever',gate:'turn-1'}]);assert.deepEqual(d.body.command,{cmd:'idle'});assert.equal(d.body.gate,'');
  assert.deepEqual((await f.tablet('turn-2')).body.events,[]);
  f.advance(3100);assert.equal((await f.tablet()).body.online,false);
});
test('replayed device sequence, concurrent device, malformed payload and guessing are rejected',async()=>{
  const f=fixture();await f.pair();await f.tablet('turn-1');
  await f.device([],{seq:99});await f.device([{evt:'lever',gate:'turn-1'}],{seq:98});assert.deepEqual((await f.tablet('turn-1')).body.events,[]);
  assert.equal((await f.device([],{deviceId:'b'.repeat(32)})).status,409);
  assert.equal((await f.call('tablet',{gate:'x',command:{cmd:'result',tier:9,hub:false}})).status,400);
  assert.equal((await f.call('tablet',{gate:'x',command:{cmd:'lcd',l1:'bad'}})).status,400);
  for(let i=0;i<10;i++)await f.call('pair',{code:'00000000'});
  assert.equal((await f.call('pair',{code:'00000000'})).status,429);
});
