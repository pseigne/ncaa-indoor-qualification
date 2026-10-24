import { fileURLToPath } from 'node:url'
import { basename, resolve } from 'node:path'
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises'

// The site's files, generated from the archive, serve both local development and production builds.
// Only they are published: the archive stays in the repository.
export function tfrrsData(dataDir = fileURLToPath(new URL('../../data/site/', import.meta.url))) {
  let outputDir
  let prefix
  return {
    name: 'tfrrs-data',
    configResolved(config) {
      outputDir = resolve(config.root, config.build.outDir, 'data')
      prefix = `${config.base.replace(/\/$/, '')}/data/`
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!['GET', 'HEAD'].includes(req.method)) return next()
        const notFound = () => {
          res.statusCode = 404
          res.end('Data file not found')
        }
        let name
        try {
          const pathname = new URL(req.url, 'http://localhost').pathname
          if (!pathname.startsWith(prefix)) return next()
          name = decodeURIComponent(pathname.slice(prefix.length))
        } catch { return next() }
        if (name !== basename(name) || !name.endsWith('.json')) return notFound()
        try {
          const data = await readFile(resolve(dataDir, name))
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(req.method === 'HEAD' ? undefined : data)
        } catch (error) {
          if (error.code === 'ENOENT') return notFound()
          next(error)
        }
      })
    },
    async closeBundle() {
      await mkdir(outputDir, { recursive: true })
      const files = await readdir(dataDir, { withFileTypes: true })
      await Promise.all(files.filter(file => file.isFile() && file.name.endsWith('.json'))
        .map(file => copyFile(resolve(dataDir, file.name), resolve(outputDir, file.name))))
    },
  }
}
