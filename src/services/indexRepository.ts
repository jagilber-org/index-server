import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { InstructionEntry } from '../models/instruction';
import { atomicWriteJson } from './atomicFs';

export interface IndexSnapshot { entries: InstructionEntry[]; hash: string; }

export class FileIndexRepository {
  /**
   * @param baseDir - Absolute path to the directory containing JSON instruction files
   */
  constructor(private baseDir: string) {}
  /**
   * List all `.json` filenames found in the base directory.
   * @returns Array of filename strings (basename only), or an empty array if the directory is unreadable
   */
  listFiles(){
    try { return fs.readdirSync(this.baseDir).filter(f=> f.endsWith('.json')); } catch { return []; }
  }
  /**
   * Load all instruction entries from disk and compute a content hash of the directory state.
   * @returns Snapshot containing the loaded entries and a SHA-256 content hash
   */
  load(): IndexSnapshot {
    const files = this.listFiles();
    const entries: InstructionEntry[] = [];
    const hash = crypto.createHash('sha256');
    for(const f of files){
      const fp = path.join(this.baseDir, f);
      try {
        const raw = JSON.parse(fs.readFileSync(fp,'utf8')) as InstructionEntry;
        entries.push(raw);
        hash.update(raw.id+':'+(raw.sourceHash||''),'utf8');
      } catch {/* skip */}
    }
    return { entries, hash: hash.digest('hex') };
  }
  /**
   * Atomically write an instruction entry to disk as `<id>.json`.
   * @param entry - Instruction entry to persist
   */
  save(entry: InstructionEntry){
    const fp = path.join(this.baseDir, `${entry.id}.json`);
    atomicWriteJson(fp, entry);
  }
  /**
   * Remove the JSON file for the given instruction ID, if it exists.
   * @param id - Instruction ID whose file should be deleted
   */
  remove(id:string){
    const fp = path.join(this.baseDir, `${id}.json`);
    try { if(fs.existsSync(fp)) fs.unlinkSync(fp); } catch {/* ignore */}
  }
}
