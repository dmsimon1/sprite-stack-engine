---
name: sprite-stack-engine
description: Render large sprite-stacked scenes (pseudo-3D pixel art built from stacks of flat slices) in WebGL2 with a free camera and controlled overdraw. Use when a sprite-stack scene must rotate, tilt, zoom or use a perspective camera; when slices show gaps or break apart; when overdraw or fill rate at high resolution is the problem; when a stacked scene needs dynamic lights and shadows; or when someone needs measured overdraw numbers rather than estimates. Covers instanced slice quads, thickness fill, the edge-on guard, height-sorted painter order, front-to-back hidden-surface removal, shell stacks, a G-buffer with deferred lighting, height-map shadows, internal resolution, and an exact overdraw count pass.
---

# Sprite stack engine

A sprite stack is an object stored as flat horizontal slices and drawn by placing them one above another.
This skill is about doing that at scene scale: many stacks, any camera, real lighting, and a fill cost that
stays near one fragment per pixel.

The reference implementation is the repository this file ships in (`js/engine.js`, about 300 lines, plus
`js/art.js` for building stacks). Read `engine.js` before writing your own.

## The pipeline

1. **Slices are instanced quads.** One quad per slice copy: world position, rotation, atlas rectangle, offset
   from the stack's axis, scale. The four corners come from `gl_VertexID`; one draw call draws everything.
2. **A slice pass writes a G-buffer, not colour.** Per pixel: palette index, facing (a normal baked per slice
   pixel and rotated with the slice), and height.
3. **A light pass runs once per screen pixel.** Colour comes from the palette; the world position is rebuilt
   from the stored height (intersect the pixel's view ray with the plane at that height); sun, shadow and lamps
   are computed there. Lighting cost no longer depends on overdraw.
4. **Blit** to the canvas, without smoothing if the internal resolution is lower.

## Keeping stacks solid under a free camera

- **Thickness fill.** A layer is a slab, a slice is a plane. Draw each slice once for every screen row its
  layer is tall: `copies = ceil(pixelsPerUnit * cos(pitch) * layerThickness)`, at heights `z + k / copies`.
  In perspective compute it per stack from its distance. Without this, layers separate as soon as you zoom in
  or tilt down.
- **Edge-on guard.** Near the horizon a slice has almost no height on screen and falls between pixel rows.
  In the vertex shader push each corner half a pixel away from the slice's centre line in clip space, so every
  slice covers at least one row.
- **Draw order.** With a camera above the scene, the higher of two points on one view ray is always the nearer.
  So sorting by height is an exact depth sort, for a parallel and for a perspective camera, as long as every
  view ray points downward: keep `pitch > fov / 2` in perspective. Use a counting sort into height buckets;
  it is linear and runs every frame.

## Keeping overdraw down

Measure first (see below). Then, in order of payoff:

1. **Hidden-surface removal.** Sort highest first, enable the depth test, write depth. A pixel that already
   has a slice rejects everything below it. Fragments written drop to about one per pixel. Quads are still
   rasterised and depth-tested, which is cheap but not free.
2. **Shell stacks.** A slice pixel deep inside a solid is always covered by the layer above. Drop every pixel
   further than two pixels from empty space when building the atlas. This cuts written fragments several
   times over even in painter order, and costs nothing at run time.
3. **Crop slices** to their filled rectangle and skip empty layers.
4. **Internal resolution.** Rendering at half size quarters the pixels and also halves the copies needed per
   layer, so the fill drops by about eight.

## Measuring overdraw (never estimate it)

Draw the same instances again into a float target with additive blending, adding 1 per fragment, then read it
back: average and maximum per pixel. Count two things separately:

- **written**: fragments that pass the alpha test (and the depth test, when it is on);
- **covered**: every fragment the quads cover, with no tests.

Show the count texture through a colour ramp for a heat map. Use `RGBA16F` (`EXT_color_buffer_float`); an
8-bit target saturates at 255.

Honesty note for reports: with a depth test and `discard`, "written" is exact, but whether the GPU ran the
fragment shader for a rejected fragment depends on its early depth test. Report "written" and "covered", not
"shaded".

## Lighting and shadows

- Bake a normal per slice pixel at build time: the average direction towards empty neighbours, with extra
  weight upward for tops. Store it beside the palette index in the atlas.
- Shadows: keep a height map of the static scene (tallest solid per ground cell). In the light pass march from
  the pixel's world position towards the sun and test against it. Moving figures are not in the map; treat
  each as a cylinder.
- A height map has no overhangs: a lamp head or a balcony casts the shadow of a full pillar. Leave such parts
  out of the map.

## When a mesh is the better tool

- Views from below or level with the horizon: height order stops being depth order, and slices are edge-on.
- Large smooth or sloped surfaces seen close up: a stack shows stair-steps at one layer per row.
- Thin overhanging detail and anything that must cast an exact shadow.
- Scenes where rasterised (covered) area itself is the limit: a mesh draws the surface only.

## Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| Layers separate when zooming or tilting | one quad per slice | thickness fill |
| Slices flicker or vanish near the horizon | edge-on quads miss pixel rows | edge-on guard |
| Far objects draw over near ones in perspective | a view ray points upward | keep `pitch > fov / 2`, or use the depth test |
| Lighting cost explodes with scene height | lighting per slice fragment | G-buffer and one light pass |
| Count pass shows 255 everywhere | 8-bit count target | float target, or scale the unit |
| Shell stacks show holes | shell thinner than one layer step on screen | keep at least two pixels of shell |
| Pillar shadows under lamps | overhang in the height map | leave overhanging parts out |
