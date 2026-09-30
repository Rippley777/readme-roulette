import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  serverExternalPackages: ['better-sqlite3', 'typescript', 'mssql'],
  poweredByHeader: false,
  devIndicators: false,
};
export default config;
