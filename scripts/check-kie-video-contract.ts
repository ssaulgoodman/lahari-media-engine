import assert from 'node:assert/strict';
import { __kieVideoTest, KIE_MODELS } from '../server/services/kie-video.js';
import { resolveVideoModelSpec } from '../server/services/video-provider.js';

const { buildSubmitRequest, resultUrlsFrom } = __kieVideoTest;

assert.deepEqual(
  resultUrlsFrom({
    successFlag: 1,
    response: {
      resultUrls: ['https://example.com/generated.mp4'],
      originUrls: ['https://example.com/original.mp4'],
      resolution: '1080p',
    },
  }),
  ['https://example.com/generated.mp4'],
);

assert.deepEqual(
  resultUrlsFrom({
    successFlag: 1,
    info: {
      resultUrls: ['https://example.com/callback.mp4'],
    },
  }),
  ['https://example.com/callback.mp4'],
);

assert.deepEqual(
  resultUrlsFrom({
    resultUrls: '["https://example.com/legacy.mp4"]',
  }),
  ['https://example.com/legacy.mp4'],
);

assert.deepEqual(
  resultUrlsFrom({
    state: 'success',
    resultJson: JSON.stringify({
      resultUrls: ['https://example.com/omni.mp4'],
    }),
  }),
  ['https://example.com/omni.mp4'],
);

const omniSubmit = buildSubmitRequest(
  'kie-gemini-omni-video',
  'A direct-to-camera creator speaks in a podcast studio.',
  '9:16',
  6,
  'https://example.com/start.png',
  {
    referenceImageUrls: [
      'https://example.com/character.png',
      'https://example.com/studio.png',
      'not-a-url',
    ],
  },
);

assert.equal(omniSubmit.url.endsWith('/jobs/createTask'), true);
assert.equal(omniSubmit.body.model, 'gemini-omni-video');
assert.deepEqual(omniSubmit.body.input.image_urls, [
  'https://example.com/start.png',
  'https://example.com/character.png',
  'https://example.com/studio.png',
]);
assert.equal(omniSubmit.body.input.duration, '6');
assert.equal(omniSubmit.body.input.aspect_ratio, '9:16');

assert.equal(KIE_MODELS['kie-veo3-fast'].supportsLastFrame, true);
assert.equal(resolveVideoModelSpec('kie-veo3-fast').provider, 'kie');
assert.equal(resolveVideoModelSpec('kie-veo3-fast').supportsLastFrame, true);
assert.equal(resolveVideoModelSpec('kie-veo3-fast').supportsRefs, false);
assert.equal(KIE_MODELS['kie-gemini-omni-video'].api, 'market');
assert.equal(resolveVideoModelSpec('kie-gemini-omni-video').provider, 'kie');
assert.equal(resolveVideoModelSpec('kie-gemini-omni-video').supportsRefs, true);
assert.equal(resolveVideoModelSpec('kie-gemini-omni-video').refsWithFrames, true);

console.log('Kie video contract check passed');
