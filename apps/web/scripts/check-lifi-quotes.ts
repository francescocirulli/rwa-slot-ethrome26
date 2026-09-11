// Read-only mainnet quotes. The dummy address is never funded or used to sign.
import {mkdir,writeFile} from 'node:fs/promises';
import {RWA_ASSETS,SWAP_INPUTS} from '../lib/assets';
import {createLifiClient} from '../lib/admin/lifi';
const results:object[]=[];
const quote=createLifiClient(fetch,process.env.LIFI_API_KEY);
async function main(){
  for(const asset of RWA_ASSETS){
    for(const input of SWAP_INPUTS){
      try{
        const q=await quote({address:'0x000000000000000000000000000000000000dEaD',inputAsset:input,outputAsset:asset,amount:input.id==='usdc'?'10000000':'4000000000000000'});
        const result={input:input.ticker,output:asset.ticker,validated:true,route:q.route,minimum:q.minimum,feeAmount:q.feeAmount,router:q.transaction.to,value:q.transaction.value};results.push(result);console.log(JSON.stringify(result));
      }catch(error){results.push({input:input.ticker,output:asset.ticker,validated:false,error:error instanceof Error?error.message:'Quote unavailable'});process.exitCode=1;}
    }
  }
  await mkdir('artifacts/lifi',{recursive:true});
  await writeFile('artifacts/lifi/live-quotes-check.json',JSON.stringify({checkedAt:new Date().toISOString(),mode:'read-only, no funds or signatures',results},null,2));
}
void main();
