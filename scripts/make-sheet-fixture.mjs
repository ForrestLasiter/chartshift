// Engraves the test hymn as a picture for the smoke run, which opens it in
// the real app and reads the music:  node scripts/make-sheet-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { engrave, mei } from '../test/helpers/engrave.mjs';
import { OLD_HUNDREDTH } from '../test/helpers/tunes.mjs';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'old-hundredth.png');
const { svg } = await engrave(mei(OLD_HUNDREDTH));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, new Resvg(svg, { fitTo: { mode: 'width', value: 2550 }, background: 'white', font: { loadSystemFonts: true } }).render().asPng());
console.log('wrote', out, fs.statSync(out).size, 'bytes');
