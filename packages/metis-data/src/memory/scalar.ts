import type { ScalarDescriptor } from "../descriptors";
import type { ScalarMemoryBuffer } from "./index.ts";

export class ScalarMemoryBufferImpl<
    ScalarType extends ScalarDescriptor,
> implements ScalarMemoryBuffer<ScalarType> {
    public readonly type: ScalarType;
    public readonly buffer: ArrayBuffer;
    public readonly offset: number;
    // The region view is built once here, so get/set don't construct a fresh
    // typed array on every call.
    private readonly _view: ReturnType<ScalarType["view"]>;

    public constructor(descriptor: ScalarType, buffer: ArrayBuffer, offset: number) {
        this.type = descriptor;
        this.buffer = buffer;
        this.offset = offset;
        this._view = descriptor.view(buffer, offset) as ReturnType<ScalarType["view"]>;
    }

    public view(): ReturnType<ScalarType["view"]> {
        return this._view;
    }

    public get(): number {
        return this._view[0]! as number;
    }

    public set(value: number): void {
        this._view[0] = value;
    }
}
