import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const {slotDemoModel:model}=createRequire(import.meta.url)('../public/terminal/demo-model.js');
const weights=[[94,62],[73,48],[48,32],[45,30],[38,26],[38,26],[38,26],[30,20],[0,100],[0,67],[0,45],[0,13],[0,20],[0,21],[0,50]];
const lines=[[5,6,7,8,9],[0,1,7,13,14],[10,11,7,3,4]];
function rng(seed:number){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}

test('all 1000 rolls reproduce the configured weights and 40.4/58.6/1.0 totals',()=>{
  const counts=new Map<string,number>(), totals=[0,0,0];
  for(let roll=0;roll<1000;roll++){const o=model.outcomeForRoll(roll),key=`${o.symbol}-${o.match}`;counts.set(key,(counts.get(key)||0)+1);totals[o.match===3?0:o.match===5?1:2]++;}
  assert.deepEqual(totals,[404,586,10]);assert.equal(counts.get('255-0'),10);
  weights.forEach(([three,five],symbol)=>{assert.equal(counts.get(`${symbol}-3`)||0,three);assert.equal(counts.get(`${symbol}-5`)||0,five);});
  // Keep the offline fixture aligned with the reviewed onchain configuration source.
  const source=readFileSync('../../contracts/script/ConfigureBasePaytable.s.sol','utf8');
  const configured=[...source.matchAll(/slot\.configurePrize\((\d+),[^\n]+, (\d+), (\d+)\);/g)];
  assert.equal(configured.length,15);
  for(const entry of configured)assert.deepEqual(weights[Number(entry[1])],[Number(entry[2]),Number(entry[3])]);
});

test('every outcome on every payline has unique columns and exactly its one winning line',()=>{
  for(let roll=0;roll<1000;roll++)for(let line=0;line<3;line++){
    const o=model.outcomeForRoll(roll),grid=model.buildGrid(o,o.match?line:255,rng(roll*3+line));
    assert.equal(grid.length,15);assert.ok(grid.every((s:number)=>Number.isInteger(s)&&s>=0&&s<15));
    for(let c=0;c<5;c++)assert.equal(new Set([grid[c],grid[c+5],grid[c+10]]).size,3);
    const wins=lines.flatMap((cells,index)=>{
      if(grid[cells[0]]!==grid[cells[1]]||grid[cells[0]]!==grid[cells[2]])return [];
      const match=grid[cells[3]]===grid[cells[0]]&&grid[cells[4]]===grid[cells[0]]?5:3;
      return [{symbol:grid[cells[0]],line:index,match}];
    });
    assert.deepEqual(wins,o.match?[{symbol:o.symbol,line,match:o.match}]:[]);
    if(o.match===3)for(const c of [3,4])assert.notEqual(grid[lines[line][c]],o.symbol);
  }
});

test('forced outcomes reject impossible prizes and pay exactly the configured reward',()=>{
  for(const bad of ['four','jackpot','8-3','9-3','10-3','11-3','12-3','13-3','14-3','15-5','0-4'])assert.throws(()=>model.draw(bad));
  assert.equal(model.draw('loss').payout,null);
  for(let symbol=0;symbol<15;symbol++)for(const match of [3,5]){
    if(!weights[symbol][match===3?0:1])continue;
    const g=model.draw(`${symbol}-${match}`,rng(symbol+match)),p=g.payout;
    assert.equal(g.winningSymbol,symbol);assert.equal(g.matchCount,match);
    if(symbol===1){assert.equal(p.kind,3);assert.equal(p.amount,'1');assert.equal(p.formattedAmount,'1');}
    else if([0,3,8,9,10,12,13,14].includes(symbol)){assert.equal(p.kind,2);assert.equal(p.amount,'1');assert.equal(p.tokenId,({0:'5',3:'1',8:'2',9:'3',10:'4',12:'6',13:'7',14:'8'} as Record<number,string>)[symbol]);}
    else {assert.equal(p.kind,1);assert.equal(p.formattedAmount,match===3?'0.0005':'0.001');assert.equal(p.decimals,symbol===11?18:8);assert.equal(p.amount,symbol===11?'1000000000000000':match===3?'50000':'100000');}
  }
  assert.equal(model.draw('11-5').payout.token.toLowerCase(),'0xe908475f8beb7a138b0dc6eb5a05cb27068ffb9a');
});

test('random mode draws one outcome and an independent uniform line',()=>{
  for(const value of [0,0.34,0.99]){const samples=[0.999,value];const g=model.draw('random',()=>samples.length?samples.shift():0.5);assert.equal(g.winningSymbol,14);assert.equal(g.matchCount,5);assert.equal(g.winningLine,Math.floor(value*3));}
});
