/** @type {import('next').NextConfig} */
const nextConfig = {
    eslint: { ignoreDuringBuilds: true },
    transpilePackages: ['@prometheus-avatar/core'],
    async rewrites() {
        return [
            { source: '/api/marketplace/:path*', destination: 'https://marketplace.mythslabs.ai/api/marketplace/:path*' },
            { source: '/api/creator/:path*', destination: 'https://marketplace.mythslabs.ai/api/creator/:path*' },
            // S050 WebSocket Volcengine token + Live Token + OpenAI Token
            { source: '/api/volcengine-realtime-token', destination: 'https://marketplace.mythslabs.ai/api/volcengine-realtime-token' },
            { source: '/api/live-token', destination: 'https://marketplace.mythslabs.ai/api/live-token' },
            { source: '/api/openai-realtime-token', destination: 'https://marketplace.mythslabs.ai/api/openai-realtime-token' },
            { source: '/api/minimax-realtime-token', destination: 'https://marketplace.mythslabs.ai/api/minimax-realtime-token' }
        ]
    }
};

export default nextConfig;
