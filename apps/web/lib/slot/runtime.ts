import {loadSlotConfig} from './config';
import {createSlotReader} from './reader';
import {createSlotEngine} from './engine';
import {loadBackendPrivateKey} from './backend-key';
const global = globalThis as typeof globalThis & {slotEngine?: ReturnType<typeof createSlotEngine>};
export function getSlotEngine() {
  if (!global.slotEngine) {
    const config = loadSlotConfig(); if (!config) return null;
    global.slotEngine = createSlotEngine(createSlotReader(config), loadBackendPrivateKey());
    global.slotEngine.startKeeper();
  }
  return global.slotEngine;
}
