import type { Descriptor, DescriptorTypedArray, StructDescriptor } from "../descriptors";
import { GPU_ARRAY, GPU_MAT2, GPU_MAT3, GPU_MAT4, GPU_STRUCT } from "../descriptors/constants.ts";
import { type DescriptorToMemoryBuffer, type DescriptorValueType, type StructMemoryBuffer, wrap } from "./index.ts";

export class StructMemoryBufferImpl<
    Members extends Record<string, Descriptor<DescriptorTypedArray>>,
> implements StructMemoryBuffer<Members> {
    public readonly type: StructDescriptor<Members>;
    public readonly buffer: ArrayBuffer;
    public readonly offset: number;

    public view(): ReturnType<StructDescriptor<Members>["view"]> {
        return this.type.view(this.buffer, this.offset);
    }

    public constructor(descriptor: StructDescriptor<Members>, buffer: ArrayBuffer, offset: number) {
        this.type = descriptor;
        this.buffer = buffer;
        this.offset = offset;
    }

    public get members(): Members {
        return this.type.members;
    }

    public get<K extends keyof Members>(name: K): DescriptorToMemoryBuffer<Members[K]> {
        const offset = this.offset + this.type.offsetOf(name);
        return wrap(this.members[name], this.buffer, offset);
    }

    public set(value: { [K in keyof Members]: DescriptorValueType<Members[K]> }): void {
        for (const key of Object.keys(value) as Array<keyof Members>) {
            const memberBuffer = this.get(key);
            this.setBufferValue(memberBuffer, value[key]);
        }
    }

    private setBufferValue<T extends Descriptor<DescriptorTypedArray>>(buffer: DescriptorToMemoryBuffer<T>, value: unknown): void {
        switch (buffer.type.type) {
            case GPU_STRUCT:
                (buffer as StructMemoryBuffer<Record<string, Descriptor<DescriptorTypedArray>>>).set(value as never);
                break;
            case GPU_ARRAY: {
                const arrayBuffer = buffer as unknown as {
                    at: (index: number) => DescriptorToMemoryBuffer<T>;
                    type: { length: number }
                };
                const arrayValue = value as unknown[];
                for (let i = 0; i < arrayBuffer.type.length; i++) {
                    this.setBufferValue(arrayBuffer.at(i), arrayValue[i]);
                }
                break;
            }
            case GPU_MAT2:
            case GPU_MAT3:
            case GPU_MAT4: {
                const matBuffer = buffer as { set: (colIndex: number, value: unknown) => void };
                const matValue = value as unknown[][];
                for (let i = 0; i < matValue.length; i++) {
                    matBuffer.set(i, matValue[i]);
                }
                break;
            }
            default:
                // Scalar, Bool, or Vec
                (buffer as { set: (value: unknown) => void }).set(value);
                break;
        }
    }
}
