# geopolitical

Create a browser based Geopolitical Game in the same genre as Balance of Power or Conflict: Middle East Political Simulator. 

The theater will be in the Middle East and the player will assume the role of one of many nations or factions. it should be set in 2026 in the context of the current Iran war and Gaza war. 

Major actors will be the US, Israel, Iran, Turkey, Saudi Arabia, the Houthis, the Kurds, ISIS, and Hamas. Every notable armed group should be represented. The EU, Russia, and China should also be playable. 

Each actor will have specific political goals that realistically reflect their interests. winning is achieving those goals. 

Players will make decisions to allocate financial, military, and political resources to achieve those goals. 

It should be played  like a “matrix game”:
https://holisticdice.substack.com/p/matrix-war . Players will take turns and actions that have different costs and likelihood. the game will function as a game master and evaluate the likelihood based on the current conditions and how all players act. 

Development

2.1 Everything is text; close the loop yourself

Prefer code, scene files, configs and scripts you can read and diff over editor clicks. If a change can be made by editing a file, do that instead of driving an inspector.
Never act blind for more than one step. After every change that affects what the player sees, capture a frame (or a short frame sequence for motion) from a named camera and look at it before the next change. After every change that affects behaviour, read numbers from game state, not pixels.
Post the picture, not a description of it. Every meaningful pass ends with an in-engine capture attached to the update, shot through the real player path (not a dev harness dressed differently), captioned with what changed.
Always say what is verified and what isn't ("two local clients verified; real-network multiplayer not tested with humans").
2.2 Build the debug hooks first (day 1, before content)

Expose these behind a dev flag / URL param / editor menu, and keep them working for the life of the project:

teleport(x,y,z | namedSpot), freeze() / step(n) / resume(), setTimeOfDay(h), setSeed(n), spawn(kind, at), clearAll(), win() / lose().
Named fixed cameras — cam("overview"), cam("hero-close"), cam("hud-check") — so before/after shots are comparable.
getState() → a JSON snapshot of everything gameplay-relevant: positions, velocities, health, score, round phase, entity counts, current level id, frame ms, draw calls, shader-program count, GPU/renderer string, context-lost flag.
A deterministic mode: fixed timestep, seeded RNG, optional simdt override so scripted runs replay identically.
An on-screen diagnostics overlay (GPU string, frame ms, draw calls, last shader error) that also works on a phone.
2.3 Check behaviour with numbers, check looks with pictures

Write assertions against getState(): "after holding W for 2 s, speed > 8"; "a novice bot finishes lap 1 with 0 respawns"; "every quest objective resolves to a placed world position"; "shader-program count is constant from the first title frame".
Sweep input combinations (W+A at full steer), not single axes. Exercise the real input→intent path at least once per feature, not only injected intents — dead input paths pass sim-level tests.
Run a stills sweep over every level/biome/stage enumerated from the game's own registry (never a hand-picked subset); fail on any blank frame (mean luma ≈ 0 or < 2 % pixel variance) or console error.
Take at least one composited full-window screenshot through the true cold-boot path (cleared storage, no dev flags). Canvas read-backs don't see a DOM/UI overlay left covering the screen; players do.
Content probes beat playthroughs for coverage: check data (spawn tables, objectives, nav links) resolves before checking it plays.
2.4 Iteration cadence

Small diffs, one concern each. Before calling anything done — including a one-line hotfix — boot the game headless for ~10 s and assert sim time advances with no console errors.
Playtest the first five minutes before building breadth: ship the intro + one level, get a human read, then widen.
Environment before hero asset; art pass before netcode polish; textures last.
Make low-stakes design calls yourself and report them in one line ("went with X — say if you'd rather Y"). Stop and ask only for irreversible or direction-setting choices.
Commit early and often with explicit paths; keep notes/progress.md current enough that a cold reader could resume.
2.5 Definition of done (every iteration)

 Boots cold with no console errors; sim time advances.
 The change is visible in an attached capture from a named camera (before/after if visual).
 A getState() assertion covers the behaviour touched, and it passes.
 Frame ms and draw calls within the Section 1 budget on the reference tier; program/light count unchanged unless intended.
 Real input path exercised (real mouse/touch coordinates, not synthetic events).
 Notes updated: what changed, verified vs not, what's next.
2.6 When stuck

Two failed attempts at the same fix → stop patching and instrument: add the state field, counter or overlay that would have made the cause obvious, then look again.
Symptom lookup: "black screen" → check UI/DOM overlays before the GPU. "White 3D view, HUD still works" on Android → lost graphics context. "Freezes the first time only" → shader recompiles (see 3.3). "Flickering textures" → coplanar geometry z-fighting. "Shadows vanished" → diff one frozen frame shadows on/off, then check boot-time quality config. "Player teleports after a stall" → uncapped fixed-step catch-up.
If a reference or asset source is unreachable, ask for pasted screenshots; don't guess the look.
If the ask is "photoreal / AAA", state the honest ceiling in the first reply (procedural + scripted-DCC assets top out around clean, slightly stylised realism, convincing at walking pace — not scan quality) and pitch two bold stylised directions alongside. Stylised-and-confident beats almost-realistic every time.
