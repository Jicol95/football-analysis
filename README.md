# Pitch Control

Bird's-eye replay of Metrica Sports sample tracking data with a live
Spearman pitch control surface (blue = home control, red = away).

```bash
npm install
npm run prepare-data   # downloads Game 1 and writes public/data/game1.{bin,json}
npm run dev
```

- `scripts/prepare-data.ts` – CSV → compact Int16 tracking (cm) + JSON metadata
- `src/pitchControl.ts` – Spearman model (Laurie Shaw's default parameters)
- `src/worker.ts` – runs the model off the main thread
- `src/game.ts` – frame access, velocities (central difference), possession
- `src/render.ts` – canvas pitch, heatmap, players

Controls: Space play/pause, ←/→ 5 s, Shift+←/→ one frame. Click an event to
jump to 3 s before it.
