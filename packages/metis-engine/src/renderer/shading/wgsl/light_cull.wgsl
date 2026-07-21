// Sphere-vs-AABB test per (cluster, light), writing a fixed-capacity
// light index list per cluster (capacity = params.clusterCounts.w). No
// atomics needed: each cluster's slice of clusterLightIndices is only ever
// written by the one invocation that owns that cluster.

@group(0) @binding(0) var<uniform> params: ClusterParams;
@group(0) @binding(1) var<storage, read> lights: array<GpuLight>;
@group(0) @binding(2) var<storage, read> clusterAABBs: array<ClusterAABB>;
@group(0) @binding(3) var<storage, read_write> clusterLightCounts: array<u32>;
@group(0) @binding(4) var<storage, read_write> clusterLightIndices: array<u32>;

fn squaredDistancePointAABB(p: vec3<f32>, mn: vec3<f32>, mx: vec3<f32>) -> f32 {
    let clamped = clamp(p, mn, mx);
    let d = p - clamped;
    return dot(d, d);
}

@compute @workgroup_size(64)
fn cull(@builtin(global_invocation_id) gid: vec3<u32>) {
    let clusterIndex = gid.x;
    let numClusters = params.clusterCounts.x * params.clusterCounts.y * params.clusterCounts.z;
    if (clusterIndex >= numClusters) {
        return;
    }

    let aabb = clusterAABBs[clusterIndex];
    let maxPerCluster = params.clusterCounts.w;
    let lightCount = params.lightCount.x;
    let base = clusterIndex * maxPerCluster;

    var count: u32 = 0u;
    for (var i: u32 = 0u; i < lightCount; i = i + 1u) {
        if (count >= maxPerCluster) {
            break;
        }
        let light = lights[i];
        let d2 = squaredDistancePointAABB(light.viewPosition, aabb.minPoint, aabb.maxPoint);
        if (d2 <= light.range * light.range) {
            clusterLightIndices[base + count] = i;
            count = count + 1u;
        }
    }
    clusterLightCounts[clusterIndex] = count;
}
