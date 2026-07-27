// Quantifies the allocation overhead in the math layer's get()/set() style, by
// racing each op against a hand-written view-based equivalent that computes the
// exact same arithmetic. The gap is the headroom a rewrite would recover.
//
//   bun run bench/mathAlloc.ts

import { F32, Mat3, Mat4, Quat, Vec3 } from "metis-data";

// High enough that even the cheapest op runs for tens of milliseconds. At 200k
// the vector ops finished in ~1 ms, where scheduler noise swamped the signal and
// the same unchanged op would swing between "at parity" and "not rewritten"
// across runs. If a verdict here looks surprising, check the raw ms first — a
// ratio built from two ~1 ms numbers is not evidence of anything.
const ITERS = 2_000_000;

/**
 * Ratios below this count as "no abstraction cost left". Deliberately loose:
 * function-call overhead alone puts a thin wrapper near 1.5x, and run-to-run
 * variance is worth another few tenths. An op that is genuinely still paying the
 * tuple cost lands far above this, not just over the line.
 */
const PARITY_THRESHOLD = 3;

function time(label: string, fn: () => void): number {
    fn(); // warm
    const t0 = performance.now();
    fn();
    const ms = performance.now() - t0;
    console.log(`  ${label.padEnd(34)} ${ms.toFixed(1).padStart(8)} ms`);
    return ms;
}

function report(name: string, current: number, viewBased: number) {
    const x = current / viewBased;
    console.log(`  ${"→ overhead vs open-coded".padEnd(34)} ${x.toFixed(2)}x\n`);
    return {name, current, viewBased, x};
}

const results: Array<{name: string; current: number; viewBased: number; x: number}> = [];

// ── Vec3.add ────────────────────────────────────────────────────────────────
{
    const a = Vec3.create(F32, 1, 2, 3);
    const b = Vec3.create(F32, 4, 5, 6);
    const out = Vec3.create(F32);
    console.log("Vec3.add");
    const cur = time("library op", () => {
        for (let i = 0; i < ITERS; i++) Vec3.add(out, a, b);
    });
    const av = a.view(), bv = b.view(), ov = out.view();
    const nv = time("view-based equivalent", () => {
        for (let i = 0; i < ITERS; i++) {
            ov[0] = av[0]! + bv[0]!;
            ov[1] = av[1]! + bv[1]!;
            ov[2] = av[2]! + bv[2]!;
        }
    });
    results.push(report("Vec3.add", cur, nv));
}

// ── Vec3.normalize ──────────────────────────────────────────────────────────
{
    const v = Vec3.create(F32, 3, 4, 12);
    const out = Vec3.create(F32);
    console.log("Vec3.normalize");
    const cur = time("library op", () => {
        for (let i = 0; i < ITERS; i++) Vec3.normalize(out, v);
    });
    const vv = v.view(), ov = out.view();
    const nv = time("view-based equivalent", () => {
        for (let i = 0; i < ITERS; i++) {
            const x = vv[0]!, y = vv[1]!, z = vv[2]!;
            const len = Math.sqrt(x * x + y * y + z * z);
            if (len > 0) { ov[0] = x / len; ov[1] = y / len; ov[2] = z / len; }
            else { ov[0] = 0; ov[1] = 0; ov[2] = 0; }
        }
    });
    results.push(report("Vec3.normalize", cur, nv));
}

// ── Vec3.transformMat4 (already view-based — the control) ───────────────────
{
    const v = Vec3.create(F32, 1, 2, 3);
    const out = Vec3.create(F32);
    const m = Mat4.translation(F32, 1, 2, 3);
    console.log("Vec3.transformMat4  [already view-based — control]");
    const cur = time("library op", () => {
        for (let i = 0; i < ITERS; i++) Vec3.transformMat4(out, v, m);
    });
    const mv = m.view(), vv = v.view(), ov = out.view(), c = m.columnElements;
    const nv = time("open-coded equivalent", () => {
        for (let i = 0; i < ITERS; i++) {
            const x = vv[0]!, y = vv[1]!, z = vv[2]!;
            const w = mv[3]! * x + mv[c + 3]! * y + mv[2 * c + 3]! * z + mv[3 * c + 3]!;
            const iw = w === 0 ? 1 : 1 / w;
            ov[0] = (mv[0]! * x + mv[c]! * y + mv[2 * c]! * z + mv[3 * c]!) * iw;
            ov[1] = (mv[1]! * x + mv[c + 1]! * y + mv[2 * c + 1]! * z + mv[3 * c + 1]!) * iw;
            ov[2] = (mv[2]! * x + mv[c + 2]! * y + mv[2 * c + 2]! * z + mv[3 * c + 2]!) * iw;
        }
    });
    results.push(report("Vec3.transformMat4", cur, nv));
}

// ── Mat4.multiply — the worst case ──────────────────────────────────────────
{
    const a = Mat4.translation(F32, 1, 2, 3);
    const b = Mat4.scaling(F32, 2, 2, 2);
    const out = Mat4.create(F32);
    console.log("Mat4.multiply");
    const cur = time("library op (still get/set)", () => {
        for (let i = 0; i < ITERS; i++) Mat4.multiply(out, a, b);
    });
    const av = a.view(), bv = b.view(), ov = out.view(), c = a.columnElements;
    const nv = time("view-based equivalent", () => {
        for (let i = 0; i < ITERS; i++) {
            for (let col = 0; col < 4; col++) {
                const b0 = bv[col * c]!, b1 = bv[col * c + 1]!, b2 = bv[col * c + 2]!, b3 = bv[col * c + 3]!;
                for (let row = 0; row < 4; row++) {
                    ov[col * c + row] =
                        av[row]! * b0 + av[c + row]! * b1 + av[2 * c + row]! * b2 + av[3 * c + row]! * b3;
                }
            }
        }
    });
    results.push(report("Mat4.multiply", cur, nv));
}

// ── Mat4.invert ─────────────────────────────────────────────────────────────
{
    const m = Mat4.lookAt(F32, Vec3.create(F32, 3, 4, 5), Vec3.create(F32, 0, 0, 0), Vec3.create(F32, 0, 1, 0));
    const out = Mat4.create(F32);
    console.log("Mat4.invert");
    const cur = time("library op", () => {
        for (let i = 0; i < ITERS; i++) Mat4.invert(out, m);
    });
    // Reference: the same cofactor expansion, all 16 outputs, through the views.
    //
    // Computing only part of the adjugate here would make the library op look
    // several times slower than it is — a reference that does less work than the
    // thing it is measuring is not a baseline, it is a wrong answer with a
    // confident label. (This bench shipped that mistake once.)
    const mv = m.view(), ov = out.view(), c = m.columnElements;
    const nv = time("open-coded equivalent", () => {
        for (let i = 0; i < ITERS; i++) {
            const m00 = mv[0]!, m01 = mv[1]!, m02 = mv[2]!, m03 = mv[3]!;
            const m10 = mv[c]!, m11 = mv[c + 1]!, m12 = mv[c + 2]!, m13 = mv[c + 3]!;
            const m20 = mv[2 * c]!, m21 = mv[2 * c + 1]!, m22 = mv[2 * c + 2]!, m23 = mv[2 * c + 3]!;
            const m30 = mv[3 * c]!, m31 = mv[3 * c + 1]!, m32 = mv[3 * c + 2]!, m33 = mv[3 * c + 3]!;
            const s0 = m22 * m33 - m23 * m32, s1 = m21 * m33 - m23 * m31, s2 = m21 * m32 - m22 * m31;
            const s3 = m20 * m33 - m23 * m30, s4 = m20 * m32 - m22 * m30, s5 = m20 * m31 - m21 * m30;
            const s6 = m12 * m33 - m13 * m32, s7 = m11 * m33 - m13 * m31, s8 = m11 * m32 - m12 * m31;
            const s9 = m10 * m33 - m13 * m30, s10 = m10 * m32 - m12 * m30, s11 = m10 * m31 - m11 * m30;
            const s12 = m12 * m23 - m13 * m22, s13 = m11 * m23 - m13 * m21, s14 = m11 * m22 - m12 * m21;
            const s15 = m10 * m23 - m13 * m20, s16 = m10 * m22 - m12 * m20, s17 = m10 * m21 - m11 * m20;
            const c0 = m11 * s0 - m12 * s1 + m13 * s2, c1 = m10 * s0 - m12 * s3 + m13 * s4;
            const c2 = m10 * s1 - m11 * s3 + m13 * s5, c3 = m10 * s2 - m11 * s4 + m12 * s5;
            const det = m00 * c0 - m01 * c1 + m02 * c2 - m03 * c3;
            const inv = det === 0 ? 0 : 1 / det;
            ov[0] = c0 * inv;
            ov[1] = (-m01 * s0 + m02 * s1 - m03 * s2) * inv;
            ov[2] = (m01 * s6 - m02 * s7 + m03 * s8) * inv;
            ov[3] = (-m01 * s12 + m02 * s13 - m03 * s14) * inv;
            ov[c] = -c1 * inv;
            ov[c + 1] = (m00 * s0 - m02 * s3 + m03 * s4) * inv;
            ov[c + 2] = (-m00 * s6 + m02 * s9 - m03 * s10) * inv;
            ov[c + 3] = (m00 * s12 - m02 * s15 + m03 * s16) * inv;
            ov[2 * c] = c2 * inv;
            ov[2 * c + 1] = (-m00 * s1 + m01 * s3 - m03 * s5) * inv;
            ov[2 * c + 2] = (m00 * s7 - m01 * s9 + m03 * s11) * inv;
            ov[2 * c + 3] = (-m00 * s13 + m01 * s15 - m03 * s17) * inv;
            ov[3 * c] = -c3 * inv;
            ov[3 * c + 1] = (m00 * s2 - m01 * s4 + m02 * s5) * inv;
            ov[3 * c + 2] = (-m00 * s8 + m01 * s10 - m02 * s11) * inv;
            ov[3 * c + 3] = (m00 * s14 - m01 * s16 + m02 * s17) * inv;
        }
    });
    results.push(report("Mat4.invert", cur, nv));
}

// ── Quat.multiply ───────────────────────────────────────────────────────────
{
    const a = Quat.fromEuler(Quat.identity(F32), 0.3, 0.4, 0.5);
    const b = Quat.fromEuler(Quat.identity(F32), -0.2, 0.7, 0.1);
    const out = Quat.identity(F32);
    console.log("Quat.multiply");
    const cur = time("library op", () => {
        for (let i = 0; i < ITERS; i++) Quat.multiply(out, a, b);
    });
    const av = a.view(), bv = b.view(), ov = out.view();
    const nv = time("open-coded equivalent", () => {
        for (let i = 0; i < ITERS; i++) {
            const ax = av[0]!, ay = av[1]!, az = av[2]!, aw = av[3]!;
            const bx = bv[0]!, by = bv[1]!, bz = bv[2]!, bw = bv[3]!;
            ov[0] = ax * bw + aw * bx + ay * bz - az * by;
            ov[1] = ay * bw + aw * by + az * bx - ax * bz;
            ov[2] = az * bw + aw * bz + ax * by - ay * bx;
            ov[3] = aw * bw - ax * bx - ay * by - az * bz;
        }
    });
    results.push(report("Quat.multiply", cur, nv));
}

// ── Mat3.multiply ───────────────────────────────────────────────────────────
{
    const a = Mat3.translation(F32, 1, 2);
    const b = Mat3.scaling(F32, 3, 3);
    const out = Mat3.create(F32);
    console.log("Mat3.multiply");
    const cur = time("library op", () => {
        for (let i = 0; i < ITERS; i++) Mat3.multiply(out, a, b);
    });
    const av = a.view(), bv = b.view(), ov = out.view(), c = a.columnElements;
    const nv = time("open-coded equivalent", () => {
        for (let i = 0; i < ITERS; i++) {
            for (let col = 0; col < 3; col++) {
                const b0 = bv[col * c]!, b1 = bv[col * c + 1]!, b2 = bv[col * c + 2]!;
                for (let row = 0; row < 3; row++) {
                    ov[col * c + row] = av[row]! * b0 + av[c + row]! * b1 + av[2 * c + row]! * b2;
                }
            }
        }
    });
    results.push(report("Mat3.multiply", cur, nv));
}

// ── Heap growth over a "frame" of typical renderer math ─────────────────────
{
    const a = Vec3.create(F32, 1, 2, 3);
    const b = Vec3.create(F32, 4, 5, 6);
    const out = Vec3.create(F32);
    const m = Mat4.translation(F32, 1, 2, 3);
    const mo = Mat4.create(F32);

    const frame = () => {
        for (let i = 0; i < 400; i++) Vec3.transformMat4(out, a, m); // per-light
        for (let i = 0; i < 200; i++) Vec3.add(out, a, b);            // cascade fitting
        for (let i = 0; i < 20; i++) Mat4.multiply(mo, m, m);         // matrices
    };

    frame();
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    for (let f = 0; f < 200; f++) frame();
    const after = process.memoryUsage().heapUsed;
    console.log("Heap growth over 200 simulated frames (no GC forced):");
    console.log(`  ${((after - before) / 1024 / 1024).toFixed(2)} MB  (${((after - before) / 200 / 1024).toFixed(1)} KB/frame)`);
}

// A ratio near 1 means the op is as fast as writing the arithmetic by hand and
// there is nothing left to win. A large ratio means the op is still paying the
// get()/set() tuple cost and is a candidate for the view-based rewrite.
console.log("\nSummary — overhead vs an open-coded equivalent:");
for (const r of results) {
    const verdict = r.x < PARITY_THRESHOLD ? "at parity (view-based)" : "NOT YET REWRITTEN";
    console.log(`  ${r.name.padEnd(22)} ${r.x.toFixed(2).padStart(6)}x   ${verdict}`);
}
