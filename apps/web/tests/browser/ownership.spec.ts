import {test,expect,type Page} from '@playwright/test';
const shared='0x0000000000000000000000000000000000000011',backend='0x0000000000000000000000000000000000000022',collection='0x0000000000000000000000000000000000000033',zero='0x0000000000000000000000000000000000000000';
async function fixture(page:Page,unavailable=false){
  let owner:string|null=unavailable?null:shared,pendingOwner=zero,operation:any,seq=0;
  const sends:{action:string;privy:boolean}[]=[];
  await page.route('**/api/contract?*',route=>route.fulfill({json:{configured:true,address:collection,block:'100',gasMode:'usdc',settings:{paused:false,ticketPrice:'1000000',activeRoundCount:'0',nextGameId:'1',configuredPrizeCount:0,totalOutcomeWeight:1000,noWinWeight:0},catalog:[],inventory:[],funding:null,permissions:{owner:shared,isOwner:true,manager:true,treasurer:true,pauser:true},pendingOwner:null,collection:{address:collection,owner,pendingOwner},keeper:{configured:true,address:backend,balanceWei:'1000000000000000',pendingTransaction:null,canStartFreeSpin:true,error:''}}}));
  await page.route('**/api/admin/contract/*',async route=>{
    const path=new URL(route.request().url()).pathname.split('/').pop();
    const body=route.request().method()==='POST'?route.request().postDataJSON():{};
    if(path==='prepare'){operation={id:(++seq).toString(16).padStart(64,'0'),address:shared,action:body.action,args:body.args,signer:body.action==='acceptPrizeOwnershipBackend'?'backend':'privy',signerAddress:body.action==='acceptPrizeOwnershipBackend'?backend:shared,expiresAt:Date.now()+300000,transaction:{to:collection,data:'0x',chainId:8453,gasMode:body.action==='acceptPrizeOwnershipBackend'?'eth':'usdc'}};}
    if(path==='send'){sends.push({action:operation.action,privy:route.request().headers()['x-fixture-privy']==='1'});if(operation.signer==='backend'){owner=backend;pendingOwner=zero;}else pendingOwner=backend;}
    await route.fulfill({json:{...operation,stage:path==='status'?'confirmed':'prepared'}});
  });
  return sends;
}
test('collection transfer and backend acceptance show separate signers and use the matching send path',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const sends=await fixture(page);await page.goto('/ownership-fixture');await page.getByRole('button',{name:'Operations',exact:false}).click();
  await page.getByLabel('What do you want to do?').selectOption('transferPrizeOwnership');
  await expect(page.getByLabel('Prize collection',{exact:true})).toHaveValue(collection);
  await page.getByRole('button',{name:'Transfer to backend admin wallet'}).click();
  await expect(page.getByLabel('New collection owner on Base')).toHaveValue(backend);
  await page.getByRole('button',{name:'Simulate and confirm with Privy'}).click();
  let dialog=page.getByRole('dialog');await expect(dialog).toContainText('new owner must separately');expect(sends).toHaveLength(0);
  await dialog.getByRole('button',{name:'Confirm from my wallet'}).click();
  await page.getByRole('button',{name:'Accept with backend admin wallet'}).click();
  await expect(page.getByRole('button',{name:'Simulate and confirm backend transaction'})).toBeEnabled();
  await page.getByRole('button',{name:'Simulate and confirm backend transaction'}).click();
  dialog=page.getByRole('dialog');await expect(dialog).toContainText('BACKEND ADMIN WALLET');await expect(dialog).toContainText(backend);await expect(dialog).toContainText('Gas is paid in ETH by that wallet');expect(sends).toHaveLength(1);
  await dialog.getByRole('button',{name:'Confirm backend transaction'}).click();
  await expect(page.getByRole('button',{name:'Simulate and confirm backend transaction'})).toBeDisabled();
  expect(sends).toEqual([{action:'transferPrizeOwnership',privy:true},{action:'acceptPrizeOwnershipBackend',privy:false}]);
  await page.getByLabel('What do you want to do?').selectOption('transferPrizeOwnership');
  await expect(page.getByRole('button',{name:'Simulate and confirm with Privy'})).toBeDisabled();expect(errors).toEqual([]);
});
test('unknown collection ownership blocks a nomination and collaborators cannot select ownership actions',async({page})=>{
  await fixture(page,true);await page.goto('/ownership-fixture');await page.getByRole('button',{name:'Operations',exact:false}).click();
  await page.getByLabel('What do you want to do?').selectOption('transferPrizeOwnership');
  await expect(page.getByRole('button',{name:'Simulate and confirm with Privy'})).toBeDisabled();
  await page.goto('/ownership-fixture?operator');await page.getByRole('button',{name:'Operations',exact:false}).click();
  for(const value of ['transferPrizeOwnership','acceptPrizeOwnership','acceptPrizeOwnershipBackend'])await expect(page.locator('option[value="'+value+'"]')).toHaveCount(0);
});
