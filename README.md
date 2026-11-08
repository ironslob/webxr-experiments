# WebXR Experiments

Small [Quest 3](https://www.meta.com/quest/quest-3/) AR scenes that run in your room through the headset’s passthrough camera.

**[Open the live site →](https://ironslob.github.io/webxr-experiments/)**

## Try it

1. Put on a Quest 3 and open the **Meta Browser**.
2. Go to [ironslob.github.io/webxr-experiments](https://ironslob.github.io/webxr-experiments/).
3. Pick an experiment, check the settings and controls, then tap **Enter AR**.

You’ll need a room scan (Space Setup). If the headset doesn’t have one yet, most scenes can start one for you.

Inside a session:

- **B** (right controller) or **Y** (left) ends the experience.
- The **Meta** button opens the system menu if you need another way out.

These pages only start immersive AR on a Quest. A phone or laptop can show the setup screen, but not the room overlay.

## Experiments

| | What it does |
| --- | --- |
| [Walls](https://ironslob.github.io/webxr-experiments/experiments/1-walls/) | Colors each wall from the room scan with its own translucent tint. |
| [Balls](https://ironslob.github.io/webxr-experiments/experiments/2-balls/) | Drops bouncing colored balls into the room. Poke them, grab and throw, or swing a bat. |
| [Heads](https://ironslob.github.io/webxr-experiments/experiments/3-heads/) | Same idea as Balls, but with a 3D head model instead of spheres. |
| [Blast](https://ironslob.github.io/webxr-experiments/experiments/4-blast/) | Mix of models at different sizes. Hit one and it fireworks, then pops back elsewhere. |
| [Viz](https://ironslob.github.io/webxr-experiments/experiments/5-viz/) | Shapes and models that react to the mic or a demo beat — pulse, spin, flash, hop. |
| [Arrows](https://ironslob.github.io/webxr-experiments/experiments/6-arrows/) | Arrows crawl floors, walls, and ceilings; sound makes them pulse. |
| [Capture](https://ironslob.github.io/webxr-experiments/experiments/7-capture/) | Bakes camera colour onto the Space Setup mesh, then drops you into the opaque capture. |
| [Slice](https://ironslob.github.io/webxr-experiments/experiments/8-slice/) | Swing one katana or two through fruit, animals, or planets. Cut pieces can be cut again. Scores float in the air, and the best rounds stay in a high score table. |

## About the code

Static HTML, CSS, and JavaScript with [three.js](https://threejs.org/) from a CDN — no build step. The site is served from the `main` branch on GitHub Pages.

To browse the files locally:

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765/` in a browser. Immersive AR still needs the headset.
