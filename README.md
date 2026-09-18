# Wedding Weekend Planner

A single-page site for planning a wedding weekend: pick a date, rehearsal dinner,
welcome party, Mass and reception, keep a guest list, and see the whole weekend
simulated on the home page with headcounts and an estimated budget.

Everything is in `index.html`. No build step, no dependencies.

## Run it locally

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Deploy on Render

1. Push this repo to GitHub.
2. In Render, create a new **Static Site** from the repo (or use the included
   `render.yaml` as a Blueprint).
3. Build command: leave empty. Publish directory: `.`

## Editing options

Open `index.html` and find the block marked `WEDDING WEEKEND — DATA BLOCK`.

- `CONFIG` holds the password, hint, sides and guest groups.
- `DECISIONS` holds the five decisions and their options. To add an option,
  push a new object into that decision's `options` array. Only `id` and `name`
  are required; `fixed`, `perGuest`, `capacity`, `time`, `pros` and `cons`
  drive the itinerary and budget. Never reuse an `id`.
- `EXTRAS` holds the other budget lines that can be toggled on the home page.

## Where the data lives

On a plain static host, picks and the guest list are saved in the browser
(localStorage), so each device keeps its own copy. The header shows
"Saved on this device only" in that mode. When the page runs inside a Claude
Artifact it uses the artifact's shared database instead, so both partners see
the same plan.

## Password

The gate is a simple client-side check meant to keep casual visitors out.
Anyone who can read the page source can read the password, so do not treat it
as real security.
