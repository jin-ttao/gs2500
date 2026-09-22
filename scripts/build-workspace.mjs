import {cp,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'dist');
await mkdir(out,{recursive:true});
// Explicit runtime allowlist excludes keys, sessions, research and server files.
await cp(path.join(root,'demo/dist'),path.join(out,'demo'),{recursive:true});
await cp(path.join(root,'demo/assets'),path.join(out,'assets'),{recursive:true,filter:source=>!source.endsWith('.blend')});
await mkdir(path.join(out,'workspace'),{recursive:true});
for(const name of ['app.js','views.js','styles.css','integration.css','state.js','data.js','forecast.js','forecast-job.js','forecast-worker.js','world-view.js','ledger-replay.js','clock.js','jev-decision.js','operations.js','operations-view.js','proposal-history.js','proposal-history-view.js','obolus-surfaces.js','obolus.css','ui.js','ui.css'])await cp(path.join(root,'workspace',name),path.join(out,'workspace',name));
await cp(path.join(root,'workspace/assets'),path.join(out,'workspace/assets'),{recursive:true});
await cp(path.join(root,'index.html'),path.join(out,'index.html'));
await cp(path.join(root,'design/reference/gs2500-storyboard-handoff.html'),path.join(out,'storyboard.html'));
console.log('Built dist: manager workflow, preserved 3D lab, local assets; no server key included.');
