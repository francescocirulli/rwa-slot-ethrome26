export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.ENS_REGISTRAR_ADDRESS) {
    const {ensApi} = await import('./lib/ens/runtime');
    try {ensApi();} catch {console.error('ENS configuration unavailable.');}
  }
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.ARKIV_ENABLED === 'true') {
    const {getSeasonService} = await import('./lib/arkiv/runtime');
    try {getSeasonService();} catch {console.error('Arkiv season configuration unavailable.');}
  }
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.SLOT_CONTRACT_ADDRESS) {
    const {getSlotEngine} = await import('./lib/slot/runtime');
    getSlotEngine();
  }
}
