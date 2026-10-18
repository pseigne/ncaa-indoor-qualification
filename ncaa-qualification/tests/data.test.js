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
  await writeFile(join(source, 'tfrrs_active_data.json'), '[{"year":"2026"}]\n')
  await writeFile(join(source, 'tfrrs_bubble_cutoffs.json'), '[]\n')
  await writeFile(join(source, 'historical_indoor_f_400_Meters.json'), '[]\n')
  await writeFile(join(source, 'private.txt'), 'not a data file')
  return { root, source, app }
}

test('build copies authoritative JSON without creating a public data copy', async t => {
  const { source, app } = await fixture(t)
  const plugin = tfrrsData(source)
  plugin.configResolved({ root: app, base: '/ncaa-indoor-qualification/', build: { outDir: 'dist' } })
  await plugin.closeBundle()
  for (const name of ['tfrrs_active_data.json', 'tfrrs_bubble_cutoffs.json', 'historical_indoor_f_400_Meters.json']) {
    assert.deepEqual(await readFile(join(app, 'dist/data', name)), await readFile(join(source, name)))
  }
  await assert.rejects(readFile(join(app, 'dist/data/private.txt')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(app, 'public/data/tfrrs_active_data.json')), { code: 'ENOENT' })
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
    const url = `${origin}${base}data/tfrrs_active_data.json`
    const first = await fetch(url)
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.deepEqual(await first.json(), [{ year: '2026' }])
    await writeFile(join(source, 'tfrrs_active_data.json'), '[{"year":"2027"}]')
    assert.deepEqual(await (await fetch(url)).json(), [{ year: '2027' }])
    const head = await fetch(url, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
    assert.equal((await fetch(`${origin}${base}data/missing.json`)).status, 404)
    assert.equal((await fetch(`${origin}${base}data/%2e%2e%2fprivate.json`)).status, 404)
    assert.equal((await fetch(`${origin}${base}data/private.txt`)).status, 404)
  })
}
