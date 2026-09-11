import {getContractApi} from '@/lib/slot/transaction-runtime';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request:Request) {return getContractApi().handle(request,'status');}
