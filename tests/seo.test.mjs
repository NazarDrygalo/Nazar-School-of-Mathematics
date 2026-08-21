import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('search metadata includes valid structured data and a canonical URL', async () => {
  const html = await read('index.html')
  const structuredData = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]
  assert.ok(structuredData)
  const schema = JSON.parse(structuredData)
  assert.equal(schema['@context'], 'https://schema.org')
  assert.match(html, /rel="canonical" href="https:\/\/nazarschoolofmath\.com\/"/)
  assert.match(html, /name="robots" content="index, follow"/)
})

test('sitemap lists clean public routes and excludes private portals', async () => {
  const sitemap = await read('public/sitemap.xml')
  for (const path of ['/', '/math', '/science-and-essay-writing', '/resources', '/apply', '/contact', '/privacy', '/terms']) {
    assert.match(sitemap, new RegExp(`<loc>https://nazarschoolofmath\\.com${path === '/' ? '\\/' : path}<\\/loc>`))
  }
  assert.doesNotMatch(sitemap, /\/(admin|parent|student|tutor|portal)<\/loc>/)
})

test('robots rules protect portal routes and mobile controls have touch-sized targets', async () => {
  const [robots, styles, main] = await Promise.all([read('public/robots.txt'), read('src/styles.css'), read('src/main.tsx')])
  for (const path of ['/admin', '/parent', '/student', '/tutor', '/portal']) assert.match(robots, new RegExp(`Disallow: ${path}`))
  assert.match(styles, /nav>a:not\(\.button\).*min-height:44px/)
  assert.match(styles, /\.footer-links a,footer address a.*min-height:44px/)
  assert.match(styles, /a:focus-visible,button:focus-visible,summary:focus-visible/)
  assert.match(main, /aria-controls="primary-navigation"/)
  assert.match(main, /event\.key === 'Escape'/)
})

test('site metadata exposes the supplied logo as the browser icon', async () => {
  const html = await read('index.html')
  assert.match(html, /<link rel="icon" type="image\/png" href="\/favicon\.png\?v=2" \/>/)
  assert.match(html, /<link rel="apple-touch-icon" href="\/favicon\.png\?v=2" \/>/)
})

