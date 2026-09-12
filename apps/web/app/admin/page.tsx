import {AdminProvider} from './admin';
import './style.css';
export const dynamic = 'force-dynamic';
export const metadata = {title: 'Wall Street Slot — control room'};
export default function AdminPage() {
  return <AdminProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ''} configured={!!process.env.PRIVY_APP_SECRET}/>;
}
