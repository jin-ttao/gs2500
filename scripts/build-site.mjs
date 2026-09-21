import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoRoot = join(projectRoot, 'demo');
const demoOutput = join(demoRoot, 'dist');
const output = join(projectRoot, 'dist');
const siteOnly = process.argv.includes('--site-only');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function run(command, args, cwd) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

async function demoDependenciesMatchLock() {
  const lockPath = join(demoRoot, 'package-lock.json');
  const installedPath = join(demoRoot, 'node_modules', '.package-lock.json');
  if (!(await exists(installedPath))) return false;

  const [lock, installed] = await Promise.all([
    readFile(lockPath, 'utf8').then(JSON.parse),
    readFile(installedPath, 'utf8').then(JSON.parse),
  ]);

  const expectedPackages = lock.packages ?? {};
  const installedPackages = installed.packages ?? {};
  return Object.entries(expectedPackages)
    .filter(([name]) => name.startsWith('node_modules/'))
    .every(([name, metadata]) => installedPackages[name]?.version === metadata.version);
}

async function buildDemo() {
  if (!(await demoDependenciesMatchLock())) {
    console.log('Installing locked demo dependencies with npm ci.');
    await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], demoRoot);
  } else {
    console.log('Using demo dependencies that match demo/package-lock.json.');
  }
  await run('npm', ['run', 'build'], demoRoot);
}

async function copyIfPresent(source, destination) {
  if (!(await exists(source))) return false;
  await cp(source, destination, { recursive: true });
  return true;
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files;
}

async function assertStaticOutputIsSafe() {
  const files = await listFiles(output);
  const forbidden = files.find(path => {
    const name = relative(output, path).split(sep).at(-1);
    return name === 'server.mjs' || name === '.env' || name.startsWith('.env.');
  });
  if (forbidden) {
    throw new Error(`Refusing to publish private or server-only file: ${relative(output, forbidden)}`);
  }
}

async function assembleSite() {
  if (!(await exists(join(projectRoot, 'index.html')))) {
    throw new Error('Root index.html is required.');
  }
  if (!(await exists(join(demoOutput, 'index.html')))) {
    throw new Error('demo/dist is missing. Run the full build instead of --site-only.');
  }

  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(join(projectRoot, 'index.html'), join(output, 'index.html'));
  await copyIfPresent(join(projectRoot, 'app'), join(output, 'app'));
  await copyIfPresent(join(projectRoot, 'data'), join(output, 'data'));
  await copyIfPresent(join(projectRoot, 'deliverables'), join(output, 'deliverables'));

  const appData = join(projectRoot, 'app', 'data');
  if (await exists(appData)) {
    await mkdir(join(output, 'data'), { recursive: true });
    await cp(appData, join(output, 'data'), { recursive: true });
  }

  await cp(demoOutput, join(output, 'demo'), { recursive: true });
  const demoEmbed = join(output, 'demo', 'embed.html');
  if (!(await exists(demoEmbed))) {
    const demoHtml = await readFile(join(output, 'demo', 'index.html'), 'utf8');
    await writeFile(demoEmbed, demoHtml);
  }

  await assertStaticOutputIsSafe();
  const files = await listFiles(output);
  console.log(`Built dist with ${files.length} static files.`);
}

if (!siteOnly) await buildDemo();
await assembleSite();
