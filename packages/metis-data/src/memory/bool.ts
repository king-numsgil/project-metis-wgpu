import type { BoolDescriptor } from "../descriptors";
import type { BoolMemoryBuffer } from "./index.ts";

export class BoolMemoryBufferImpl implements BoolMemoryBuffer {
    public readonly type: BoolDescriptor;
    public readonly buffer: ArrayBuffer;
    public readonly offset: number;

    public view(): ReturnType<BoolDescriptor["view"]> {
        return this.type.view(this.buffer, this.offset);
    }

    public constructor(descriptor: BoolDescriptor, buffer: ArrayBuffer, offset: number) {
        this.buffer = buffer;
        this.offset = offset;
        this.type = descriptor;
    }

    public get(): boolean {
        return this.view()[0]! !== 0;
    }

    public set(value: boolean): void {
        this.view().set([value ? 1 : 0]);
    }
}
