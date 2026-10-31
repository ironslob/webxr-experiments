# WebXR Experiments

A Quest 3 passthrough scene, published the same way as [mastermind](https://github.com/ironslob/mastermind): GitHub Pages from the `main` branch, project site at [ironslob.github.io/webxr-experiments](https://ironslob.github.io/webxr-experiments/).

[Walls](experiments/walls/) asks for an `immersive-ar` session and the room’s detected planes. Each vertical plane, usually a wall from Space Setup, is drawn as its own translucent color.

Open that page in the Quest browser. The headset needs a room scan. If it has none, the session can start one.

WebXR needs a secure context. GitHub Pages is HTTPS. On your machine, `localhost` counts too, but passthrough only runs on the headset.

```bash
python3 -m http.server 8765
```

The scene uses [three.js](https://threejs.org/) from a CDN, so there is no build step. Pages deploys the files on `main` as they are.

Each experiment is a folder. `index.html` is the landing page: a short description, the settings for that scene, and a Launch button. Launch opens `play.html` with those settings in the query string. The root `index.html` only lists the experiments.

Keep asset URLs relative so the site works both at the domain root locally and under `/webxr-experiments/` on GitHub Pages.
