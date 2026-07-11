import { GPU_U32 } from "./constants.ts";
import { type U32Descriptor } from "./index.ts";

export class U32DescriptorImpl implements U32Descriptor {
    public get type(): typeof GPU_U32 {
        return GPU_U32;
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

    public toString(): typeof GPU_U32 {
        return GPU_U32;
    }

    public view(buffer: ArrayBuffer, offset: number): Uint32Array {
        return new Uint32Array(buffer, offset, 1);
    }
}
