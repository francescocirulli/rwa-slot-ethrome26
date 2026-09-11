import {PhoneProvider} from './phone';
import './style.css';
export const dynamic = 'force-dynamic';
export default function PhonePage() {
  return <PhoneProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ''} configured={!!process.env.PRIVY_APP_SECRET}/>;
}
