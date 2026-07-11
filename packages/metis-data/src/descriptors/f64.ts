import { GPU_F64 } from "./constants.ts";
import { type F64Descriptor } from "./index.ts";

export class F64DescriptorImpl implements F64Descriptor {
    public get type(): typeof GPU_F64 {
        return GPU_F64;
    }

    public get byteSize(): 8 {
        return 8;
    }

    public get alignment(): 8 {
        return 8;
    }

    public get arrayPitch(): 8 {
        return 8;
    }

    public toString(): typeof GPU_F64 {
        return GPU_F64;
    }

    public view(buffer: ArrayBuffer, offset: number): Float64Array {
        return new Float64Array(buffer, offset, 1);
    }
}
