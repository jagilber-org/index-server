// CLI runner for performance baseline measurement
import { runPerformanceBaseline } from '../services/performanceBaseline';

async function main() {
  try {
    const results = await runPerformanceBaseline();
    process.exit(results.summary.meetsTarget ? 0 : 1);
  } catch (error) {
    console.error('❌ Performance baseline failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
