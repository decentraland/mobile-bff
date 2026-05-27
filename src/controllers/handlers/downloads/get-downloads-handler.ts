import { HandlerContextWithPath } from '../../../types'

// Hardcoded download numbers per platform. Replace with a real data source
// (store APIs / analytics) when available.
const DOWNLOADS = {
  ios: 125000,
  android: 98000
}

export async function getDownloadsHandler(_context: HandlerContextWithPath<'logs', '/downloads'>) {
  const { ios, android } = DOWNLOADS

  return {
    status: 200,
    body: {
      ok: true,
      data: {
        ios,
        android,
        total: ios + android
      }
    }
  }
}
