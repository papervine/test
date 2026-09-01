"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Gradient Waves — the pricing page's backdrop: a raymarched plasma sea that drifts under the
 * masthead, rendered by a fragment shader.
 *
 * Vendored from React Bits (https://reactbits.dev/backgrounds/gradient-waves),
 * Copyright (c) 2026 David Haz, MIT + Commons Clause. Permitted: using and modifying it inside
 * an application or website, commercially. Not permitted: selling or redistributing the
 * component itself. That is why this lives in `src/components/platform/` — the web app, which
 * the public mirrors (`apps/cli`, `packages/renderer`, `examples/starter`; see
 * scripts/mirror-cli.mjs) do NOT publish. Don't move it under a mirrored path.
 *
 * The two shader programs are upstream's, verbatim, and the prop surface is upstream's too, so a
 * future re-sync is a diff rather than a rewrite. The React around them is adapted the same four
 * ways as `PrismaticBurst` — read that file for the full reasoning; in short:
 *
 *  1. **`ogl` is imported lazily**, inside the effect, so ~90KB of WebGL plumbing never sits in
 *     the bundle the page blocks on.
 *  2. **Reduced motion means no shader at all** — not a paused canvas.
 *  3. **WebGL2 or nothing.** These shaders are `#version 300 es`; ogl silently falls back to a
 *     WebGL1 context where they cannot compile, which would paint a black slab over the page.
 *  4. **Every failure path is silent and leaves the fallback visible** (`.db-waves` paints a
 *     static wash of its own).
 *
 * One adaptation upstream doesn't have: the raymarch cost scales with the number of fragments, so
 * `.db-waves` bounds the layer's HEIGHT rather than filling the page. On a long marketing page an
 * `inset: 0` backdrop would be several viewports tall — the same shader over four times the
 * pixels, for atmosphere nobody scrolls back up to see.
 */

const vertexShader = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaveScale;
uniform float uWaveRatio;
uniform float uSwell;
uniform float uTurbulence;
uniform float uTilt;
uniform float uZoom;
uniform float uHeight;
uniform float uFogDepth;
uniform float uSteps;
uniform float uBrightness;
uniform float uOpacity;
uniform float uGrain;
uniform float uGrainIntensity;
uniform vec2 uMouse;
uniform float uParallax;
uniform bool uEnableMouse;
uniform vec3 uHorizonColor;
uniform vec3 uWaveColor;
uniform vec3 uCrestColor;
out vec4 fragColor;

const float MAX_DIST = 20000.0;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float plasma(vec3 r, vec2 freq, vec4 tc) {
  float mx = r.x + tc.x;
  mx += uSwell * sin((r.y + mx) / 20.0 + tc.y);
  float my = r.y - tc.z;
  my += uTurbulence * cos(r.x / 23.0 + tc.w);
  return r.z - (sin(mx * freq.x) * uAmplitude + sin(my * freq.y) * uAmplitude + uHeight);
}

float raymarch(vec3 pos, vec3 dir, vec2 freq, vec4 tc) {
  float dist = 0.0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps) break;
    float dscene = plasma(pos + dist * dir, freq, tc);
    if (abs(dscene) < 0.1) break;
    dist += 0.9 * dscene;
    if (!(abs(dist) < MAX_DIST)) return MAX_DIST;
  }
  return dist;
}

void main() {
  float T = iTime * uSpeed;
  vec2 freq = vec2(uWaveScale / 7.0, (uWaveScale * uWaveRatio) / 3.0);
  vec4 tc = vec4(T / 0.130, T / 0.810, T / 0.200, T / 0.710);
  float c, s;
  float vfov = (3.14159 / 2.3) / max(uZoom, 0.05);
  vec3 cam = vec3(0.0, 0.0, 30.0);
  vec2 uv = (gl_FragCoord.xy / iResolution.xy) - 0.5;
  uv.x *= iResolution.x / iResolution.y;
  uv.y *= -1.0;

  vec3 dir = vec3(0.0, 0.0, -1.0);
  float ulen = length(uv);
  float xrot = vfov * ulen;
  c = cos(xrot); s = sin(xrot);
  dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  vec2 nuv = ulen > 1e-5 ? uv / ulen : vec2(1.0, 0.0);
  c = nuv.x; s = nuv.y;
  dir = mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0) * dir;
  c = cos(uTilt); s = sin(uTilt);
  dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;

  if (uEnableMouse) {
    float yaw = (uMouse.x - 0.5) * uParallax * 0.4;
    float pitch = (uMouse.y - 0.5) * uParallax * 0.4;
    c = cos(yaw); s = sin(yaw);
    dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;
    c = cos(pitch); s = sin(pitch);
    dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  }

  float dist = raymarch(cam, dir, freq, tc);
  vec3 pos = cam + dist * dir;

  float t = clamp(uFogDepth / max(dist, 0.001), 0.0, 1.0);
  vec3 body = mix(uWaveColor, uCrestColor, clamp(pos.z * 0.08 + 0.5, 0.0, 1.0));
  vec3 col = mix(uHorizonColor, body, t);
  col *= uBrightness;
  col = clamp(col, 0.0, 1.0);

  float alpha = clamp(t, 0.0, 1.0) * uOpacity;
  if (uGrain > 0.5) {
    float g = hash21(gl_FragCoord.xy + mod(iTime, 64.0) * 11.0);
    alpha += (g - 0.5) * uGrainIntensity;
  }
  alpha = clamp(alpha, 0.0, 1.0);
  fragColor = vec4(col * alpha, alpha);
}
`;

export type GradientWavesDetail = "low" | "medium" | "high";

export type GradientWavesProps = {
  horizonColor?: string;
  waveColor?: string;
  crestColor?: string;
  speed?: number;
  amplitude?: number;
  waveScale?: number;
  waveRatio?: number;
  swell?: number;
  turbulence?: number;
  tilt?: number;
  zoom?: number;
  height?: number;
  fogDepth?: number;
  detail?: GradientWavesDetail;
  brightness?: number;
  opacity?: number;
  mouseInteraction?: boolean;
  parallaxStrength?: number;
  grain?: boolean;
  grainIntensity?: number;
  className?: string;
};

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  return [
    parseInt(m[1], 16) / 255,
    parseInt(m[2], 16) / 255,
    parseInt(m[3], 16) / 255,
  ];
}

// Raymarch steps. "high" is 110 iterations PER FRAGMENT, which is a real cost for a backdrop;
// the platform uses "low" and the difference is invisible behind the mask.
function detailToSteps(detail: GradientWavesDetail): number {
  if (detail === "low") return 40;
  if (detail === "high") return 110;
  return 70;
}

export function GradientWaves({
  horizonColor = "#5227FF",
  waveColor = "#FF9FFC",
  crestColor = "#FFFFFF",
  speed = 0.4,
  amplitude = 2.5,
  waveScale = 0.6,
  waveRatio = 0.9,
  swell = 35,
  turbulence = 20,
  tilt = 1.11,
  zoom = 1,
  height = 5.5,
  fogDepth = 15,
  detail = "medium",
  brightness = 1,
  opacity = 1,
  mouseInteraction = true,
  parallaxStrength = 0.5,
  grain = true,
  grainIntensity = 0.05,
  className = "",
}: GradientWavesProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const programRef = useRef<ProgramLike | null>(null);
  const enableMouseRef = useRef(mouseInteraction);
  // Flipped once the GL program exists, which is what lets the props effect below be the ONLY
  // place uniforms are written: it runs again on `ready`, so the first paint gets our props even
  // though setup finishes after the first render (the `ogl` import is async).
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Adaptation 2: asked for less motion → no canvas, no GPU work, keep the CSS wash.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let disposed = false;
    let teardown: (() => void) | undefined;

    void (async () => {
      let ogl: typeof import("ogl");
      try {
        // Adaptation 1: off the critical path. A failed chunk is a missing flourish, nothing more.
        ogl = await import("ogl");
      } catch {
        return;
      }
      if (disposed) return;
      try {
        teardown = start(ogl, container);
        setReady(true);
      } catch {
        // A driver that refuses the context, a blocked GPU, a compile failure on an exotic
        // device — all of them land here, and all of them mean "show the fallback".
        teardown?.();
      }
    })();

    function start(ogl: typeof import("ogl"), host: HTMLDivElement): () => void {
      const { Renderer, Program, Mesh, Triangle } = ogl;
      // dpr capped at 2: this is a ray march, and a 3x retina buffer triples the fragment count
      // for a backdrop nobody is looking straight at.
      const renderer = new Renderer({
        webgl: 2,
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      });
      const gl = renderer.gl;
      // Adaptation 3: ogl reports what it actually got, so check rather than trust the request.
      if (!(typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext)) {
        loseContext(gl);
        throw new Error("webgl2-unavailable");
      }

      gl.clearColor(0, 0, 0, 0);
      const canvas = gl.canvas as HTMLCanvasElement;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      host.appendChild(canvas);

      const program = new Program(gl, {
        vertex: vertexShader,
        fragment: fragmentShader,
        uniforms: {
          iTime: { value: 0 },
          iResolution: { value: new Float32Array([1, 1]) },
          uSpeed: { value: speed },
          uAmplitude: { value: amplitude },
          uWaveScale: { value: waveScale },
          uWaveRatio: { value: waveRatio },
          uSwell: { value: swell },
          uTurbulence: { value: turbulence },
          uTilt: { value: tilt },
          uZoom: { value: zoom },
          uHeight: { value: height },
          uFogDepth: { value: fogDepth },
          uSteps: { value: detailToSteps(detail) },
          uBrightness: { value: brightness },
          uOpacity: { value: opacity },
          uGrain: { value: grain ? 1 : 0 },
          uGrainIntensity: { value: grainIntensity },
          uMouse: { value: new Float32Array([0.5, 0.5]) },
          uParallax: { value: parallaxStrength },
          uEnableMouse: { value: mouseInteraction },
          uHorizonColor: { value: new Float32Array([1, 1, 1]) },
          uWaveColor: { value: new Float32Array([1, 1, 1]) },
          uCrestColor: { value: new Float32Array([1, 1, 1]) },
        },
      });
      const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
      programRef.current = program as unknown as ProgramLike;

      const setSize = () => {
        const rect = host.getBoundingClientRect();
        renderer.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)));
        const res = program.uniforms.iResolution.value as Float32Array;
        res[0] = gl.drawingBufferWidth;
        res[1] = gl.drawingBufferHeight;
        renderer.render({ scene: mesh });
      };
      const ro = new ResizeObserver(setSize);
      ro.observe(host);
      setSize();

      // The pointer is tracked on the WINDOW, not the canvas: `.db-waves` is
      // `pointer-events: none` so it can't sit between the visitor and a pricing CTA, which
      // means it never receives a pointer event of its own.
      const current: [number, number] = [0.5, 0.5];
      const target: [number, number] = [0.5, 0.5];
      const onPointerMove = (e: PointerEvent) => {
        const rect = host.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        target[0] = (e.clientX - rect.left) / rect.width;
        target[1] = 1 - (e.clientY - rect.top) / rect.height;
      };
      window.addEventListener("pointermove", onPointerMove, { passive: true });

      let raf = 0;
      let onScreen = true;
      let pageVisible = !document.hidden;
      const t0 = performance.now();

      const loop = (t: number) => {
        program.uniforms.iTime.value = (t - t0) * 0.001;
        const tx = enableMouseRef.current ? target[0] : 0.5;
        const ty = enableMouseRef.current ? target[1] : 0.5;
        current[0] += 0.05 * (tx - current[0]);
        current[1] += 0.05 * (ty - current[1]);
        const m = program.uniforms.uMouse.value as Float32Array;
        m[0] = current[0];
        m[1] = current[1];
        renderer.render({ scene: mesh });
        raf = requestAnimationFrame(loop);
      };
      const tryStart = () => {
        if (onScreen && pageVisible && raf === 0) raf = requestAnimationFrame(loop);
      };
      const tryStop = () => {
        if (raf !== 0) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      };

      // Scrolled past the masthead, or the tab is in the background → stop marching. A pricing
      // page is read from top to bottom; the layer is off-screen for most of that.
      const io = new IntersectionObserver(
        ([entry]) => {
          onScreen = entry.isIntersecting;
          if (onScreen) tryStart();
          else tryStop();
        },
        { threshold: 0 },
      );
      io.observe(host);
      const onVisibility = () => {
        pageVisible = !document.hidden;
        if (pageVisible) tryStart();
        else tryStop();
      };
      document.addEventListener("visibilitychange", onVisibility);
      tryStart();

      return () => {
        tryStop();
        ro.disconnect();
        io.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pointermove", onPointerMove);
        programRef.current = null;
        try {
          host.removeChild(canvas);
        } catch {
          // Already detached by React; nothing to undo.
        }
        loseContext(gl);
      };
    }

    return () => {
      disposed = true;
      teardown?.();
    };
    // Mount-only on purpose: recreating the GL context on a prop change would drop frames for
    // no reason. Prop changes land through the uniforms effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Props → uniforms, on the live program. Runs on `ready` too, so the values above are what
  // the very first rendered frame uses.
  useEffect(() => {
    const program = programRef.current;
    if (!program) return;
    const u = program.uniforms;

    enableMouseRef.current = mouseInteraction;

    u.uSpeed.value = speed;
    u.uAmplitude.value = amplitude;
    u.uWaveScale.value = waveScale;
    u.uWaveRatio.value = waveRatio;
    u.uSwell.value = swell;
    u.uTurbulence.value = turbulence;
    u.uTilt.value = tilt;
    u.uZoom.value = zoom;
    u.uHeight.value = height;
    u.uFogDepth.value = fogDepth;
    u.uSteps.value = detailToSteps(detail);
    u.uBrightness.value = brightness;
    u.uOpacity.value = opacity;
    u.uGrain.value = grain ? 1 : 0;
    u.uGrainIntensity.value = grainIntensity;
    u.uParallax.value = parallaxStrength;
    u.uEnableMouse.value = mouseInteraction;

    const write = (name: string, hex: string) => {
      const dst = u[name].value as Float32Array;
      const [r, g, b] = hexToRgb(hex);
      dst[0] = r;
      dst[1] = g;
      dst[2] = b;
    };
    write("uHorizonColor", horizonColor);
    write("uWaveColor", waveColor);
    write("uCrestColor", crestColor);
  }, [
    ready,
    horizonColor,
    waveColor,
    crestColor,
    speed,
    amplitude,
    waveScale,
    waveRatio,
    swell,
    turbulence,
    tilt,
    zoom,
    height,
    fogDepth,
    detail,
    brightness,
    opacity,
    grain,
    grainIntensity,
    mouseInteraction,
    parallaxStrength,
  ]);

  return <div ref={containerRef} className={`db-waves ${className}`} aria-hidden />;
}

/**
 * Browsers cap live WebGL contexts (~16 in Chrome) and evict the oldest when the cap is hit, so a
 * leaked context doesn't just waste memory, it can kill the next mount's canvas.
 */
function loseContext(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  try {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // Not available everywhere; GC handles it eventually.
  }
}

// Minimal structural type for the bit of `ogl` held in a ref — see PrismaticBurst for why the
// real types aren't imported here.
interface ProgramLike {
  uniforms: Record<string, { value: unknown }>;
}
