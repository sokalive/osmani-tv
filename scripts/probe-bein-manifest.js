const url =
  'https://osmani-admin-api.onrender.com/stream-proxy?url=' +
  encodeURIComponent(
    'http://het103b.ycn-redirect.com/live/918454578001/index.m3u8?t=MBre3gSpc0mKfG1QczG4kg&e=1768639865',
  );

function unwrap(u) {
  if (!u.includes('stream-proxy')) return u;
  try {
    return decodeURIComponent(new URL(u).searchParams.get('url'));
  } catch {
    return u;
  }
}

fetch(url)
  .then((r) => r.text())
  .then((t) => {
    const lines = t
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    const proxy = lines.filter((l) => l.includes('stream-proxy'));
    const unwrapped = lines.map(unwrap);
    console.log('lines', lines.length);
    console.log('stream-proxy in manifest', proxy.length);
    console.log('raw sample', lines.slice(0, 4));
    console.log('unwrapped sample', unwrapped.slice(0, 4));
    console.log(
      'bunny /hls/seg after unwrap',
      unwrapped.filter((u) => /b-cdn\.net\/hls\/seg/i.test(u)).length,
    );
    console.log(
      'het103 .ts after unwrap',
      unwrapped.filter((u) => /\.ts(\?|$)/i.test(u)).length,
    );
  });
