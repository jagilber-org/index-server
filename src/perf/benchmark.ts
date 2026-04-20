import { performance } from 'perf_hooks';
import crypto from 'crypto';

interface Stat { name: string; iterations: number; totalMs: number; p95Ms: number; maxMs: number; }

function measure(fn: () => void, iterations: number): Stat {
  const samples: number[] = [];
  for(let i=0;i<iterations;i++){
    const s = performance.now();
    fn();
    const e = performance.now();
    samples.push(e - s);
  }
  samples.sort((a,b)=>a-b);
  const p95Index = Math.floor(samples.length * 0.95) - 1;
  return {
    name: fn.name || 'anon',
    iterations,
    totalMs: samples.reduce((a,b)=>a+b,0),
    p95Ms: samples[Math.max(0,p95Index)],
    maxMs: samples[samples.length-1]
  };
}

function syntheticEntries(n: number){
  const entries = [];
  for(let i=0;i<n;i++){
    const body = `Instruction body ${i} ` + 'x'.repeat(50);
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    entries.push({ id: `id-${i}`, title: `Title ${i}`, body, priority: (i%100)+1, audience: 'all', requirement: 'mandatory', categories:['bench'], sourceHash: hash, schemaVersion:'1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  return entries;
}

function run(){
  const sizes = [100, 1000, 5000];
  interface BenchResult { size: number; searchP95: string; searchMax: string }
  const results: BenchResult[] = [];
  for(const size of sizes){
    const index = syntheticEntries(size);
    // measure search
    const term = 'Instruction body';
    const stat = measure(()=>{
      const lower = term.toLowerCase();
      index.filter(e => e.title.toLowerCase().includes(lower) || e.body.toLowerCase().includes(lower));
    }, 50);
    results.push({ size, searchP95: stat.p95Ms.toFixed(4), searchMax: stat.maxMs.toFixed(4) });
  }
  console.log(JSON.stringify({ benchmark: 'search', results }, null, 2));
}

run();
