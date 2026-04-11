import { beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

let proc: ReturnType<typeof spawn> | null = null;
let serverReady = false;

export function useSharedServer(){
  beforeAll(async () => {
    if(serverReady) return;
    const bin = path.join(process.cwd(),'dist','server', 'index-server.js');
    if(!fs.existsSync(bin)){
      // Build may not have happened yet; rely on pretest build to generate dist
    }
    proc = spawn(process.execPath, [bin], { stdio:['pipe','pipe','pipe'], env:{ ...process.env } });
    // naive readiness: wait 300ms; could probe initialize if needed later
    await new Promise(r=> setTimeout(r, 300));
    serverReady = true;
  }, 20_000);
  afterAll(async () => {
    if(proc){ proc.kill(); proc = null; }
  });
}
