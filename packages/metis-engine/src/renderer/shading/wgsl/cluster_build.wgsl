// Computes each cluster's view-space AABB. Dispatched once per frame (see
// clusteredForwardRenderer.ts — the plan called for rebuilding only when the
// projection changes, but at ~3.5K clusters this is cheap enough to just
// redo every frame and skip the cache-invalidation bookkeeping).

@group(0) @binding(0) var<uniform> params: ClusterParams;
@group(0) @binding(1) var<storage, read_write> clusterAABBs: array<ClusterAABB>;

// Unprojects a screen-space pixel to a point on the far side of the frustum,
// in view space (the direction of the ray from the camera through that pixel).
fn screenToViewRay(pixel: vec2<f32>, screenSize: vec2<f32>) -> vec3<f32> {
    let ndc = vec2<f32>(pixel.x / screenSize.x, 1.0 - pixel.y / screenSize.y) * 2.0 - 1.0;
    var view = params.invProj * vec4<f32>(ndc, 1.0, 1.0);
    view = view / view.w;
    return view.xyz;
}

// Intersects the ray from the origin through `rayPoint` with the view-space
// plane z = targetZ (both negative, camera looks down -Z).
fn intersectZPlane(rayPoint: vec3<f32>, targetZ: f32) -> vec3<f32> {
    let t = targetZ / rayPoint.z;
    return rayPoint * t;
}

@compute @workgroup_size(64)
fn build(@builtin(global_invocation_id) gid: vec3<u32>) {
    let index = gid.x;
    let countX = params.clusterCounts.x;
    let countY = params.clusterCounts.y;
    let countZ = params.clusterCounts.z;
    let numClusters = countX * countY * countZ;
    if (index >= numClusters) {
        return;
    }

    let x = index % countX;
    let y = (index / countX) % countY;
    let z = index / (countX * countY);

    let screenSize = params.screenSizeZNearFar.xy;
    let zNear = params.screenSizeZNearFar.z;
    let zFar = params.screenSizeZNearFar.w;
    let tileSize = screenSize / vec2<f32>(f32(countX), f32(countY));

    let minPixel = vec2<f32>(f32(x), f32(y)) * tileSize;
    let maxPixel = vec2<f32>(f32(x + 1u), f32(y + 1u)) * tileSize;

    let rayMinMin = screenToViewRay(minPixel, screenSize);
    let rayMaxMin = screenToViewRay(vec2<f32>(maxPixel.x, minPixel.y), screenSize);
    let rayMinMax = screenToViewRay(vec2<f32>(minPixel.x, maxPixel.y), screenSize);
    let rayMaxMax = screenToViewRay(maxPixel, screenSize);

    // Exponential slicing (see common.wgsl's clusterZIndex for the inverse).
    let sliceNear = zNear * pow(zFar / zNear, f32(z) / f32(countZ));
    let sliceFar = zNear * pow(zFar / zNear, f32(z + 1u) / f32(countZ));

    let p0 = intersectZPlane(rayMinMin, -sliceNear);
    let p1 = intersectZPlane(rayMaxMin, -sliceNear);
    let p2 = intersectZPlane(rayMinMax, -sliceNear);
    let p3 = intersectZPlane(rayMaxMax, -sliceNear);
    let p4 = intersectZPlane(rayMinMin, -sliceFar);
    let p5 = intersectZPlane(rayMaxMin, -sliceFar);
    let p6 = intersectZPlane(rayMinMax, -sliceFar);
    let p7 = intersectZPlane(rayMaxMax, -sliceFar);

    var minPoint = min(p0, min(p1, min(p2, min(p3, min(p4, min(p5, min(p6, p7)))))));
    var maxPoint = max(p0, max(p1, max(p2, max(p3, max(p4, max(p5, max(p6, p7)))))));

    var aabb: ClusterAABB;
    aabb.minPoint = minPoint;
    aabb.maxPoint = maxPoint;
    clusterAABBs[index] = aabb;
}
