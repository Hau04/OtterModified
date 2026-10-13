/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  turbopack: {
    root: process.cwd(),
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  env: {
    // 从环境变量中读取后端URL，默认使用当前地址
    BACKEND_URL: process.env.VUE_APP_BACKEND_URL || '',
  },
}

export default nextConfig
