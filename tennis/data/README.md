# data/

Bundled sample dataset for the tennis visual analytics dashboard.

## Source and license

All records derive from Jeff Sackmann's **Match Charting Project (MCP)**:
<https://github.com/JeffSackmann/tennis_MatchChartingProject>
(files `charting-m-matches.csv` and `charting-m-points-2020s.csv`).

The MCP data is released under the
**Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**
license. The derived files in this folder inherit that license: attribute the Match
Charting Project, do not use them commercially, and share derivatives under the same terms.
The raw CSVs themselves are not committed here; only the derived subset is.

## Files

| File | Content |
|---|---|
| `recent_mcp_points.json` | Default dataset: eligible charted men's matches in the inclusive 2022-10-30 to 2026-10-29 window, with points lacking recorded in-play return depth excluded, stored in a dictionary-encoded point format. See the audit below. |

The MVP ships this one file. The older top-rival sample (`sample_mcp_points.json`) and the raw
CSV subset used for a live-parse demo were removed on the `mvp-simplification` branch; the
parser itself (`js/core/DataAdapter.js`) is unchanged and still unit-tested.

## How to rebuild

Download `charting-m-matches.csv` and `charting-m-points-2020s.csv` from the repository above and
run the command in the next section from the project root (`npm run build:data -- ...` is
equivalent). Without `--start-date` / `--end-date` the script falls back to its older top-rival
selection (`--max-points`, `--min-points`, `--max-bytes`); `--raw-out` defaults to
`.tmp/mcp_raw_subset.csv`, which is not committed. The build streams the points file, finishes in
a few seconds and prints a JSON summary (counts, skip statistics, file sizes, first record).

## Recent men's extract: reproducibility and audit

The bundled recent extract was built from upstream commit
[`1813a1309b7ed7ebf1c7e884b32bf675d00e4edf`](https://github.com/JeffSackmann/tennis_MatchChartingProject/commit/1813a1309b7ed7ebf1c7e884b32bf675d00e4edf)
using `charting-m-matches.csv` and `charting-m-points-2020s.csv`. With those files downloaded:

```sh
node scripts/build_sample_dataset.mjs --matches charting-m-matches.csv \
  --points charting-m-points-2020s.csv --out data/recent_mcp_points.json \
  --raw-out .tmp/recent-raw.csv --start-date 20221030 --end-date 20261029 \
  --generated-at 2026-10-30T00:00:00Z
```

The window selects every metadata match with a recognized hard, clay, or grass surface, not
just top-player head-to-heads. It had 2,205 eligible metadata matches, of which 2,202 had
point rows. The latest actual match is 2026-05-21, so the last part of the window has no
matches in this source snapshot. It contains 321,393 retained points from 376 players:
202,644 hard, 83,843 clay and 34,906 grass. Of 356,865 input rows in matches with point
data, 35,472 were skipped. This includes 34,357 rows with an in-play return but no recorded
depth: the legacy parser otherwise labels these "Deep", which would confound a story about
return depth. Other exclusions include 526 empty shot strings, 187 invalid tokens and 73
duplicate point IDs. The shot-string-derived winner disagreed with the recorded point winner
on 9 retained rows; the adapter uses the recorded winner. Detailed reasons and match-level
metadata are embedded in `meta.skipStats` and `meta.matchList`.

The extract is crowdsourced and not representative of the entire tour: matches, tournaments
and players are unevenly charted. Excluding missing depths can also bias *all* comparisons:
the retained points are not a complete set of points from each match. For example, the
Australian Open contributes 192 matches; Jannik Sinner appears in 30,569 retained points.
Counts for a player include points served
and returned. Point-level Wilson/Newcombe intervals assume independent points; points from
the same match or player are related, so these intervals can overstate precision. They do
not adjust for player, opponent, tournament, surface or selection bias.
The adapter's inside-out forehand category is a heuristic based on recorded shot direction
and service side; it does not observe the player's position or account for handedness.
Treat it as an approximate category, not a confirmed tactical choice.

The expanded data still makes a useful return story, but changes its conclusion. After deep
or very deep returns, servers won 50.8% of short points (N=59,070, 95% Wilson CI
50.4–51.2%) and 49.4% of longer points (N=97,422, 95% Wilson CI 49.1–49.7%), a difference
of -1.4 percentage points (95% Newcombe CI -1.9 to -0.9). Short points overall were 74.6%
(N=199,254, 95% Wilson CI 74.4–74.8%). These descriptive comparisons do not establish that
return depth or rally length caused the differences.
