import type {NextConfig} from 'next';

const config: NextConfig = {
  output: 'standalone',
  turbopack: {root: process.cwd()},
  allowedDevOrigins: process.env.APP_ORIGIN ? [new URL(process.env.APP_ORIGIN).hostname] : [],
  poweredByHeader: false,
  async headers() {
    return [{source: '/:path*', headers: [
      {key: 'X-Content-Type-Options', value: 'nosniff'},
      {key: 'Referrer-Policy', value: 'no-referrer'},
      {key: 'X-Frame-Options', value: 'DENY'},
    ]}, {source: '/terminal/explorer.html', headers: [
      {key: 'X-Frame-Options', value: 'SAMEORIGIN'},
      {key: 'Content-Security-Policy', value: "frame-ancestors 'self'"},
    ]}];
  },
};
export default config;
