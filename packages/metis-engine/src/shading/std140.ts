import type { Mat4Arg, Vec3Arg } from "wgpu-matrix";

/**
 * Tiny builder for WGSL uniform/storage-buffer structs, which follow std140-style
 * alignment: vec3 rounds up to a 16-byte slot, mat4 is 4 vec4 columns, and
 * wgpu-matrix's `Mat3Arg` is already stored as 3 padded vec4 columns (12
 * floats — see wgpu-matrix.module.js `Ctor(12)`), so it can be written raw.
 * Every method aligns *before* writing, matching WGSL struct member rules.
 */
export class Std140Writer {
    private words: number[] = [];
    private kinds: Array<"f32" | "u32"> = [];

    private align(toWords: number) {
        while (this.words.length % toWords !== 0) {
            this.words.push(0);
            this.kinds.push("f32");
        }
    }

    f32(v: number): this {
        this.words.push(v);
        this.kinds.push("f32");
        return this;
    }

    u32(v: number): this {
        this.words.push(v);
        this.kinds.push("u32");
        return this;
    }

    vec2(x: number, y: number): this {
        this.align(2);
        return this.f32(x).f32(y);
    }

    /**
     * Writes `vec3<f32>` padded to 16 bytes. `w` fills the padding slot —
     * WGSL packs a scalar immediately following a vec3 into that gap (e.g.
     * `struct { position: vec3<f32>, range: f32 }` is 16 bytes total), so
     * pass the paired scalar here instead of leaving it as dead padding.
     */
    vec3(v: Vec3Arg | [number, number, number], w = 0): this {
        this.align(4);
        this.f32(v[0]!).f32(v[1]!).f32(v[2]!);
        return this.f32(w);
    }

    vec4(x: number, y: number, z: number, w: number): this {
        this.align(4);
        return this.f32(x).f32(y).f32(z).f32(w);
    }

    vec4u(x: number, y: number, z: number, w: number): this {
        this.align(4);
        return this.u32(x).u32(y).u32(z).u32(w);
    }

    mat4(m: Mat4Arg): this {
        this.align(4);
        for (let i = 0; i < 16; i++) this.f32(m[i]!);
        return this;
    }

    /** `m` must be a wgpu-matrix `Mat3Arg` (12 floats: 3 columns already padded to vec4). */
    mat3(m: Float32Array | Float64Array): this {
        this.align(4);
        for (let i = 0; i < 12; i++) this.f32(m[i]!);
        return this;
    }

    /** Pad the whole struct out to a multiple of `toWords` (WGSL rounds struct size up to its largest member alignment). */
    padToMultiple(toWords: number): this {
        this.align(toWords);
        return this;
    }

    byteLength(): number {
        return this.words.length * 4;
    }

    toBytes(): Uint8Array {
        const buf = new ArrayBuffer(this.words.length * 4);
        const dv = new DataView(buf);
        for (let i = 0; i < this.words.length; i++) {
            if (this.kinds[i] === "u32") dv.setUint32(i * 4, this.words[i]!, true);
            else dv.setFloat32(i * 4, this.words[i]!, true);
        }
        return new Uint8Array(buf);
    }
}
