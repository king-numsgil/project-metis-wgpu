import {
    createSurface,
    requestAdapterForWindow,
    sdlCreateWindow,
    SdlEventType,
    sdlGetError,
    sdlGetJoysticks,
    sdlGetKeyboardState,
    sdlInit,
    SdlInitFlag,
    SdlJoyHat,
    SdlKeycode,
    sdlOpenJoystick,
    sdlPollEvents,
    sdlQuit,
    SdlScancode,
} from "bun-webgpu-rs";
import { scheduler } from "node:timers/promises";

console.log("before init");
sdlInit(SdlInitFlag.Video | SdlInitFlag.Joystick);
console.log("after init", sdlGetError());

const wnd = sdlCreateWindow("Metis Rendering Window", 1440, 768);
console.log(`Wnd: ${wnd.id}`);
const adapter = await requestAdapterForWindow(wnd, {
    powerPreference: "high-performance",
    backend: "vulkan",
});

const keyboard = sdlGetKeyboardState();

if (!adapter) {
    sdlQuit();
    throw new Error("No GPU adapter compatible with this window");
}

const device = await adapter.requestDevice({label: "metis-device"});
const surface = createSurface(adapter, wnd);
const fmt = surface.getPreferredFormat();
surface.configure(device, {width: wnd.width, height: wnd.height});

const SHADER = /* wgsl */ `
struct Out { @builtin(position) pos: vec4<f32> }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> Out {
  var p = array<vec2<f32>, 3>(
    vec2<f32>( 0.0,  0.5),   // top-center
    vec2<f32>(-0.5, -0.5),   // bottom-left
    vec2<f32>( 0.5, -0.5),   // bottom-right
  );
  return Out(vec4<f32>(p[vi], 0.0, 1.0));
}

@fragment fn fs() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
`;

const shaderModule = device.createShaderModule({code: SHADER});

// Pipeline that targets the surface's native format (e.g. bgra8unorm-srgb).
const displayPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {module: shaderModule, entryPoint: "vs"},
    fragment: {module: shaderModule, entryPoint: "fs", targets: [{format: fmt}]},
});

const joysticks = sdlGetJoysticks().map((id) => sdlOpenJoystick(id));
joysticks.forEach(joystick => console.log(`Found Joystick with ID ${joystick.instanceId()} and name "${joystick.name()}"`));

function hatValueToString(value: SdlJoyHat): string {
    switch (value) {
        case SdlJoyHat.Centered:
            return "Centered";
        case SdlJoyHat.Down:
            return "Down";
        case SdlJoyHat.Left:
            return "Left";
        case SdlJoyHat.Right:
            return "Right";
        case SdlJoyHat.LeftDown:
            return "LeftDown";
        case SdlJoyHat.LeftUp:
            return "LeftUp";
        case SdlJoyHat.RightDown:
            return "RightDown";
        case SdlJoyHat.RightUp:
            return "RightUp";
        case SdlJoyHat.Up:
            return "Up";
    }
}

let running = true;
while (running) {
    for (const e of sdlPollEvents()) {
        if (e.type === SdlEventType.WindowCloseRequested || e.type === SdlEventType.Quit) {
            running = false;
        }
        if (e.type === SdlEventType.KeyDown && e.keycode === SdlKeycode.Escape) {
            running = false;
        }

        if (e.type === SdlEventType.JoystickAxisMotion) {
            console.log(`JoystickAxisMotion : Joystic #${e.which} Axis #${e.axis} = ${e.axisValue}`);
        }

        if (e.type === SdlEventType.JoystickButtonDown) {
            console.log(`JoystickButtonDown : Joystic #${e.which} Button #${e.button}`);
        }

        if (e.type === SdlEventType.JoystickHatMotion) {
            console.log(`JoystickHatMotion : Joystic #${e.which} Hat #${e.hat} = ${hatValueToString(e.hatValue!)}`);
        }
    }

    if (keyboard.get(SdlScancode.W)) {
        console.log("W is pressed!");
    }

    const frame = surface.getCurrentTexture();
    if (frame.suboptimal) {
        surface.configure(device, {width: wnd.width, height: wnd.height});
    }

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: frame.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: {r: 0, g: 0, b: 0, a: 1},
        }],
    });
    pass.setPipeline(displayPipeline);
    pass.draw(3);
    pass.end();

    device.queue.submit([encoder.finish()]);

    frame.present();
    await scheduler.yield();
}

joysticks.forEach((joystick) => joystick.close());

wnd.destroy();
sdlQuit();
