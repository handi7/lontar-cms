import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@lontar/admin'],
  rewrites() {
    return Promise.resolve({
      beforeFiles: [
        {
          source: '/',
          destination: '/en',
        },
        {
          source: '/posts/:path*',
          destination: '/en/posts/:path*',
        },
        {
          source: '/categories/:path*',
          destination: '/en/categories/:path*',
        },
        {
          source: '/:slug((?!admin|api|_next|en|id)[^/]+)',
          destination: '/en/:slug',
        },
      ],
    })
  },
}

export default nextConfig
