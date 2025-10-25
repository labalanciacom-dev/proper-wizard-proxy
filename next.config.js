/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Lint hataları build’i düşürmesin
    ignoreDuringBuilds: true,
  },
  typescript: {
    // TS tip hataları build’i düşürmesin (dosyalarımız JS zaten)
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;
