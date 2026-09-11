import type {Metadata, Viewport} from 'next';
export const metadata: Metadata = {title: 'Lucky Signal — collega il tuo wallet', description: 'Il tuo wallet. La tua sessione. Lucky Signal.', robots: {index: false, follow: false}};
export const viewport: Viewport = {width: 'device-width', initialScale: 1, themeColor: '#171426'};
export default function Layout({children}: {children: React.ReactNode}) {
  return <html lang="it"><body>{children}</body></html>;
}
