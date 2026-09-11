import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBackendPrivateKey} from '../lib/slot/backend-key';

test('an empty key or deployment placeholder cannot enable the keeper', () => {
  for (const value of ['', ' ', 'REPLACE_ME', ' REPLACE_ME\n']) {
    assert.equal(loadBackendPrivateKey(value), undefined);
  }
});

test('invalid backend keys fail without disclosing the supplied value', () => {
  for (const value of ['invalid-secret', '0x' + '0'.repeat(64), '0x' + 'f'.repeat(64)]) {
    assert.throws(() => loadBackendPrivateKey(value), {message: 'Invalid backend wallet configuration'});
  }
});

test('a valid test key is returned unchanged', () => {
  // Public test scalar; never used by the application or a live deployment.
  const key = '0x' + '1'.padStart(64, '0');
  assert.equal(loadBackendPrivateKey(key), key);
});
