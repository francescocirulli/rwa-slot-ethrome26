import {getContractApi} from '@/lib/slot/transaction-runtime';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request:Request) {return getContractApi().handle(request,'send');}
