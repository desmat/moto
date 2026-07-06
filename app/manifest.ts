import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MotoGPT - Track your motorcycle maintenance with AI-powered insights',
    short_name: 'MotoGPT',
    description: 'Track your motorcycle maintenance with AI-powered insights',
    start_url: '/',
    display: 'standalone',
    icons: [
      {
        src: 'favicon.ico',
        sizes: '256x256',
        type: 'image/x-icon',
      },
    ],
  }
}
