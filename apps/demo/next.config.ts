import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ['dataqueue', '@nicnocquee/dataqueue-react'],
};

export default nextConfig;
