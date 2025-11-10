import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  serverExternalPackages: [],
  webpack: (config) => {
    config.externals = config.externals || [];
    config.externals.push({
      './schemas/CHC30121.json': 'commonjs ./schemas/CHC30121.json',
      './schemas/CHC33021.json': 'commonjs ./schemas/CHC33021.json',
      './schemas/CHC43121.json': 'commonjs ./schemas/CHC43121.json',
      './schemas/CHC50121.json': 'commonjs ./schemas/CHC50121.json',
    });
    return config;
  },
};

export default nextConfig;
