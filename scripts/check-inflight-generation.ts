import assert from 'node:assert/strict';
import {
  beginInFlightGeneration,
  generationAlreadyRunningError,
  generationKey,
  withInFlightGeneration,
} from '../server/services/inFlightGeneration.js';

const key = generationKey('video', 'project-1', 'shot-1');
const release = beginInFlightGeneration(key);
assert.equal(typeof release, 'function');
assert.equal(beginInFlightGeneration(key), null);
release?.();

const relocked = beginInFlightGeneration(key);
assert.equal(typeof relocked, 'function');
relocked?.();

const duplicate = generationAlreadyRunningError('video', 'project-1', 'shot-1') as Error & { statusCode?: number };
assert.equal(duplicate.statusCode, 409);
const duplicateBody = JSON.parse(duplicate.message);
assert.equal(duplicateBody.code, 'generation_already_running');
assert.equal(duplicateBody.kind, 'video');

let unblock!: () => void;
const blocker = new Promise<void>((resolve) => { unblock = resolve; });
const first = withInFlightGeneration(key, { kind: 'video', projectId: 'project-1', shotId: 'shot-1' }, async () => {
  await blocker;
  return 'done';
});
await assert.rejects(
  () => withInFlightGeneration(key, { kind: 'video', projectId: 'project-1', shotId: 'shot-1' }, async () => 'duplicate'),
  (err: any) => err?.statusCode === 409 && JSON.parse(err.message).code === 'generation_already_running',
);
unblock();
assert.equal(await first, 'done');

await assert.rejects(
  () => withInFlightGeneration('image:project-1:shot-2', { kind: 'image', projectId: 'project-1', shotId: 'shot-2' }, async () => {
    throw new Error('boom');
  }),
  /boom/,
);
const afterFailure = beginInFlightGeneration('image:project-1:shot-2');
assert.equal(typeof afterFailure, 'function');
afterFailure?.();

console.log('in-flight generation guard contract ok');
