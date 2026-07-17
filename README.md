# ⚙ Robot Wars: Evolution

Natural selection, but for combat robots. Every generation, a population of 32
robots fights a single-elimination knockout tournament. Tournament placement is
fitness: winners breed, losers are scrap. Watch weapon metas rise, get
counter-evolved, and fall — spinner eras toppled by flipper uprisings, hammer
dynasties cracked by full-charge glass cannons — across hundreds of generations.

**Run it:** open `index.html` in any browser. No build step, no server, no
dependencies — everything (simulation, arena renderer, charts) lives in that one
file.

## The ecosystem

Four weapon types with a non-transitive counter graph, so no build is ever safe:

| Type | Wins by | Countered by |
|---|---|---|
| **Spinner** | huge spin-up disc hits, hit-and-run | flippers (gyro death when flipped), rammers |
| **Flipper** | getting under low, flips → count-outs, arena-outs | hammers (overhead ignores clearance), rammers |
| **Hammer** | armour-piercing overhead axe | spinners (shredded while closing in) |
| **Rammer** | traction shoves, pit-outs, raw armour | hammers (the axe cracks the brick) |

Each robot's genome: a weapon type, a five-way build budget (armour / power /
speed / control / self-righting — always sums to 1, so specialisation has a
price), plus ground clearance and aggression. Battles are fully simulated 2D
physics-lite fights with a pit hazard, count-outs, judges' decisions, and
out-of-arena flips.

## The evolution loop

- Knockout depth + damage dealt → continuous fitness; deeper runs earn more
  offspring (the best first-round losers still breed — one match is a noisy judge).
- Crossover is assortative (mates share a weapon type), then mutation; ~3.5% of
  children mutate their weapon type, arriving pre-adapted rather than hopeless.
- The champion survives into the next generation unchanged — until it has hoarded
  5 titles, at which point it **retires undefeated** and only its offspring carry on.
- A minority floor keeps every type's gene pool alive (≥3 members), and wildcard
  immigrants re-enter using **genetic memory** — the best build their type ever
  evolved — so vanished counter-types can genuinely re-invade. That's what makes
  the rock-paper-scissors cycles actually happen instead of one type fixating.

Everything is deterministic per seed: per-match hashed RNG streams mean watching,
skipping, and replaying a battle all produce bit-identical outcomes. Type the
same seed twice and you get the same 300-generation saga.

## The UI

- **Highlights mode** (default): each generation's undercard results flood the
  bracket, then you watch the best undercard fights, both semis and the final.
  Full-card mode replays all 31 battles. Speed 1×–16×, skip buttons, +10/+50
  generation fast-forward.
- **Weapon meta chart**: stacked population share by type with automatic era
  labels — the counter-evolution money shot.
- **Trait evolution**: population-average power / armour / self-right / clearance.
- **Champions timeline**, **hall of fame** (longest dynasties), **type-vs-type
  win rates** over the last 15 generations, and a generation-by-generation
  **evolution log** ("UPSET! …dethrones the spinner dynasty!").

## Testing / tuning

```
node test/harness.mjs matchups          # archetype win-rate matrix (balance gate)
node test/harness.mjs dynamics --seed 1 --gens 300   # era cycling, fixation check
node test/harness.mjs sweep --seeds 8 --gens 250     # multi-seed robustness
node test/harness.mjs determinism       # replay/step/headless equivalence
```

The harness extracts the `<script id="sim-core">` block from `index.html` and
runs it headless in Node — the exact code the browser runs.
