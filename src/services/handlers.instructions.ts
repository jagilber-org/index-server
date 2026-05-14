// handlers.instructions.ts — barrel re-export (thin coordinator)
import './handlers/instructions.add';
import './handlers/instructions.import';
import './handlers/instructions.remove';
import './handlers/instructions.patch';
import './handlers/instructions.reload';
import './handlers/instructions.groom';
import './handlers/instructions.query';
import './handlers/instructions.archive';

// Re-export instructionActions for instructions.dispatcher.ts back-compat
export { instructionActions } from './handlers/instructions.query';
