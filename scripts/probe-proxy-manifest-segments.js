/**
 * Compare segment lines in manifests fetched via Render vs Bunny stream-proxy.
 */
const RENDER =
  'https://osmani-admin-api.onrender.com/stream-proxy?url=' +
  encodeURIComponent('https://nur.mpingotv.com/v3/player.php?channel=1');
const BUNNY =
  'https://osmanitv.b-cdn.net/stream-proxy?url=' +
  encodeURIComponent('https://nur.mpingotv.com/v3/player.php?channel=1');

function analyze(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  return {
    total: lines.length,
    streamProxy: lines.filter((l) => l.includes('stream-proxy')).length,
    bunnySeg: lines.filter((l) => /b-cdn\.net\/hls\/seg\?tok=/i.test(l)).length,
    renderHost: lines.filter((l) => l.includes('onrender.com')).length,
    sample: lines.slice(0, 4),
  };
}

async function probe(label, url) {
  const res = await fetch(url);
  const text = await res.text();
  console.log(label, { status: res.status, ...analyze(text) });
}

(async () => {
  await probe('render_proxy_manifest', RENDER);
  await probe('bunny_cdn_proxy_manifest', BUNNY);
})();
