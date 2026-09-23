import { contextBridge } from 'electron';

// Placeholder until Task 4.5 exposes the ledger IPC API.
contextBridge.exposeInMainWorld('ledger', {});
