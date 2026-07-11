import { GPU_F32 } from "./constants.ts";
import { type F32Descriptor } from "./index.ts";

export class F32DescriptorImpl implements F32Descriptor {
    public get type(): typeof GPU_F32 {
        return GPU_F32;
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

    public toString(): typeof GPU_F32 {
        return GPU_F32;
    }

    public view(buffer: ArrayBuffer, offset: number): Float32Array {
        return new Float32Array(buffer, offset, 1);
    }
}
