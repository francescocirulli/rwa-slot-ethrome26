import {ensApi} from '@/lib/ens/runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return ensApi()(request);}
export async function POST(request:Request){return ensApi()(request);}
