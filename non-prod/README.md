# Non-production archive

This directory contains recovered experimental code that is intentionally separate from the production app in `../app`.

- `legacy-app/` is a runnable reconstruction of the last browser-cached Babylon.js simulator together with the complete pre-cleanup Labs collection.
- GitHub Pages builds and deploys only `../app`; nothing in this directory is imported by production.
- The Babylon renderer and Lab files were recovered from Vite source maps stored in the local browser cache. The supporting simulator shell is the matching June 19 Babylon-era version; the Labs are the latest August 8 versions found before cleanup.

Run locally:

```sh
cd non-prod/legacy-app
npm install
npm run dev
```

The reconstructed shell deliberately uses Babylon.js only. The standalone Labs retain their original React Three Fiber implementations because that is how those Labs were authored.
