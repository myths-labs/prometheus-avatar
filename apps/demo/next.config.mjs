/** @type {import('next').NextConfig} */
const nextConfig = {
    eslint: { ignoreDuringBuilds: true },
    transpilePackages: ['@prometheus-avatar/core'],
};

export default nextConfig;
