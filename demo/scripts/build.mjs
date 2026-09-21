import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
// Only this generated output directory is replaced. Sources and local notes stay intact.
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'vendor', 'three'), { recursive: true });

const modules = [
  'app.js', 'card-worlds.js', 'characters.js', 'lab.js', 'maps.js',
  'model.js', 'navigation.js', 'store.js', 'world.js', 'styles.css',
  'context.js', 'merchandising.js', 'day.js', 'simulation-cards.css', 'store-pages.css',
  'summary-replay.js', 'replay-recorder.js', 'replay-worker.js',
  'personas.js', 'behavior.js', 'jev.js',
];
await Promise.all(modules.map(name => cp(join(root, name), join(output, name))));
await cp(join(root,'data'),join(output,'data'),{recursive:true});
await mkdir(join(output, 'components', 'ui'), { recursive: true });
await cp(join(root, 'components', 'ui', 'simulation-card.js'), join(output, 'components', 'ui', 'simulation-card.js'));
await cp(join(root, 'components', 'ui', 'store-pager.js'), join(output, 'components', 'ui', 'store-pager.js'));
await mkdir(join(output, 'assets'));
const assets = ['shopper.glb', 'coffee-machine.glb', 'checkout-terminal.glb', 'product-atlas.png', 'ASSET_NOTES.md'];
await Promise.all(assets.map(name => cp(join(root, 'assets', name), join(output, 'assets', name))));
const three = join(root, 'node_modules', 'three');
await Promise.all([
  cp(join(three, 'build'), join(output, 'vendor', 'three', 'build'), { recursive: true }),
  cp(join(three, 'examples', 'jsm'), join(output, 'vendor', 'three', 'examples', 'jsm'), { recursive: true }),
  cp(join(three, 'LICENSE'), join(output, 'vendor', 'three', 'LICENSE')),
]);
const html = await readFile(join(root, 'index.html'), 'utf8');
await writeFile(join(output, 'index.html'), html.replaceAll('./node_modules/three/', './vendor/three/'));
console.log('Built demo/dist — serve this directory with any static HTTP server.');
