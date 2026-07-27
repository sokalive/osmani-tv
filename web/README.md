# Osmani TV Web

SPA that mirrors the Android Osmani TV experience and talks to the **existing** production API:

- API: `https://api.osmanitv.com`
- Site: `https://osmanitv.com`

## Develop

```bash
cd web
npm install
npm run dev
```

## Build

```bash
npm run build
```

Output: `web/dist`

## Deploy (Contabo / nginx)

```bash
npm run deploy
```

Requires SSH access to the VPS (`OSMANI_VPS_HOST`, `OSMANI_VPS_USER`, `OSMANI_VPS_KEY`).
Nginx for `osmanitv.com` should serve `web/dist` with SPA fallback (`try_files $uri /index.html`).

Do **not** change `admin.osmanitv.com` or `api.osmanitv.com` vhosts.
