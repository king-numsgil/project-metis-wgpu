import { GPU_BOOL } from "./constants.ts";
import { type BoolDescriptor } from "./index.ts";

export class BoolDescriptorImpl implements BoolDescriptor {
    public get type(): typeof GPU_BOOL {
        return GPU_BOOL;
    }

    public get byteSize(): 4 {
        return 4;
    }

    public get alignment(): 4 {
        return 4;
    }

    public get arrayPitch(): 4 {
        return 4;
    }

    public toString(): typeof GPU_BOOL {
        return GPU_BOOL;
    }

    public view(buffer: ArrayBuffer, offset: number): Uint32Array {
        return new Uint32Array(buffer, offset, 1);
    }
}
