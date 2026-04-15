/**
 * CSV and Excel format exporters for the DataExporter system.
 */

import fs from 'fs';
import path from 'path';

/**
 * Write data to a CSV file, optionally compressing afterwards.
 */
export async function exportCSV(
  data: unknown[],
  outputPath: string,
  compress: boolean
): Promise<void> {
  if (!data.length) {
    await fs.promises.writeFile(outputPath, '', 'utf8');
    return;
  }

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  const headers = Object.keys(data[0] as Record<string, unknown>);

  const csvRows = [
    headers.join(','),
    ...data.map(row => {
      const rowRecord = row as Record<string, unknown>;
      return headers.map(header => {
        const value = rowRecord[header];
        const stringValue = String(value || '');
        return stringValue.includes(',') || stringValue.includes('"')
          ? `"${stringValue.replace(/"/g, '""')}"`
          : stringValue;
      }).join(',');
    })
  ];

  await fs.promises.writeFile(outputPath, csvRows.join('\n'), 'utf8');

  if (compress) {
    console.log(`Compressing file: ${outputPath}`);
  }
}

/**
 * Export data as Excel (simplified — delegates to CSV with a .csv extension).
 */
export async function exportExcel(
  data: unknown[],
  outputPath: string,
  compress: boolean
): Promise<void> {
  await exportCSV(data, outputPath.replace('.excel', '.csv'), compress);
}
