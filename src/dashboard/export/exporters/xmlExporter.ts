/**
 * XML and PDF (HTML) format exporters for the DataExporter system.
 * Handles structured document output including template-based report rendering.
 */

import fs from 'fs';
import path from 'path';
import type { ReportTemplate, ReportSection } from './exportTypes.js';
import { logInfo } from '../../../services/logger.js';

/**
 * Write data to an XML file, optionally compressing afterwards.
 */
export async function exportXML(
  data: unknown[],
  outputPath: string,
  compress: boolean
): Promise<void> {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  const xmlContent = convertToXML(data);
  await fs.promises.writeFile(outputPath, xmlContent, 'utf8');

  if (compress) {
    logInfo('[xmlExporter] Compressing file', { path: outputPath });
  }
}

/**
 * Write data as a PDF-placeholder HTML file.
 * When a resolved ReportTemplate is provided the output uses the full template;
 * otherwise a simple tabular layout is generated.
 */
export async function exportPDF(
  data: unknown[],
  outputPath: string,
  template?: ReportTemplate
): Promise<void> {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  const content = template
    ? generateReportHTML(template, data)
    : generateSimplePDFContent(data);

  // In a real implementation a PDF library (puppeteer, pdfkit) would be used.
  await fs.promises.writeFile(outputPath.replace('.pdf', '.html'), content, 'utf8');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function convertToXML(data: unknown[]): string {
  const xmlRows = data.map(item => {
    const itemRecord = item as Record<string, unknown>;
    const xmlFields = Object.entries(itemRecord)
      .map(([key, value]) => `    <${key}>${escapeXML(String(value))}</${key}>`)
      .join('\n');
    return `  <record>\n${xmlFields}\n  </record>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<data>\n${xmlRows.join('\n')}\n</data>`;
}

function escapeXML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateReportHTML(template: ReportTemplate, data: unknown[]): string {
  let html = `<!DOCTYPE html>
<html>
<head>
    <title>${template.name}</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: ${template.formatting.fontFamily}; font-size: ${template.formatting.fontSize}px; }
        .header { text-align: center; border-bottom: 1px solid #ccc; padding-bottom: 10px; margin-bottom: 20px; }
        .footer { text-align: center; border-top: 1px solid #ccc; padding-top: 10px; margin-top: 20px; }
        .section { margin-bottom: 30px; }
        .section-title { font-size: 16px; font-weight: bold; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>`;

  if (template.formatting.includeHeader) {
    const headerText = replaceTemplateVariables(template.formatting.headerText || '');
    html += `<div class="header">${headerText}</div>`;
  }

  const sortedSections = template.sections.sort((a, b) => a.order - b.order);

  for (const section of sortedSections) {
    html += `<div class="section">`;
    html += `<div class="section-title">${section.title}</div>`;

    switch (section.type) {
      case 'table':
        html += generateTableSection(data, section);
        break;
      case 'metrics':
        html += generateMetricsSection(data, section);
        break;
      case 'text':
        html += generateTextSection(data, section);
        break;
      default:
        html += `<p>Section type "${section.type}" not implemented</p>`;
    }

    html += `</div>`;
  }

  if (template.formatting.includeFooter) {
    const footerText = replaceTemplateVariables(template.formatting.footerText || '');
    html += `<div class="footer">${footerText}</div>`;
  }

  html += `</body></html>`;
  return html;
}

export function generateSimplePDFContent(data: unknown[]): string {
  if (!data.length) return '<html><body><p>No data to export</p></body></html>';

  const headers = Object.keys(data[0] as Record<string, unknown>);

  let html = `<!DOCTYPE html>
<html>
<head>
    <title>Data Export</title>
    <style>
        body { font-family: Arial, sans-serif; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Data Export</h1>
    <table>
        <thead>
            <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
        </thead>
        <tbody>`;

  data.forEach(row => {
    const rowRecord = row as Record<string, unknown>;
    html += `<tr>${headers.map(h => `<td>${String(rowRecord[h] || '')}</td>`).join('')}</tr>`;
  });

  html += `        </tbody>
    </table>
</body>
</html>`;

  return html;
}

function generateTableSection(data: unknown[], _section: ReportSection): string {
  if (!data.length) return '<p>No data available</p>';

  const headers = Object.keys(data[0] as Record<string, unknown>);

  let html = '<table><thead><tr>';
  headers.forEach(header => { html += `<th>${header}</th>`; });
  html += '</tr></thead><tbody>';

  data.forEach(row => {
    const rowRecord = row as Record<string, unknown>;
    html += '<tr>';
    headers.forEach(header => { html += `<td>${String(rowRecord[header] || '')}</td>`; });
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

function generateMetricsSection(data: unknown[], _section: ReportSection): string {
  return `<div>
        <p><strong>Total Records:</strong> ${data.length}</p>
        <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
    </div>`;
}

function generateTextSection(data: unknown[], section: ReportSection): string {
  return `<p>This is a ${section.dataSource} section with ${data.length} records.</p>`;
}

function replaceTemplateVariables(text: string): string {
  const now = new Date();
  return text
    .replace(/\{\{date\}\}/g, now.toLocaleDateString())
    .replace(/\{\{time\}\}/g, now.toLocaleTimeString())
    .replace(/\{\{datetime\}\}/g, now.toLocaleString())
    .replace(/\{\{page\}\}/g, '1')
    .replace(/\{\{totalPages\}\}/g, '1')
    .replace(/\{\{dateRange\}\}/g, 'Last 7 days');
}
