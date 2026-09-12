// One background reserve check per service, never awaited by balance/result polls.
export function createPrizeAvailability(read: () => Promise<{ready: boolean}>, now = Date.now) {
  let state: 'checking' | 'ready' | 'restocking' | 'unavailable' = 'checking';
  let expires = 0, revision = 0, pending: Promise<void> | undefined;
  function record(ready: boolean) {
    revision++; state = ready ? 'ready' : 'restocking'; expires = now() + 15000;
  }
  function invalidate() {revision++; expires = 0; state = 'checking';}
  function view() {
    if (now() >= expires && !pending) {
      const generation = revision;
      if (state === 'ready') state = 'checking';
      pending = Promise.resolve().then(read).then(result => {
        if (generation === revision) record(result.ready);
      }).catch(() => {
        if (generation === revision) {state = 'unavailable'; expires = now() + 15000;}
      }).finally(() => {pending = undefined;});
    }
    return {state};
  }
  return {view, record, invalidate};
}
