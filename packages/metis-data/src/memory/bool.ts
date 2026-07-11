import type { BoolDescriptor } from "../descriptors";
import type { BoolMemoryBuffer } from "./index.ts";

export class BoolMemoryBufferImpl implements BoolMemoryBuffer {
    public readonly type: BoolDescriptor;
    public readonly buffer: ArrayBuffer;
    public readonly offset: number;
    private readonly _view: Uint32Array;

    public constructor(descriptor: BoolDescriptor, buffer: ArrayBuffer, offset: number) {
        this.type = descriptor;
        this.buffer = buffer;
        this.offset = offset;
        this._view = descriptor.view(buffer, offset);
    }

    public view(): ReturnType<BoolDescriptor["view"]> {
        return this._view;
    }

    public get(): boolean {
        return this._view[0]! !== 0;
    }

    public set(value: boolean): void {
        this._view[0] = value ? 1 : 0;
    }
}
