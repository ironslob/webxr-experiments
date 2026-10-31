# WebXR Experiments

Small WebXR scenes, published the same way as [mastermind](https://github.com/ironslob/mastermind): GitHub Pages from the `main` branch, project site at [ironslob.github.io/webxr-experiments](https://ironslob.github.io/webxr-experiments/).

| Experiment | Where it runs |
| --- | --- |
| [Sculpture](experiments/sculpture/) | Any browser. Drag to orbit. |
| [Room](experiments/room/) | Desktop preview, or a headset for immersive VR. |
| [Rays](experiments/rays/) | Headset. Controller rays light up the blocks they hit. |
| [Anchor](experiments/anchor/) | Phone AR. Tap a detected surface to place a peg. |

WebXR needs a secure context. GitHub Pages is HTTPS. On your machine, `localhost` counts too.

```bash
python3 -m http.server 8765
```

Open [http://localhost:8765](http://localhost:8765).

Scenes use [three.js](https://threejs.org/) from a CDN, so there is no build step. Pages deploys the files on `main` as they are.

Each experiment is a folder. `index.html` is the landing page: a short description, the settings for that scene, and a Launch button. Launch opens `play.html` with those settings in the query string. The root `index.html` only lists the experiments.

Keep asset URLs relative so the site works both at the domain root locally and under `/webxr-experiments/` on GitHub Pages.
