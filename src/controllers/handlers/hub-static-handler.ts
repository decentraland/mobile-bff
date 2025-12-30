import * as fs from 'fs'
import * as path from 'path'
import { IHttpServerComponent } from '@well-known-components/interfaces'
import { GlobalContext } from '../../types'

// Locate package directory
const packageDir = path.dirname(require.resolve('@dcl-regenesislabs/mobile-hub/package.json'))

// Base path where the hub is served
const HUB_BASE_PATH = '/hub'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

/**
 * Rewrite paths in HTML to include the hub base path.
 * - Transforms href="/" and src="/" to href="/hub/" and src="/hub/"
 * - Sets window.__BASE_PATH__ for React Router
 */
function rewriteHtmlPaths(html: string): string {
  return html
    .replace(/href="\//g, `href="${HUB_BASE_PATH}/`)
    .replace(/src="\//g, `src="${HUB_BASE_PATH}/`)
    .replace(/window\.__BASE_PATH__\s*=\s*""/, `window.__BASE_PATH__ = "${HUB_BASE_PATH}"`)
}

export async function hubStaticHandler(
  context: IHttpServerComponent.DefaultContext<GlobalContext>
): Promise<IHttpServerComponent.IResponse> {
  // Extract path after /hub/
  const urlPath = new URL(context.url.toString()).pathname.replace(/^\/hub\/?/, '') || 'index.html'
  const filePath = path.join(packageDir, urlPath)

  try {
    const content = await fs.promises.readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()

    // Rewrite paths in HTML files
    if (ext === '.html') {
      const html = rewriteHtmlPaths(content.toString('utf-8'))
      return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: html,
      }
    }

    return {
      status: 200,
      headers: { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' },
      body: content,
    }
  } catch {
    const ext = path.extname(urlPath).toLowerCase()

    // Only use SPA fallback for routes (no extension), not for missing assets
    if (ext && ext !== '.html') {
      return {
        status: 404,
        headers: { 'content-type': 'text/plain' },
        body: 'Not found',
      }
    }

    // SPA fallback: serve index.html for missing routes
    const indexPath = path.join(packageDir, 'index.html')
    const content = await fs.promises.readFile(indexPath)
    const html = rewriteHtmlPaths(content.toString('utf-8'))
    return {
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: html,
    }
  }
}
