import {getAdminRuntime} from '@/lib/admin/runtime';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const POST=(request:Request)=>getAdminRuntime().authorization(request);
