import { GPU_I32 } from "./constants.ts";
import { type I32Descriptor } from "./index.ts";

export class I32DescriptorImpl implements I32Descriptor {
    public get type(): typeof GPU_I32 {
        return GPU_I32;
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

    public toString(): typeof GPU_I32 {
        return GPU_I32;
    }

    public view(buffer: ArrayBuffer, offset: number): Int32Array {
        return new Int32Array(buffer, offset, 1);
    }
}
