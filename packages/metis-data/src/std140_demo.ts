import { ArrayOf, F32, F64, Mat, PackingType, StructOf, Vec } from "./descriptors";

function printStruct(name: string, s: ReturnType<typeof StructOf>): void {
    console.log(`${name}: ${s.toString()}`);
    console.log(`  byteSize:   ${s.byteSize}`);
    console.log(`  alignment:  ${s.alignment}`);
    console.log(`  arrayPitch: ${s.arrayPitch}`);
    for (const key of Object.keys(s.members)) {
        console.log(`  ${key} offset: ${s.offsetOf(key as never)}`);
    }
}

// A couple of sanity checks against std140 expectations.
const A = StructOf(
    {
        a: F32,
        b: F32,
    },
    PackingType.Std140,
);

const B = StructOf(
    {
        a: Vec(F32, 3, PackingType.Std140),
        b: F32,
    },
    PackingType.Std140,
);

const C = StructOf(
    {
        a: Vec(F32, 2, PackingType.Std140),
        b: F32,
    },
    PackingType.Std140,
);

const floatArray = ArrayOf(F32, 4, PackingType.Std140);
const mat2f = Mat(F32, 2, PackingType.Std140);
const mat2d = Mat(F64, 2, PackingType.Std140);

printStruct("A", A);
printStruct("B", B);
printStruct("C", C);

console.log(`floatArray: ${floatArray.toString()}`);
console.log(`  byteSize:   ${floatArray.byteSize}`);
console.log(`  alignment:  ${floatArray.alignment}`);
console.log(`  arrayPitch: ${floatArray.arrayPitch}`);

console.log(`mat2f: ${mat2f.toString()}`);
console.log(`  byteSize:     ${mat2f.byteSize}`);
console.log(`  alignment:    ${mat2f.alignment}`);
console.log(`  columnStride: ${mat2f.columnStride}`);

console.log(`mat2d: ${mat2d.toString()}`);
console.log(`  byteSize:     ${mat2d.byteSize}`);
console.log(`  alignment:    ${mat2d.alignment}`);
console.log(`  columnStride: ${mat2d.columnStride}`);
