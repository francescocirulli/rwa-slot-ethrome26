export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.SLOT_CONTRACT_ADDRESS) {
    const {getSlotEngine} = await import('./lib/slot/runtime');
    getSlotEngine();
  }
}
