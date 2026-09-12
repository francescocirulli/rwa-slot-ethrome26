import type {Viewport} from 'next';
import {PhoneProvider} from './phone';
import './style.css';
export const viewport: Viewport = {width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#2c0d13'};
export const dynamic = 'force-dynamic';
export default function PhonePage() {
  return <PhoneProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ''} configured={!!process.env.PRIVY_APP_SECRET}/>;
}
