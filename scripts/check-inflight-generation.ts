import assert from 'node:assert/strict';
import {
  beginInFlightGenerations,
  beginInFlightGeneration,
  generationAlreadyRunningError,
  generationKey,
  withInFlightGenerations,
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
assert.equal(duplicateBody.shotId, 'shot-1');

const selectionError = generationAlreadyRunningError('dialogue-audio', 'project-1', 'selection-1', 'dialogue selection') as Error & { statusCode?: number };
const selectionBody = JSON.parse(selectionError.message);
assert.equal(selectionError.statusCode, 409);
assert.equal(selectionBody.targetId, 'selection-1');
assert.equal(selectionBody.shotId, undefined);

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

const releaseMany = beginInFlightGenerations(['look:project-1:a', 'look:project-1:b', 'look:project-1:a']);
assert.equal(typeof releaseMany, 'function');
assert.equal(beginInFlightGeneration('look:project-1:a'), null);
releaseMany?.();
const afterManyA = beginInFlightGeneration('look:project-1:a');
const afterManyB = beginInFlightGeneration('look:project-1:b');
assert.equal(typeof afterManyA, 'function');
assert.equal(typeof afterManyB, 'function');
afterManyA?.();
afterManyB?.();

let unblockMany!: () => void;
const manyBlocker = new Promise<void>((resolve) => { unblockMany = resolve; });
const firstMany = withInFlightGenerations(
  ['dialogue:project-1:a', 'dialogue:project-1:b'],
  { kind: 'dialogue-audio', projectId: 'project-1', targetId: 'selection-1', targetLabel: 'dialogue selection' },
  async () => {
    await manyBlocker;
    return 'many-done';
  },
);
await assert.rejects(
  () => withInFlightGenerations(
    ['dialogue:project-1:b'],
    { kind: 'dialogue-audio', projectId: 'project-1', targetId: 'selection-2', targetLabel: 'dialogue selection' },
    async () => 'duplicate-many',
  ),
  (err: any) => err?.statusCode === 409 && JSON.parse(err.message).code === 'generation_already_running',
);
unblockMany();
assert.equal(await firstMany, 'many-done');

console.log('in-flight generation guard contract ok');
