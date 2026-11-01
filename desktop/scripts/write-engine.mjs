// Records where Alfred's engine (brain/server.mjs) lives, for the packaged app to start it
// from. Run by `npm run dist`; the installed app reads engine.json from inside itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(process.env.ALFRED_ENGINE_DIR || path.join(HERE, '..', '..', 'brain'));
if (!fs.existsSync(path.join(dir, 'server.mjs'))) throw new Error(`no server.mjs in ${dir}`);
fs.writeFileSync(path.join(HERE, '..', 'engine.json'), `${JSON.stringify({ dir }, null, 2)}\n`);
console.log(`engine: ${dir}`);
