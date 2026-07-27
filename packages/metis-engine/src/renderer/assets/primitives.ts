import { Vec3 } from "metis-data";
import { type Vec3f, vec3f } from "../math/types.ts";

/** Interleaved `[px,py,pz, nx,ny,nz, tx,ty,tz,tw, u,v]` per vertex (stride 48 bytes) — see scene/mesh.ts's vertex layout. */
export interface MeshData {
    /** 12 floats per vertex. Length must be a multiple of 12. */
    vertices: Float32Array;
    /** Triangle list, u32. Wind CCW as seen from the outside — the forward pipeline culls back faces. */
    indices: Uint32Array;
}

const FLOATS_PER_VERTEX = 12;

class MeshBuilder {
    private verts: number[] = [];
    private idx: number[] = [];

    /**
     * Adds a quad spanning `origin`, `origin+u`, `origin+u+v`, `origin+v`.
     * Winding is CCW as seen from the `normalize(cross(u, v))` side — callers
     * pick `u`/`v` so that cross product points the way the face should face.
     * The tangent is `normalize(u)` (the direction the U texture coordinate
     * increases along) with bitangent sign +1 — valid because every quad in
     * this file uses perpendicular `u`/`v`, which makes `cross(normal, u)`
     * exactly parallel to `v` (see math/PBR shading formulas.md).
     */
    addQuad(origin: Vec3f, u: Vec3f, v: Vec3f) {
        const normal = Vec3.normalize(vec3f(), Vec3.cross(vec3f(), u, v)).view();
        const tangent = Vec3.normalize(vec3f(), u).view();
        const base = this.verts.length / FLOATS_PER_VERTEX;
        const ov = origin.view();
        const uv3 = u.view();
        const vv3 = v.view();
        // The four corners, unrolled as scalars — mesh generation runs once at
        // load, so this is about keeping the winding legible, not about speed.
        const corners: [number, number, number, number, number][] = [
            [ov[0]!, ov[1]!, ov[2]!, 0, 0],
            [ov[0]! + uv3[0]!, ov[1]! + uv3[1]!, ov[2]! + uv3[2]!, 1, 0],
            [ov[0]! + uv3[0]! + vv3[0]!, ov[1]! + uv3[1]! + vv3[1]!, ov[2]! + uv3[2]! + vv3[2]!, 1, 1],
            [ov[0]! + vv3[0]!, ov[1]! + vv3[1]!, ov[2]! + vv3[2]!, 0, 1],
        ];
        for (const [px, py, pz, uu, vv] of corners) {
            this.verts.push(
                px, py, pz,
                normal[0]!, normal[1]!, normal[2]!,
                tangent[0]!, tangent[1]!, tangent[2]!, 1,
                uu, vv,
            );
        }
        this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    /** Adds an axis-aligned box spanning `[min, max]` with outward-facing quads. */
    addBox(min: Vec3f, max: Vec3f) {
        const lo = min.view();
        const hi = max.view();
        const sx = hi[0]! - lo[0]!;
        const sy = hi[1]! - lo[1]!;
        const sz = hi[2]! - lo[2]!;
        // +X / -X
        this.addQuad(vec3f(hi[0]!, lo[1]!, hi[2]!), vec3f(0, 0, -sz), vec3f(0, sy, 0));
        this.addQuad(vec3f(lo[0]!, lo[1]!, lo[2]!), vec3f(0, 0, sz), vec3f(0, sy, 0));
        // +Y / -Y
        this.addQuad(vec3f(lo[0]!, hi[1]!, lo[2]!), vec3f(0, 0, sz), vec3f(sx, 0, 0));
        this.addQuad(vec3f(lo[0]!, lo[1]!, lo[2]!), vec3f(sx, 0, 0), vec3f(0, 0, sz));
        // +Z / -Z
        this.addQuad(vec3f(lo[0]!, lo[1]!, hi[2]!), vec3f(sx, 0, 0), vec3f(0, sy, 0));
        this.addQuad(vec3f(hi[0]!, lo[1]!, lo[2]!), vec3f(-sx, 0, 0), vec3f(0, sy, 0));
    }

    addTriIndexed(positions: Vec3f[], normals: Vec3f[], tangents: Vec3f[], uvs: [number, number][]) {
        const base = this.verts.length / FLOATS_PER_VERTEX;
        for (let i = 0; i < positions.length; i++) {
            const p = positions[i]!.view();
            const n = normals[i]!.view();
            const t = tangents[i]!.view();
            const uv = uvs[i]!;
            this.verts.push(p[0]!, p[1]!, p[2]!, n[0]!, n[1]!, n[2]!, t[0]!, t[1]!, t[2]!, 1, uv[0]!, uv[1]!);
        }
        return base;
    }

    pushIndices(...i: number[]) {
        this.idx.push(...i);
    }

    build(): MeshData {
        return {vertices: new Float32Array(this.verts), indices: new Uint32Array(this.idx)};
    }
}

/**
 * A single-quad plane on the XZ plane, facing +Y, centered at the origin.
 *
 * Two triangles total, so per-vertex lighting artifacts are impossible but so is
 * any geometric detail — fine as a ground plane, useless as a shadow receiver
 * that needs to bend.
 */
export function plane(width: number, depth: number): MeshData {
    const b = new MeshBuilder();
    const hw = width / 2;
    const hd = depth / 2;
    b.addQuad(vec3f(-hw, 0, hd), vec3f(width, 0, 0), vec3f(0, 0, -depth));
    return b.build();
}

/**
 * An axis-aligned box centered at the origin with outward-facing normals. Faces
 * are separate quads, so normals are flat and edges are hard.
 *
 * @param sx full X extent (not a half-extent).
 * @param sy full Y extent.
 * @param sz full Z extent.
 */
export function cube(sx: number, sy: number, sz: number): MeshData {
    const b = new MeshBuilder();
    b.addBox(vec3f(-sx / 2, -sy / 2, -sz / 2), vec3f(sx / 2, sy / 2, sz / 2));
    return b.build();
}

/**
 * A UV sphere with outward-facing normals, centered at the origin. Tangents
 * follow increasing longitude and degenerate at the poles — the singularity
 * every UV sphere has.
 *
 * @param latBands rings from pole to pole.
 * @param lonBands segments around the equator.
 */
export function uvSphere(radius: number, latBands = 24, lonBands = 32): MeshData {
    const b = new MeshBuilder();
    const positions: Vec3f[] = [];
    const normals: Vec3f[] = [];
    const tangents: Vec3f[] = [];
    const uvs: [number, number][] = [];

    for (let lat = 0; lat <= latBands; lat++) {
        const theta = (lat * Math.PI) / latBands; // 0 (north pole) .. PI (south pole)
        const sinT = Math.sin(theta);
        const cosT = Math.cos(theta);
        for (let lon = 0; lon <= lonBands; lon++) {
            const phi = (lon * 2 * Math.PI) / lonBands;
            const x = Math.cos(phi) * sinT;
            const y = cosT;
            const z = Math.sin(phi) * sinT;
            positions.push(vec3f(x * radius, y * radius, z * radius));
            normals.push(vec3f(x, y, z));
            // Tangent = d(position)/d(longitude), i.e. the direction U
            // increases along — degenerates at the poles (sinT = 0), same
            // known singularity every UV sphere has.
            tangents.push(vec3f(-Math.sin(phi), 0, Math.cos(phi)));
            uvs.push([lon / lonBands, lat / latBands]);
        }
    }

    b.addTriIndexed(positions, normals, tangents, uvs);
    for (let lat = 0; lat < latBands; lat++) {
        for (let lon = 0; lon < lonBands; lon++) {
            const a = lat * (lonBands + 1) + lon;
            const bIdx = a + lonBands + 1;
            // Index order matters: with this parameterization (x=cosφ·sinθ,
            // z=sinφ·sinθ, +lat = south), (a, bIdx, a+1) winds *clockwise*
            // seen from outside — which, under the forward pipeline's
            // cullMode "back", culls the outside and renders the sphere's
            // interior. That shipped as a real bug: vertex normals stay
            // outward, so every light lit the hemisphere *opposite* itself
            // and the patches tracked the camera ("specular highlights
            // follow me"), while cube/room geometry (addQuad, correctly CCW)
            // shaded fine. Verified by hand-winding the equator triangle at
            // phi=0 and by A/B renders against a light placed behind the
            // sphere. Keep these triangles CCW-from-outside.
            b.pushIndices(a, a + 1, bIdx, a + 1, bIdx + 1, bIdx);
        }
    }
    return b.build();
}

/** An opening in {@link roomBox}'s front (-Z) wall, given as fractions of that wall rather than world units. */
export interface WindowCutout {
    /** Left edge, as a fraction [0,1] of the front wall's width. */
    s0: number;
    /** Right edge, as a fraction [0,1] of the front wall's width. */
    s1: number;
    /** Bottom edge, as a fraction [0,1] of the front wall's height (0 = floor). */
    t0: number;
    /** Top edge, as a fraction [0,1] of the front wall's height. */
    t1: number;
}

/**
 * An interior room (floor/ceiling/4 walls) built from *solid slabs* of the
 * given `thickness`, not zero-thickness quads. Interior dimensions are
 * `width x height x depth` exactly (slabs extend outward), and the front wall
 * (-Z) has the `window` opening cut through it — four framing slabs whose
 * side faces automatically form a real window reveal.
 *
 * Thickness is load-bearing for shadow correctness, not decoration: with
 * zero-thickness walls, the occluder depth a shadow map stores at a concave
 * corner coincides exactly with the receiving wall's own depth at the shared
 * edge, and *no* shadow-map representation can tell them apart there — that
 * ambiguity was the root cause of a long-fought corner light leak (see
 * math/Clustered forward formulas.md Formula 6). With solid slabs the stored
 * occluder is the wall's sunlit *exterior* face, separated from interior
 * receivers by the full wall thickness — orders of magnitude above the
 * reconstruction threshold, eliminating the leak outright rather than
 * shrinking it. Slabs are tiled without overlap so no coplanar exterior
 * faces z-fight in exterior views.
 */
/**
 * @param width **interior** width; the slabs extend outward from it.
 * @param height interior floor-to-ceiling height.
 * @param depth interior depth.
 * @param window opening cut through the front (-Z) wall.
 * @param thickness wall/floor/ceiling slab thickness. Don't set this to 0 — see above.
 */
export function roomBox(width: number, height: number, depth: number, window: WindowCutout, thickness = 0.2): MeshData {
    const b = new MeshBuilder();
    const hw = width / 2;
    const hd = depth / 2;
    const t = thickness;

    b.addBox(vec3f(-hw - t, -t, -hd - t), vec3f(hw + t, 0, hd + t)); // floor
    b.addBox(vec3f(-hw - t, height, -hd - t), vec3f(hw + t, height + t, hd + t)); // ceiling
    b.addBox(vec3f(-hw - t, 0, -hd - t), vec3f(-hw, height, hd + t)); // left wall
    b.addBox(vec3f(hw, 0, -hd - t), vec3f(hw + t, height, hd + t)); // right wall
    b.addBox(vec3f(-hw, 0, hd), vec3f(hw, height, hd + t)); // back wall

    // Front wall (-Z, holds the window): four slabs framing the opening.
    const x0 = -hw + window.s0 * width;
    const x1 = -hw + window.s1 * width;
    const y0 = window.t0 * height;
    const y1 = window.t1 * height;
    b.addBox(vec3f(-hw, 0, -hd - t), vec3f(hw, y0, -hd)); // below window
    b.addBox(vec3f(-hw, y1, -hd - t), vec3f(hw, height, -hd)); // above window
    b.addBox(vec3f(-hw, y0, -hd - t), vec3f(x0, y1, -hd)); // left of window
    b.addBox(vec3f(x1, y0, -hd - t), vec3f(hw, y1, -hd)); // right of window

    return b.build();
}
