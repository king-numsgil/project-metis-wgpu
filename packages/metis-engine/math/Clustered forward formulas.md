# Clustered forward formulas

# Clustered forward shading + directional shadow map — model & formula reference

## What this actually is

A naive forward renderer loops every light over every fragment — fine for one sun, catastrophic once a scene has dozens of point lights (ship interior fixtures, running lights, explosions). Clustered forward shading fixes this by dividing the view frustum into a 3D grid of small boxes ("clusters"), working out ahead of time which lights can possibly affect each cluster (a compute pass, off the critical fragment-shading path), and having the fragment shader only loop over the short list assigned to *its* cluster. This is the same technique described in Olsson & Assarsson 2012 ("Clustered Deferred and Forward Shading") and used in id Tech 6 (Doom 2016) — real, load-bearing computational-geometry engineering, not a visual approximation.

The one deliberate simplification here relative to a "full" implementation: clusters are rebuilt from scratch every frame instead of only when the camera's projection changes. At `16×9×24 = 3,456` clusters this costs a trivial compute dispatch, so the added complexity of caching and invalidating the cluster AABBs wasn't worth it for this engine's scale — see "The one skipped optimization" below.

---

## Formula 1 — The cluster grid

Fixed counts (`src/shading/clusterConfig.ts`): `16` tiles wide × `9` tiles tall × `24` depth slices, independent of actual viewport resolution — tiles just scale to fit. Screen-space tiles are trivial (divide the viewport into a uniform grid); the interesting part is the depth axis.

## Formula 2 — Exponential Z-slicing

$$
z_k = z_{near}\left(\frac{z_{far}}{z_{near}}\right)^{k/S}, \qquad k \in [0, S)
$$

Where `S` is the slice count (24) and `z_k` is the (positive, linear) view-space depth at the near edge of slice `k`. Inverting this to find which slice a given depth `z` falls into:

$$
k(z) = S\cdot\frac{\log(z/z_{near})}{\log(z_{far}/z_{near})}
$$

**ELI5:** Linear depth slicing wastes most of its resolution far from the camera, where a single slice can span kilometers, while cramming everything close to the camera — where lights matter most and objects are biggest on screen — into one thin sliver. Exponential slicing flips this: slices stay thin near the camera (where precision matters for separating a ship's interior lights into distinct clusters) and grow wide in the distance (where nothing needs that precision). `clusterZIndex()` in `common.wgsl` implements the inverse formula directly; `cluster_build.wgsl` implements the forward formula to build each slice's near/far planes.

## Formula 3 — Cluster AABBs via ray/z-plane intersection

For each cluster's four screen-space tile corners, unproject to a view-space ray through the camera origin (`screenToViewRay` in `cluster_build.wgsl`), then intersect that ray with the cluster's near and far z-planes (`intersectZPlane`) to get 8 corner points; the cluster's AABB is simply their component-wise min/max.

$$
P(t) = t \cdot \hat{r}, \qquad t = \frac{z_{plane}}{\hat r_z} \implies P_z = z_{plane}
$$

**ELI5:** Because every cluster is a frustum-shaped wedge, not a box, we approximate it with the smallest axis-aligned box that contains it — slightly conservative (a light just outside the true wedge but inside its bounding box gets tested and correctly rejected by the sphere-vs-box test in Formula 4), which is the standard, harmless trade every clustered-shading implementation makes.

## Formula 4 — Sphere/AABB light culling

$$
d^2 = \sum_{i\in\{x,y,z\}} \left(\max(0,\ \text{clamp}(p_i, \text{min}_i, \text{max}_i) - p_i)\right)^2, \qquad \text{light affects cluster} \iff d^2 \le \text{range}^2
$$

Implemented in `light_cull.wgsl` — for each of the (up to 3,456) clusters, loop the scene's active point lights and test each one's view-space position against the cluster's AABB via squared distance, writing up to `MAX_LIGHTS_PER_CLUSTER` (32) surviving indices into a fixed-stride array. No atomics: each cluster writes only its own slice of the output buffer, so there's no contention to resolve.

**ELI5:** A point light's influence is a sphere (Formula in `pointLightAttenuation`, `common.wgsl` — inverse-square falloff windowed to hit exactly zero at `range`); this just asks "does that sphere touch this box?" for every (cluster, light) pair. It's `O(clusters × lights)`, which sounds bad until you notice it runs on the GPU in parallel and both numbers are small (thousands × hundreds, not millions).

---

## The directional shadow map

The sun needs to be *occluded* by geometry — otherwise "sunlight through a window" is just a hole in a wall that doesn't actually change the lighting, since every surface would be lit by pure `N·L` regardless of what's in front of it. `shadow.wgsl` renders a depth-only pass from the sun's point of view once per cascade, into one `2048×2048` layer each of a `depth32float` array; `forward.wgsl`'s `sampleSunShadow()` picks the cascade for the fragment's view depth, projects into that cascade's light space, and tests the stored depth with a hardware comparison sampler (3x3 PCF taps, each itself a 2x2 bilinear compare).

## Formula 5 — Fitting the shadow frustum

**Superseded by cascades.** The single scene-bounding-sphere fit below is the
pre-CSM design; the renderer now fits one frustum per cascade to a slice of the
*camera* frustum, with texel snapping. Kept for the bug it documents, which is
about bounding *meshes* and applies to any fit. See CLAUDE.md "Cascaded shadow
maps" for what runs today.

$$
\text{center} = \frac{1}{N}\sum_i \text{position}_i, \qquad \text{radius} = \max_i\left(\lVert \text{position}_i - \text{center}\rVert + r_i\right) + \text{padding}
$$

Where `r_i` is each mesh's own `boundingRadius` (max vertex distance from its local origin — computed once in `Mesh`'s constructor). The light's virtual camera sits at `center - sunDirection·radius·2`, looks at `center`, and uses an orthographic projection sized `[-radius, radius]`.

**Honest caveat — this is the one labeled handwave:** `boundingRadius` is computed from raw vertex distance-from-local-origin, not a proper minimal bounding sphere, and instance transforms only translate (rotation/scale would make this approximation looser). For a room mesh whose local origin is the floor corner rather than its centroid, this measurably overestimates the true bounding sphere — acceptable slack for this engine's scene scale (single digits of meshes, room-sized), but the first thing to replace with real per-mesh AABBs if scenes grow larger or more numerous.

**The bug this formula exists to describe:** the very first implementation of this used only `instance.transform.position` — which is `(0,0,0)` for a room mesh positioned at its own origin — completely missing that the mesh's *geometry* extends far past that point. The shadow frustum ended up radius-4 around a room that actually spans radius-7.5, so most of the room fell outside the frustum and got the "no shadow data available -> fully lit" fallback, silently disabling shadowing for exactly the geometry that mattered. Folding each mesh's own extent into the radius (rather than only instance-position spread) fixed it.

## The one skipped optimization

A "complete" clustered-forward implementation rebuilds cluster AABBs only when the camera's projection matrix changes (fov/aspect/near/far), since the AABBs are purely a function of that matrix, not of camera position or scene content. This renderer rebuilds them every single frame instead. At `3,456` clusters this is a negligible compute cost, and skipping the dirty-tracking logic (detecting exactly when the projection changed, correctly invalidating on window resize) removed a whole class of potential bugs for a feature this engine doesn't currently need (the projection rarely changes mid-scene in either demo). Worth revisiting if cluster counts grow by an order of magnitude or the compute budget gets tight.

---

## Tunable parameters

```
ClusterConfig {
  CLUSTER_COUNT_X, CLUSTER_COUNT_Y, CLUSTER_COUNT_Z  // 16 x 9 x 24 — grid resolution
  MAX_LIGHTS_PER_CLUSTER                              // 32 — per-cluster light-list capacity
  MAX_POINT_LIGHTS                                    // 256 — total lights uploaded per frame
}

ShadowMap {                 // 4-cascade CSM, every cascade depth32float + hardware PCF
  SHADOW_MAP_SIZE           // 2048 — per-cascade resolution (4 layers ≈ 67 MB total). Resolution
                            //         was never the corner-leak fix (a one-depth-per-texel
                            //         ambiguity, not aliasing), so don't reach for this first if
                            //         an artifact shows up
  CASCADE_COUNT             // 4 — cascades, one depth-array layer and one draw pass each
  SHADOW_DISTANCE_DEFAULT   // 400 — world-unit reach the cascades subdivide; beyond it, fully lit
  CASCADE_SPLIT_LAMBDA      // 0.85 — practical-split blend (1 = logarithmic, 0 = uniform)
  CASCADE_BLEND_FRACTION    // 0.12 — cross-fade band at each cascade's far edge (hides the seam)
  SHADOW_NORMAL_OFFSET_TEXELS // 2.0 — normal offset as a *texel count*, so it self-rescales with
                            //         SHADOW_MAP_SIZE and the split scheme (a fixed world value
                            //         collapses to sub-texel on the far cascades → acne)
  SHADOW_NORMAL_OFFSET_MIN  // 0.04 — world-unit floor on the above. Currently *binding* on
                            //         cascade 0, i.e. cascade 0 is over-offset for its own texel
                            //         size. First dial if contact shadows look detached, now that
                            //         cascade 0 is PCF (under MSM it ran with zero depth bias).
  roomBox thickness         // 0.2 — solid-slab wall thickness. Load-bearing: zero-thickness
                            //         occluders put occluder and receiver depth at the same value
                            //         on a shared edge, which no shadow map can resolve.
}
```
