import { vec3, type Vec3Arg } from "wgpu-matrix";

/** Interleaved `[px,py,pz, nx,ny,nz, tx,ty,tz,tw, u,v]` per vertex (stride 48 bytes) — see scene/mesh.ts's vertex layout. */
export interface MeshData {
    vertices: Float32Array;
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
    addQuad(origin: Vec3Arg, u: Vec3Arg, v: Vec3Arg) {
        const normal = vec3.normalize(vec3.cross(u, v));
        const tangent = vec3.normalize(u);
        const base = this.verts.length / FLOATS_PER_VERTEX;
        const corners: [Vec3Arg, number, number][] = [
            [origin, 0, 0],
            [vec3.add(origin, u), 1, 0],
            [vec3.add(vec3.add(origin, u), v), 1, 1],
            [vec3.add(origin, v), 0, 1],
        ];
        for (const [p, uu, vv] of corners) {
            this.verts.push(
                p[0]!, p[1]!, p[2]!,
                normal[0]!, normal[1]!, normal[2]!,
                tangent[0]!, tangent[1]!, tangent[2]!, 1,
                uu, vv,
            );
        }
        this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    /** Adds an axis-aligned box spanning `[min, max]` with outward-facing quads. */
    addBox(min: Vec3Arg, max: Vec3Arg) {
        const sx = max[0]! - min[0]!;
        const sy = max[1]! - min[1]!;
        const sz = max[2]! - min[2]!;
        // +X / -X
        this.addQuad(vec3.create(max[0]!, min[1]!, max[2]!), vec3.create(0, 0, -sz), vec3.create(0, sy, 0));
        this.addQuad(vec3.create(min[0]!, min[1]!, min[2]!), vec3.create(0, 0, sz), vec3.create(0, sy, 0));
        // +Y / -Y
        this.addQuad(vec3.create(min[0]!, max[1]!, min[2]!), vec3.create(0, 0, sz), vec3.create(sx, 0, 0));
        this.addQuad(vec3.create(min[0]!, min[1]!, min[2]!), vec3.create(sx, 0, 0), vec3.create(0, 0, sz));
        // +Z / -Z
        this.addQuad(vec3.create(min[0]!, min[1]!, max[2]!), vec3.create(sx, 0, 0), vec3.create(0, sy, 0));
        this.addQuad(vec3.create(max[0]!, min[1]!, min[2]!), vec3.create(-sx, 0, 0), vec3.create(0, sy, 0));
    }

    addTriIndexed(positions: Vec3Arg[], normals: Vec3Arg[], tangents: Vec3Arg[], uvs: [number, number][]) {
        const base = this.verts.length / FLOATS_PER_VERTEX;
        for (let i = 0; i < positions.length; i++) {
            const p = positions[i]!;
            const n = normals[i]!;
            const t = tangents[i]!;
            const uv = uvs[i]!;
            this.verts.push(p[0]!, p[1]!, p[2]!, n[0]!, n[1]!, n[2]!, t[0]!, t[1]!, t[2]!, 1, uv[0]!, uv[1]!);
        }
        return base;
    }

    pushIndices(...i: number[]) {
        this.idx.push(...i);
    }

    build(): MeshData {
        return { vertices: new Float32Array(this.verts), indices: new Uint32Array(this.idx) };
    }
}

/** A single-quad plane on the XZ plane, facing +Y, centered at the origin. */
export function plane(width: number, depth: number): MeshData {
    const b = new MeshBuilder();
    const hw = width / 2;
    const hd = depth / 2;
    b.addQuad(vec3.create(-hw, 0, hd), vec3.create(width, 0, 0), vec3.create(0, 0, -depth));
    return b.build();
}

/** An axis-aligned box centered at the origin with outward-facing normals. */
export function cube(sx: number, sy: number, sz: number): MeshData {
    const b = new MeshBuilder();
    b.addBox(vec3.create(-sx / 2, -sy / 2, -sz / 2), vec3.create(sx / 2, sy / 2, sz / 2));
    return b.build();
}

/** A UV sphere with outward-facing normals, centered at the origin. */
export function uvSphere(radius: number, latBands = 24, lonBands = 32): MeshData {
    const b = new MeshBuilder();
    const positions: Vec3Arg[] = [];
    const normals: Vec3Arg[] = [];
    const tangents: Vec3Arg[] = [];
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
            positions.push(vec3.create(x * radius, y * radius, z * radius));
            normals.push(vec3.create(x, y, z));
            // Tangent = d(position)/d(longitude), i.e. the direction U
            // increases along — degenerates at the poles (sinT = 0), same
            // known singularity every UV sphere has.
            tangents.push(vec3.create(-Math.sin(phi), 0, Math.cos(phi)));
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

export interface WindowCutout {
    /** Horizontal opening as a fraction [0,1] of the front wall's width. */
    s0: number;
    s1: number;
    /** Vertical opening as a fraction [0,1] of the front wall's height. */
    t0: number;
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
export function roomBox(width: number, height: number, depth: number, window: WindowCutout, thickness = 0.2): MeshData {
    const b = new MeshBuilder();
    const hw = width / 2;
    const hd = depth / 2;
    const t = thickness;

    b.addBox(vec3.create(-hw - t, -t, -hd - t), vec3.create(hw + t, 0, hd + t)); // floor
    b.addBox(vec3.create(-hw - t, height, -hd - t), vec3.create(hw + t, height + t, hd + t)); // ceiling
    b.addBox(vec3.create(-hw - t, 0, -hd - t), vec3.create(-hw, height, hd + t)); // left wall
    b.addBox(vec3.create(hw, 0, -hd - t), vec3.create(hw + t, height, hd + t)); // right wall
    b.addBox(vec3.create(-hw, 0, hd), vec3.create(hw, height, hd + t)); // back wall

    // Front wall (-Z, holds the window): four slabs framing the opening.
    const x0 = -hw + window.s0 * width;
    const x1 = -hw + window.s1 * width;
    const y0 = window.t0 * height;
    const y1 = window.t1 * height;
    b.addBox(vec3.create(-hw, 0, -hd - t), vec3.create(hw, y0, -hd)); // below window
    b.addBox(vec3.create(-hw, y1, -hd - t), vec3.create(hw, height, -hd)); // above window
    b.addBox(vec3.create(-hw, y0, -hd - t), vec3.create(x0, y1, -hd)); // left of window
    b.addBox(vec3.create(x1, y0, -hd - t), vec3.create(hw, y1, -hd)); // right of window

    return b.build();
}
