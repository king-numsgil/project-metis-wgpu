import { GPU_F16 } from "./constants.ts";
import { type F16Descriptor } from "./index.ts";

export class F16DescriptorImpl implements F16Descriptor {
    public get type(): typeof GPU_F16 {
        return GPU_F16;
    }

    public get byteSize(): 2 {
        return 2;
    }

    public get alignment(): 2 {
        return 2;
    }

    public get arrayPitch(): 2 {
        return 2;
    }

    public toString(): typeof GPU_F16 {
        return GPU_F16;
    }

    public view(buffer: ArrayBuffer, offset: number): Float16Array {
        return new Float16Array(buffer, offset, 1);
    }
}
