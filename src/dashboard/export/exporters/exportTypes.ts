/**
 * Shared types for the DataExporter and format-specific exporter modules.
 */

export interface ExportConfig {
  id: string;
  name: string;
  format: 'json' | 'csv' | 'excel' | 'pdf' | 'xml';
  dataSource: 'metrics' | 'analytics' | 'security' | 'feedback' | 'instructions' | 'custom';
  filters: ExportFilter[];
  columns: ExportColumn[];
  schedule?: ExportSchedule;
  template?: string;
  compression: boolean;
  encryption: boolean;
  destination: ExportDestination;
}

export interface ExportFilter {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'between' | 'in' | 'not_in';
  value: unknown;
  values?: unknown[];
}

export interface ExportColumn {
  field: string;
  header: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'json';
  format?: string;
  aggregation?: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'group';
}

export interface ExportSchedule {
  enabled: boolean;
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';
  interval: number;
  time?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  timezone: string;
  lastRun?: number;
  nextRun?: number;
}

export interface ExportDestination {
  type: 'local' | 'email' | 'ftp' | 'sftp' | 's3' | 'azure_blob' | 'webhook';
  config: Record<string, unknown>;
}

export interface ExportJob {
  id: string;
  configId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  recordsProcessed: number;
  totalRecords: number;
  startTime: number;
  endTime?: number;
  error?: string;
  outputPath?: string;
  fileSize?: number;
}

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  type: 'dashboard_summary' | 'security_report' | 'performance_analysis' | 'custom';
  sections: ReportSection[];
  formatting: ReportFormatting;
}

export interface ReportSection {
  id: string;
  title: string;
  type: 'text' | 'table' | 'chart' | 'metrics' | 'raw_data';
  dataSource: string;
  config: Record<string, unknown>;
  order: number;
}

export interface ReportFormatting {
  pageSize: 'A4' | 'Letter' | 'Legal' | 'A3';
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
  fontSize: number;
  fontFamily: string;
  includeHeader: boolean;
  includeFooter: boolean;
  headerText?: string;
  footerText?: string;
}
