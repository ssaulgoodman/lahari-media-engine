// Diagnostic probe: verifies the container can reach a remote media URL the
// same way Remotion's compositor does (full fetch + HTTP range request).
// Usage: node scripts/probe-media.mjs <url>
//    or: MEDIA_URL=<url> node scripts/probe-media.mjs
// Run it inside the running renderer container:
//   docker exec -it <container> node scripts/probe-media.mjs <url>

const url = process.argv[2] ?? process.env.MEDIA_URL;
if (!url) {
  console.error('usage: node scripts/probe-media.mjs <url>  (or set MEDIA_URL)');
  process.exit(1);
}

const probe = async (label, init) => {
  const t0 = Date.now();
  try {
    const res = await fetch(url, init);
    const elapsed = Date.now() - t0;
    const headers = Object.fromEntries(res.headers);
    let bodyBytes = 0;
    if (res.body) {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bodyBytes += value.byteLength;
      }
    }
    console.log(`--- ${label} ---`);
    console.log('status     :', res.status);
    console.log('elapsedMs  :', elapsed);
    console.log('bytesRead  :', bodyBytes);
    console.log('length hdr :', headers['content-length']);
    console.log('range hdr  :', headers['content-range']);
    console.log('accept-rng :', headers['accept-ranges']);
    console.log('content-typ:', headers['content-type']);
    console.log('cf-cache   :', headers['cf-cache-status']);
    console.log();
  } catch (e) {
    console.log(`--- ${label} (FAILED after ${Date.now() - t0}ms) ---`);
    console.log(e);
    console.log();
  }
};

console.log('URL:', url);
console.log();

await probe('HEAD', { method: 'HEAD' });
await probe('RANGE 0-1MB', { headers: { Range: 'bytes=0-1000000' } });
await probe('FULL GET', {});
