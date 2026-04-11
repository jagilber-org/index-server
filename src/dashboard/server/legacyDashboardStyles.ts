/**
 * legacyDashboardStyles — CSS for the v1 legacy dashboard page.
 * Kept in a separate module so legacyDashboardHtml.ts stays within line limits.
 */

export const LEGACY_DASHBOARD_CSS = `
        /* Phase 2 Enhanced Styles */
        :root {
            --primary-color: #2c3e50;
            --secondary-color: #3498db;
            --accent-color: #3b82f6;
            --accent-hover: #2563eb;
            --success-color: #27ae60;
            --warning-color: #f39c12;
            --error-color: #e74c3c;
            --bg-primary: #f8f9fa;
            --bg-secondary: #e9ecef;
            --card-bg: #ffffff;
            --border-color: #dee2e6;
            --text-primary: #2c3e50;
            --text-secondary: #6c757d;
            --text-muted: #adb5bd;
            --shadow-sm: 0 1px 3px rgba(0,0,0,0.12);
            --shadow-lg: 0 4px 15px rgba(0,0,0,0.08);
            --shadow-xl: 0 10px 25px rgba(0,0,0,0.12);
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
        }

        .header {
            background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
            color: white;
            padding: 2rem 0;
            text-align: center;
            box-shadow: var(--shadow-lg);
        }

        .header h1 {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
        }

        .header .subtitle {
            font-size: 1.1rem;
            opacity: 0.9;
        }

        .header .version {
            font-size: 0.9rem;
            opacity: 0.7;
            margin-top: 0.5rem;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
        }

        /* Dashboard Controls */
        .dashboard-controls {
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
            margin-bottom: 2rem;
            padding: 1.5rem;
            background: var(--card-bg);
            border-radius: 12px;
            border: 1px solid var(--border-color);
            box-shadow: var(--shadow-sm);
        }

        .control-group {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }

        .control-label {
            font-size: 0.875rem;
            font-weight: 500;
            color: var(--text-secondary);
        }

        .control-button {
            padding: 0.5rem 1rem;
            background: var(--accent-color);
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .control-button:hover {
            background: var(--accent-hover);
            transform: translateY(-1px);
        }

        /* Connection Status */
        .connection-status {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-size: 0.875rem;
            font-weight: 500;
            transition: all 0.3s ease;
        }

        .connection-status::before {
            content: '';
            width: 8px;
            height: 8px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }

        .connection-status.connected {
            background: rgba(34, 197, 94, 0.1);
            color: #16a34a;
            border: 1px solid rgba(34, 197, 94, 0.2);
        }

        .connection-status.connected::before {
            background: #16a34a;
        }

        .connection-status.disconnected {
            background: rgba(239, 68, 68, 0.1);
            color: #dc2626;
            border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .connection-status.disconnected::before {
            background: #dc2626;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        /* Status Cards */
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }

        .status-card {
            background: var(--card-bg);
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: var(--shadow-lg);
            border: 1px solid var(--border-color);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .status-card:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-xl);
        }

        .status-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: var(--accent-color);
        }

        .status-label {
            font-size: 0.875rem;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
            font-weight: 500;
        }

        .status-value {
            font-size: 2rem;
            font-weight: 700;
            color: var(--primary-color);
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        }

        .status-online { color: var(--success-color); }
        .status-warning { color: var(--warning-color); }
        .status-error { color: var(--error-color); }

        /* Charts Grid */
        .charts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 2rem;
            margin-bottom: 2rem;
        }

        .chart-container {
            position: relative;
            height: 350px;
            background: var(--card-bg);
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: var(--shadow-lg);
            border: 1px solid var(--border-color);
            transition: all 0.3s ease;
        }

        .chart-container:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-xl);
        }

        .chart-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 1rem;
            text-align: center;
        }

        .chart-wrapper {
            position: relative;
            height: 280px;
            width: 100%;
        }

        /* Phase 3 Chart Controls */
        .charts-controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            padding: 1rem;
            background: var(--card-bg);
            border-radius: 8px;
            border: 1px solid var(--border-color);
        }

        .time-range-selector {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .time-range-selector label {
            font-weight: 500;
            color: var(--text-secondary);
        }

        .time-range-select {
            padding: 0.5rem 1rem;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            background: var(--bg-color);
            color: var(--text-primary);
            font-size: 0.9rem;
        }

        .chart-actions {
            display: flex;
            gap: 0.5rem;
        }

        .action-btn {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 6px;
            background: var(--primary-color);
            color: white;
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .action-btn:hover {
            background: var(--primary-hover);
            transform: translateY(-1px);
        }

        .chart-status {
            float: right;
            font-size: 0.8rem;
            color: #28a745;
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        /* Performance Metrics */
        .performance-metrics {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }

        .metric-item {
            background: var(--card-bg);
            border-radius: 8px;
            padding: 1.5rem;
            border: 1px solid var(--border-color);
            transition: all 0.3s ease;
            position: relative;
            box-shadow: var(--shadow-sm);
        }

        .metric-item::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            border-radius: 8px 8px 0 0;
            background: var(--border-color);
            transition: all 0.3s ease;
        }

        .metric-item.metric-success::before {
            background: var(--success-color);
        }

        .metric-item.metric-warning::before {
            background: var(--warning-color);
        }

        .metric-item.metric-danger::before {
            background: var(--error-color);
        }

        .metric-label {
            font-size: 0.875rem;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
        }

        .metric-value {
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--text-primary);
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        }

        /* Tools Section */
        .tools-section {
            background: var(--card-bg);
            border-radius: 12px;
            padding: 1.5rem;
            border: 1px solid var(--border-color);
            margin-bottom: 2rem;
            box-shadow: var(--shadow-lg);
        }

        .tools-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            gap: 1rem;
        }

        .tools-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--primary-color);
        }

        .tools-filter {
            flex: 1;
            max-width: 300px;
            padding: 0.5rem 1rem;
            border: 1px solid var(--border-color);
            border-radius: 8px;
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 0.875rem;
        }

        .tools-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.875rem;
        }

        .tools-table th {
            background: var(--bg-secondary);
            color: var(--text-secondary);
            font-weight: 600;
            padding: 0.75rem;
            text-align: left;
            border-bottom: 2px solid var(--border-color);
        }

        .tools-table td {
            padding: 0.75rem;
            border-bottom: 1px solid var(--border-color);
            color: var(--text-primary);
        }

        .tools-table tr:hover {
            background: var(--bg-secondary);
        }

        .tool-name {
            font-weight: 500;
            color: var(--accent-color);
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        }

        .tool-calls,
        .tool-success {
            color: var(--success-color);
            font-weight: 500;
        }

        .tool-errors {
            color: var(--error-color);
            font-weight: 500;
        }

        .tool-response-time {
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        }

        .tool-last-called {
            color: var(--text-secondary);
            font-size: 0.8rem;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            .container {
                padding: 1rem;
            }

            .dashboard-controls {
                flex-direction: column;
            }

            .charts-grid {
                grid-template-columns: 1fr;
                gap: 1rem;
            }

            .charts-grid .chart-container {
                height: 300px;
                padding: 1rem;
            }

            .tools-header {
                flex-direction: column;
                align-items: stretch;
            }

            .tools-filter {
                max-width: none;
            }

            .performance-metrics {
                grid-template-columns: 1fr;
            }
        }
`;
