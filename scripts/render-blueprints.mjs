/** Rasterize docs/blueprints/*.svg -> .png at 2x for Blender reference use. */
import { Resvg } from '@resvg/resvg-js'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'blueprints')
for (const f of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
  const svg = readFileSync(join(dir, f), 'utf8')
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 4400 },
    font: { loadSystemFonts: true, defaultFontFamily: 'Consolas' },
    background: '#0A2239',
  })
  const png = resvg.render().asPng()
  const out = f.replace('.svg', '.png')
  writeFileSync(join(dir, out), png)
  console.log(`${f} -> ${out} (${(png.length / 1024).toFixed(0)} KB)`)
}
