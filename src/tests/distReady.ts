import fs from 'fs';
import path from 'path';

// Wait (poll) for dist/server/index-server.js to exist before spawning server processes.
// Prevents race where pretest clean removes dist and early test spawns before rebuild completes.
export async function waitForDist(timeoutMs=18000, intervalMs=50){
  const target = path.join(process.cwd(),'dist','server','index-server.js');
  const modern = path.join(process.cwd(),'dist','src','server','index-server.js');
  const start = Date.now();
  const debug = process.env.DIST_WAIT_DEBUG === '1';
  while(Date.now() - start < timeoutMs){
    if(fs.existsSync(target)) return true;
    // If modern path exists but legacy shim missing, create lightweight forwarder
    if(fs.existsSync(modern) && !fs.existsSync(target)){
      try {
        const serverDir = path.dirname(target);
        if(!fs.existsSync(serverDir)) fs.mkdirSync(serverDir,{recursive:true});
  fs.writeFileSync(target, "// auto-generated test shim (invokes main)\nconst mod = require('../src/server/index-server.js');\nif(mod && typeof mod.main==='function'){ try { mod.main(); } catch(e){ console.error('[shim] main failed', e); } }\nmodule.exports = mod;\n");
        if(debug){
          // eslint-disable-next-line no-console
          console.log('[waitForDist] Created legacy dist/server/index-server.js shim');
        }
        return true;
      } catch{/* ignore */}
    }
    await new Promise(r=> setTimeout(r, intervalMs));
  }
  // Fallback: if file still missing but dist directory exists and compile may still be finishing, allow one
  // extended grace window (up to +6s) if EXTEND_DIST_WAIT=1 set to reduce flakes under heavy CI load.
  if(process.env.EXTEND_DIST_WAIT === '1'){
    const graceStart = Date.now();
    while(Date.now() - graceStart < 6000){
      if(fs.existsSync(target)) return true;
      await new Promise(r=> setTimeout(r, 75));
    }
  }
  if(debug){
    try {
      const distExists = fs.existsSync(path.join(process.cwd(),'dist'));
      const serverDir = path.join(process.cwd(),'dist','server');
      const serverDirExists = fs.existsSync(serverDir);
      const listing = serverDirExists ? fs.readdirSync(serverDir).join(',') : '(missing)';
      // eslint-disable-next-line no-console
      console.error(`[waitForDist] timeout after ${Date.now()-start}ms. distExists=${distExists} serverDirExists=${serverDirExists} listing=${listing}`);
    } catch {/* ignore */}
  }
  return false;
}
