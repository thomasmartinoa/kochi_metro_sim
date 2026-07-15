/**
 * Prepares the facade textures the city export needs, into the scratchpad.
 *
 * Two problems with the stock Blosm sheets that this fixes:
 *  1. The apartment/office facades are alpha cutouts (58% / 35% transparent) —
 *     meant to be composited over cladding. Used raw they'd leave holes, so
 *     they're baked opaque over plaster / concrete.
 *  2. The brick + glass *emissive* maps are near-white with the window mask in
 *     their ALPHA channel. glTF's emissive ignores alpha, so whole walls would
 *     glow instead of the windows; they're composited over black.
 * Also converts the 1-channel greyscale concrete maps to RGB, which Blender's
 * WEBP writer requires.
 *
 * Run: node scripts/bake-facades.mjs <blosm_textures_dir> <out_dir>
 */
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

const [ASSETS, OUT] = process.argv.slice(2)
if (!ASSETS || !OUT) {
  console.error('usage: node scripts/bake-facades.mjs <blosm_textures_dir> <out_dir>')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
const RES = `${ASSETS}/Residential house facade with windowsdoors`

/** facade sheet composited opaque over a tiled cladding base */
async function facade(sheet, base, tilePx, w, h, out) {
  const tile = await sharp(base).resize(tilePx, tilePx).toBuffer()
  await sharp({ create: { width: w, height: h, channels: 3, background: '#EDE9DF' } })
    .composite([{ input: tile, tile: true }, { input: await sharp(sheet).toBuffer() }])
    .png()
    .toFile(out)
  return out
}

/** emissive sheet flattened over black so only its lit pixels survive */
async function emissive(sheet, w, h, out) {
  await sharp({ create: { width: w, height: h, channels: 3, background: '#000000' } })
    .composite([{ input: await sharp(sheet).toBuffer() }])
    .png()
    .toFile(out)
  return out
}

async function toRGB(src, out) {
  await sharp(src).toColourspace('srgb').removeAlpha().png().toFile(out)
  return out
}

const made = []
made.push(await facade(`${ASSETS}/facades/appartments/pro_6908.png`,
  `${ASSETS}/cladding/plaster/duion_plaster_stucco_01_D.png`, 472, 1911, 2204,
  `${OUT}/facade_apartments.png`))
made.push(await emissive(`${ASSETS}/facades/appartments/pro_6908_emissive.png`, 1911, 2204,
  `${OUT}/facade_apartments_emissive.png`))
made.push(await facade(`${ASSETS}/facades/office/pro_2157.png`,
  `${ASSETS}/cladding/concrete/cc0textures_concrete06_col.jpg`, 850, 2715, 1878,
  `${OUT}/facade_office.png`))
made.push(await emissive(`${ASSETS}/facades/office/pro_2157_emissive.png`, 2715, 1878,
  `${OUT}/facade_office_emissive.png`))
made.push(await emissive(`${RES}/Residential house facade with windows emmision.png`, 256, 256,
  `${OUT}/brick_emissive.png`))
made.push(await emissive(`${ASSETS}/facades/glass/pro_6841_emission.png`, 1548, 1782,
  `${OUT}/glass_emissive.png`))
made.push(await toRGB(`${ASSETS}/cladding/concrete/cc0textures_concrete06_col.jpg`,
  `${OUT}/roof_concrete_rgb.png`))
made.push(await toRGB(`${ASSETS}/cladding/concrete/cc0textures_concrete06_col_nrm.png`,
  `${OUT}/roof_concrete_rgb_nrm.png`))

for (const f of made) {
  const s = await sharp(f).stats()
  console.log(f.split(/[\\/]/).pop().padEnd(34),
    'meanRGB', s.channels.slice(0, 3).map((c) => Math.round(c.mean)).join(','))
}
