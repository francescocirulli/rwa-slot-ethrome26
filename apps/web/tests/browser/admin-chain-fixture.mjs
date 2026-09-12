// Browser-only data. Never imported by the application or used for transactions.
export function adminChainFixture(player, block = 110, finished = false) {
  const address = '0x0000000000000000000000000000000000000099';
  const token = '0x0000000000000000000000000000000000000088';
  const zero = '0x0000000000000000000000000000000000000000';
  const prizes = [
    {symbol:0,kind:2,token,tokenId:'7',fiveMatchAmount:'1',threeMatchWeight:100,fiveMatchWeight:100},
    {symbol:1,kind:3,token:zero,tokenId:'0',fiveMatchAmount:'2',threeMatchWeight:100,fiveMatchWeight:100},
    {symbol:2,kind:1,token,tokenId:'0',fiveMatchAmount:'1000000000000000000',threeMatchWeight:100,fiveMatchWeight:400},
  ];
  const game = {id:'1',player,freeSpin:false,price:'1000000',pending:!finished,hasResult:finished,confirmed:finished,won:finished,invalidated:false,status:finished?'won':'waiting',targetBlock:'112',revealDeadline:'368',catalogVersion:'3',winningSymbol:1,winningLine:1,matchCount:5,symbols:[1,1,0,0,2,0,2,1,2,0,2,0,2,1,1],payout:finished?{kind:3,token:zero,tokenId:'0',amount:'2',formattedAmount:'2',tokenSymbol:null}:null,transactionHash:finished?'0x'+'a'.repeat(64):null};
  return {snapshot:{configured:true,address,chainId:8453,paymentToken:token,gasMode:'usdc',confirmations:2,block:String(block),funding:{ready:true,assets:[]},
    settings:{ticketPrice:'1000000',paused:false,configuredPrizeCount:3,totalOutcomeWeight:1000,noWinWeight:0,revealDelayBlocks:5,revealWindowBlocks:256,catalogVersion:'3',activeRoundCount:finished?'0':'1',nextGameId:'2'},
    permissions:{owner:player,isOwner:true,manager:true,treasurer:true,pauser:true},catalog:prizes,player:null,pendingOwner:{address:zero,schedule:0},
    inventory:[{symbol:0,balance:'50',reserved:'1',available:'49'},{symbol:2,balance:'100000000000000000000',reserved:'1000000000000000000',available:'99000000000000000000'}],
    keeper:{configured:true,address:'0x0000000000000000000000000000000000000077',lastTick:Date.now(),lastBlock:String(block),error:'',canStartFreeSpin:false,balanceWei:'10000000000000000',pendingTransaction:null}},history:{games:[game],next:'1'}};
}
