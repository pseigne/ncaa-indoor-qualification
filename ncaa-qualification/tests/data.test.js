import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createServer } from 'vite'
import { tfrrsData } from '../tools/tfrrs-data.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tfrrs-data-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const app = join(root, 'app')
  await mkdir(source)
  await mkdir(app)
  await writeFile(join(app, 'index.html'), '<div>Monitor test</div>')
  await writeFile(join(source, 'index.json'), '{"lists":[]}\n')
  await writeFile(join(source, 'indoor-2025-2026-m-National.json'), '{"events":[]}\n')
  await writeFile(join(source, 'history-indoor-m.json'), '{"lines":[]}\n')
  await writeFile(join(source, 'private.txt'), 'not a data file')
  return { root, source, app }
}

test('build copies authoritative JSON without creating a public data copy', async t => {
  const { source, app } = await fixture(t)
  const plugin = tfrrsData(source)
  plugin.configResolved({ root: app, base: '/ncaa-indoor-qualification/', build: { outDir: 'dist' } })
  await plugin.closeBundle()
  for (const name of ['index.json', 'indoor-2025-2026-m-National.json', 'history-indoor-m.json']) {
    assert.deepEqual(await readFile(join(app, 'dist/data', name)), await readFile(join(source, name)))
  }
  await assert.rejects(readFile(join(app, 'dist/data/private.txt')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(app, 'public/data/index.json')), { code: 'ENOENT' })
})

test('build publishes the site files and leaves the archive out', async t => {
  const { app } = await fixture(t)
  const plugin = tfrrsData()
  plugin.configResolved({ root: app, base: '/', build: { outDir: 'dist' } })
  await plugin.closeBundle()
  const index = JSON.parse(await readFile(join(app, 'dist/data/index.json'), 'utf8'))
  assert.ok(index.lists.length > 0)
  await readFile(join(app, 'dist/data', index.lists[0].file))
  await assert.rejects(readFile(join(app, 'dist/data/past_cutoffs.json')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(app, 'dist/data/tfrrs_historical_data.json')), { code: 'ENOENT' })
})

for (const base of ['/', '/ncaa-indoor-qualification/']) {
  test(`development serves current JSON at ${base}data/`, async t => {
    const { source, app } = await fixture(t)
    const server = await createServer({
      configFile: false, root: app, base, optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [tfrrsData(source)],
      server: { host: '127.0.0.1', port: 0, strictPort: false, watch: null },
    })
    t.after(() => server.close())
    await server.listen()
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    const url = `${origin}${base}data/index.json`
    const first = await fetch(url)
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.deepEqual(await first.json(), { lists: [] })
    await writeFile(join(source, 'index.json'), '{"lists":[{"year":"2027"}]}')
    assert.deepEqual(await (await fetch(url)).json(), { lists: [{ year: '2027' }] })
    const head = await fetch(url, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
    assert.equal((await fetch(`${origin}${base}data/missing.json`)).status, 404)
    assert.equal((await fetch(`${origin}${base}data/%2e%2e%2fprivate.json`)).status, 404)
    assert.equal((await fetch(`${origin}${base}data/private.txt`)).status, 404)
  })
}
