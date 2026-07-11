import type { ScalarDescriptor } from "../descriptors";
import type { ScalarMemoryBuffer } from "./index.ts";

export class ScalarMemoryBufferImpl<
    ScalarType extends ScalarDescriptor,
> implements ScalarMemoryBuffer<ScalarType> {
    public readonly type: ScalarType;
    public readonly buffer: ArrayBuffer;
    public readonly offset: number;

    public view(): ReturnType<ScalarType["view"]> {
        return this.type.view(this.buffer, this.offset) as ReturnType<ScalarType["view"]>;
    }

    public constructor(descriptor: ScalarType, buffer: ArrayBuffer, offset: number) {
        this.buffer = buffer;
        this.offset = offset;
        this.type = descriptor;
    }

    public get(): number {
        return this.view()[0]!;
    }

    public set(value: number): void {
        this.view().set([value]);
    }
}
