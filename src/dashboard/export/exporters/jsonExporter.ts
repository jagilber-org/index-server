/**
 * JSON format exporter for the DataExporter system.
 */

import fs from 'fs';
import path from 'path';

/**
 * Write data to a JSON file, optionally compressing afterwards.
 */
export async function exportJSON(
  data: unknown[],
  outputPath: string,
  compress: boolean
): Promise<void> {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  const jsonData = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(outputPath, jsonData, 'utf8');

  if (compress) {
    console.log(`Compressing file: ${outputPath}`);
  }
}
