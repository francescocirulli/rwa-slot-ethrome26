import {getSlotEngine} from '@/lib/slot/runtime';
import {TransactionReceiptNotFoundError, type Hash} from 'viem';
import {slotError} from '@/lib/slot/errors';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const hash = new URL(request.url).searchParams.get('hash');
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return Response.json({error: 'Hash non valido.'}, {status: 400});
  try {
    const slot = getSlotEngine(); if (!slot) return Response.json({error: 'Contratto non configurato.'}, {status: 503});
    const receipt = await slot.reader.client.getTransactionReceipt({hash: hash as Hash}).catch(error => {if (error instanceof TransactionReceiptNotFoundError) return null; throw error;});
    if (!receipt) return Response.json({status: 'pending'}, {headers: {'Cache-Control': 'no-store'}});
    const block = await slot.reader.client.getBlockNumber({cacheTime: 0});
    const confirmations = Number(block - receipt.blockNumber + 1n);
    return Response.json({status: receipt.status === 'reverted' ? 'reverted' : confirmations >= slot.reader.config.confirmations ? 'confirmed' : 'pending', confirmations}, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return Response.json({error: slotError(error).message}, {status: 503, headers: {'Cache-Control': 'no-store'}});}
}
