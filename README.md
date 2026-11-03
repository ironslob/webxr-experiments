# WebXR Experiments

A Quest 3 passthrough scene, published the same way as [mastermind](https://github.com/ironslob/mastermind): GitHub Pages from the `main` branch, project site at [ironslob.github.io/webxr-experiments](https://ironslob.github.io/webxr-experiments/).

[Walls](experiments/1-walls/) asks for an `immersive-ar` session and the room’s detected planes. Each vertical plane, usually a wall from Space Setup, is drawn as its own translucent color.

[Balls](experiments/2-balls/) drops colored balls into the room scan. They bounce off the planes you pick; gravity and controller poke/grab are launch settings.

[Heads](experiments/3-heads/) is that same scene with a GLB head in place of each ball. Collision stays a sphere sized to the model.

[Blast](experiments/4-blast/) mixes several GLB models at chosen or random sizes. A solid hit turns one into a firework and respawns it elsewhere.

[Viz](experiments/5-viz/) floats geometric shapes and models in the room and drives them from the microphone or a demo beat — pulse, stretch, spin, flash, hop, each object with a random mix of reactions.

Open that page in the Quest browser. The control list is on the page, above Enter AR. Inside the headset, B or Y leaves the session. The Meta button on the right controller opens the system menu. The headset needs a room scan. If it has none, the session can start one.

WebXR needs a secure context. GitHub Pages is HTTPS. On your machine, `localhost` counts too, but passthrough only runs on the headset.

```bash
python3 -m http.server 8765
```

Each experiment has a **Dev reload** checkbox in settings. Turn it on to poll the page and reload when files change. `?dev` in the URL does the same (`?dev=2000` sets the poll interval in milliseconds).

The scene uses [three.js](https://threejs.org/) from a CDN, so there is no build step. Pages deploys the files on `main` as they are.

Each experiment is a folder. Its `index.html` describes the scene, shows the settings, lists the controls, and starts the session from that button press. The root `index.html` only lists the experiments.

Keep asset URLs relative so the site works both at the domain root locally and under `/webxr-experiments/` on GitHub Pages.
