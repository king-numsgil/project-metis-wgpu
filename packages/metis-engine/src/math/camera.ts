import { mat4, type Mat4Arg, vec3, type Vec3Arg } from "wgpu-matrix";

/** A look-at perspective camera. Update `position`/`target` per frame for orbit/fly controls. */
export class Camera {
    position: Vec3Arg = vec3.create(0, 0, 5);
    target: Vec3Arg = vec3.create(0, 0, 0);
    up: Vec3Arg = vec3.create(0, 1, 0);
    fovYRadians = Math.PI / 4;
    aspect = 16 / 9;
    near = 0.1;
    far = 1000;

    setAspectFromSize(width: number, height: number) {
        this.aspect = width / Math.max(1, height);
    }

    viewMatrix(dst?: Mat4Arg): Mat4Arg {
        return mat4.lookAt(this.position, this.target, this.up, dst);
    }

    projectionMatrix(dst?: Mat4Arg): Mat4Arg {
        return mat4.perspective(this.fovYRadians, this.aspect, this.near, this.far, dst);
    }

    viewProjectionMatrix(dst?: Mat4Arg): Mat4Arg {
        const v = this.viewMatrix();
        const p = this.projectionMatrix();
        return mat4.multiply(p, v, dst);
    }
}
