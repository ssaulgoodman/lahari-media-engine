import 'dotenv/config';
import assert from 'node:assert/strict';
import { __segmindVideoTest } from '../server/services/segmind.js';

const {
  inferMediaMime,
  isSegmindAssetUrl,
  prepareSegmindRequest,
  stageSegmindVideoBody,
} = __segmindVideoTest;

const veo = prepareSegmindRequest('images/start.jpg', 'A woman speaks to camera.', {
  modelKey: 'veo-3.1',
  durationSec: 15,
  resolution: '720p',
  aspectRatio: '9:16',
  generateAudio: true,
  referenceImagePaths: ['images/ref.jpg'],
});

assert.equal(veo.modelKey, 'veo-3.1');
assert.equal(veo.durationSec, 8);
assert.deepEqual(Object.keys(veo.body).sort(), [
  'aspect_ratio',
  'duration',
  'generate_audio',
  'image',
  'prompt',
  'resolution',
  'seed',
]);
assert.equal(veo.body.aspect_ratio, '9:16');
assert.equal(veo.body.generate_audio, true);
assert.ok(veo.body.image);
assert.equal(veo.body.reference_images, undefined);

assert.equal(inferMediaMime(Buffer.from([0xff, 0xd8, 0xff, 0xdb])), 'image/jpeg');
assert.equal(inferMediaMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
assert.equal(isSegmindAssetUrl('https://storage.segmind.com/assets/a.jpg'), true);
assert.equal(isSegmindAssetUrl('https://example.com/a.jpg'), false);

const originalFetch = globalThis.fetch;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0xff, 0xd9]);
let uploadCalled = false;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  if (url === 'https://source.example.com/start.jpg') {
    return new Response(jpeg, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
  }
  if (url === 'https://workflows-api.segmind.com/upload-asset') {
    uploadCalled = true;
    const body = JSON.parse(String(init?.body || '{}'));
    assert.ok(String(body.data_urls?.[0] || '').startsWith('data:image/jpeg;base64,'));
    assert.equal((init?.headers as Record<string, string>)?.['x-api-key'], 'SG_TEST');
    return new Response(JSON.stringify({ urls: ['https://storage.segmind.com/assets/staged-start.jpg'] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error(`Unexpected fetch: ${url}`);
}) as typeof fetch;

try {
  const staged = await stageSegmindVideoBody({
    image: 'https://source.example.com/start.jpg',
    reference_images: ['https://storage.segmind.com/assets/already-staged.jpg'],
    prompt: 'A woman speaks to camera.',
  }, 'SG_TEST');

  assert.equal(staged.stagedCount, 1);
  assert.equal(uploadCalled, true);
  assert.equal(staged.body.image, 'https://storage.segmind.com/assets/staged-start.jpg');
  assert.deepEqual(staged.body.reference_images, ['https://storage.segmind.com/assets/already-staged.jpg']);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Segmind video contract check passed.');
