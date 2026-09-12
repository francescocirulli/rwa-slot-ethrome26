import type {Metadata, Viewport} from 'next';
export const metadata: Metadata = {title: 'Wall Street Slot — link your wallet', description: 'Your wallet. Your session. Fully onchain.', robots: {index: false, follow: false}};
export const viewport: Viewport = {width: 'device-width', initialScale: 1, themeColor: '#3a0c10'};
export default function Layout({children}: {children: React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
