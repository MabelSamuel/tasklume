import { EventEmitter } from 'events';

// One emitter for the entire application
export const appEvents = new EventEmitter();

// Increase the default limit if you have many listeners.
// Node warns at 11+ listeners per event. 20 is plenty for us.
appEvents.setMaxListeners(20);
