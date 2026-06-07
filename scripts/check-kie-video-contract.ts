import assert from 'node:assert/strict';
import { __kieVideoTest, KIE_MODELS } from '../server/services/kie-video.js';
import { resolveVideoModelSpec } from '../server/services/video-provider.js';

const { resultUrlsFrom } = __kieVideoTest;

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

assert.equal(KIE_MODELS['kie-veo3-fast'].supportsLastFrame, true);
assert.equal(resolveVideoModelSpec('kie-veo3-fast').provider, 'kie');
assert.equal(resolveVideoModelSpec('kie-veo3-fast').supportsLastFrame, true);
assert.equal(resolveVideoModelSpec('kie-veo3-fast').supportsRefs, false);

console.log('Kie video contract check passed');
