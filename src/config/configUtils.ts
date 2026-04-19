/**
 * Shared low-level utilities used by config domain modules.
 * No imports from other local config files — safe to import anywhere.
 */
import path from 'path';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export const CWD = process.cwd();

export function toAbsolute(raw: string | undefined, fallback?: string): string {
  if(raw && raw.trim().length){
    return path.isAbsolute(raw) ? raw : path.resolve(CWD, raw);
  }
  if(fallback && fallback.trim().length){
    return path.isAbsolute(fallback) ? fallback : path.resolve(CWD, fallback);
  }
  return CWD;
}

export function numberFromEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if(!raw) return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) ? value : defaultValue;
}

export function optionalNumberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if(raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function floatFromEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if(!raw) return defaultValue;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : defaultValue;
}

export function optionalIntFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if(raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

export function clamp(value: number, min: number, max: number): number {
  if(value < min) return min;
  if(value > max) return max;
  return value;
}

export function stringFromEnv(name: string, defaultValue: string): string {
  const raw = process.env[name];
  if(raw && raw.trim().length) return raw;
  return defaultValue;
}

export function parseCsvEnv(name: string): string[] {
  const raw = process.env[name];
  if(!raw) return [];
  return raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

export function parseJSONMaybe<T = unknown>(src?: string): T | undefined {
  if(!src) return undefined;
  try { return JSON.parse(src) as T; } catch { return undefined; }
}
