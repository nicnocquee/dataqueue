import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ['pg-bg-job-queue'],
};

export default nextConfig;
