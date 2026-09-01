"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Prismatic Burst — the auth pages' backdrop: volumetric rays that bend and turn under the
 * cursor, rendered by a fragment shader.
 *
 * Vendored from React Bits (https://reactbits.dev/backgrounds/prismatic-burst),
 * Copyright (c) 2026 David Haz, MIT + Commons Clause. Permitted: using and modifying it inside
 * an application or website, commercially. Not permitted: selling or redistributing the
 * component itself. That is why this lives in `src/components/platform/` — the web app, which
 * the public mirrors (`apps/cli`, `packages/renderer`, `examples/starter`; see
 * scripts/mirror-cli.mjs) do NOT publish. Don't move it under a mirrored path.
 *
 * The two shader programs are upstream's, verbatim. The React around them is adapted, in four
 * ways that matter on a page where someone is typing a password:
 *
 *  1. **`ogl` is imported lazily**, inside the effect. It's ~90KB of WebGL plumbing that the
 *     login form doesn't need to become interactive, so it must not sit in the bundle the page
 *     blocks on. Nothing renders until the chunk lands, and if it never lands the page keeps the
 *     CSS wash underneath.
 *  2. **Reduced motion means no shader at all** — not a paused canvas. A person who asked the OS
 *     for less animation gets the static gradient and no GPU work.
 *  3. **WebGL2 or nothing.** The fragment shader is `#version 300 es`; ogl silently falls back to
 *     a WebGL1 context when 2 isn't available, where these shaders can't compile — which would
 *     be a black rectangle over the form rather than a missing flourish. So the context is
 *     checked and we bail to the fallback instead.
 *  4. **Every failure path is silent and leaves the fallback visible** (`.db-burst` paints a
 *     radial wash of its own). A backdrop is never worth an error dialog, and it's never worth a
 *     blank screen either.
 *
 * The effect is also deliberately mount-only for the WebGL setup, with a separate effect pushing
 * prop changes into uniforms — recreating the context on every prop change would drop frames for
 * no reason. That's upstream's structure and it's the right one.
 */

const vertexShader = `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;

uniform float uIntensity;
uniform float uSpeed;
uniform int   uAnimType;
uniform vec2  uMouse;
uniform int   uColorCount;
uniform float uDistort;
uniform vec2  uOffset;
uniform sampler2D uGradient;
uniform float uNoiseAmount;
uniform int   uRayCount;
uniform float uLightMode;

float hash21(vec2 p){
    p = floor(p);
    float f = 52.9829189 * fract(dot(p, vec2(0.065, 0.005)));
    return fract(f);
}

mat2 rot30(){ return mat2(0.8, -0.5, 0.5, 0.8); }

float layeredNoise(vec2 fragPx){
    vec2 p = mod(fragPx + vec2(uTime * 30.0, -uTime * 21.0), 1024.0);
    vec2 q = rot30() * p;
    float n = 0.0;
    n += 0.40 * hash21(q);
    n += 0.25 * hash21(q * 2.0 + 17.0);
    n += 0.20 * hash21(q * 4.0 + 47.0);
    n += 0.10 * hash21(q * 8.0 + 113.0);
    n += 0.05 * hash21(q * 16.0 + 191.0);
    return n;
}

vec3 rayDir(vec2 frag, vec2 res, vec2 offset, float dist){
    float focal = res.y * max(dist, 1e-3);
    return normalize(vec3(2.0 * (frag - offset) - res, focal));
}

float edgeFade(vec2 frag, vec2 res, vec2 offset){
    vec2 toC = frag - 0.5 * res - offset;
    float r = length(toC) / (0.5 * min(res.x, res.y));
    float x = clamp(r, 0.0, 1.0);
    float q = x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
    float s = q * 0.5;
    s = pow(s, 1.5);
    float tail = 1.0 - pow(1.0 - s, 2.0);
    s = mix(s, tail, 0.2);
    float dn = (layeredNoise(frag * 0.15) - 0.5) * 0.0015 * s;
    return clamp(s + dn, 0.0, 1.0);
}

mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,-s, 0.0,s,c); }
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0.0,s, 0.0,1.0,0.0, -s,0.0,c); }
mat3 rotZ(float a){ float c = cos(a), s = sin(a); return mat3(c,-s,0.0, s,c,0.0, 0.0,0.0,1.0); }

vec3 sampleGradient(float t){
    t = clamp(t, 0.0, 1.0);
    return texture(uGradient, vec2(t, 0.5)).rgb;
}

vec2 rot2(vec2 v, float a){
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c) * v;
}

float bendAngle(vec3 q, float t){
    float a = 0.8 * sin(q.x * 0.55 + t * 0.6)
            + 0.7 * sin(q.y * 0.50 - t * 0.5)
            + 0.6 * sin(q.z * 0.60 + t * 0.7);
    return a;
}

void main(){
    vec2 frag = gl_FragCoord.xy;
    float t = uTime * uSpeed;
    float jitterAmp = 0.1 * clamp(uNoiseAmount, 0.0, 1.0);
    vec3 dir = rayDir(frag, uResolution, uOffset, 1.0);
    float marchT = 0.0;
    vec3 col = vec3(0.0);
    float n = layeredNoise(frag);
    vec4 c = cos(t * 0.2 + vec4(0.0, 33.0, 11.0, 0.0));
    mat2 M2 = mat2(c.x, c.y, c.z, c.w);
    float amp = clamp(uDistort, 0.0, 50.0) * 0.15;

    mat3 rot3dMat = mat3(1.0);
    if(uAnimType == 1){
      vec3 ang = vec3(t * 0.31, t * 0.21, t * 0.17);
      rot3dMat = rotZ(ang.z) * rotY(ang.y) * rotX(ang.x);
    }
    mat3 hoverMat = mat3(1.0);
    if(uAnimType == 2){
      vec2 m = uMouse * 2.0 - 1.0;
      vec3 ang = vec3(m.y * 0.6, m.x * 0.6, 0.0);
      hoverMat = rotY(ang.y) * rotX(ang.x);
    }

    for (int i = 0; i < 44; ++i) {
        vec3 P = marchT * dir;
        P.z -= 2.0;
        float rad = length(P);
        vec3 Pl = P * (10.0 / max(rad, 1e-6));

        if(uAnimType == 0){
            Pl.xz *= M2;
        } else if(uAnimType == 1){
      Pl = rot3dMat * Pl;
        } else {
      Pl = hoverMat * Pl;
        }

        float stepLen = min(rad - 0.3, n * jitterAmp) + 0.1;

        float grow = smoothstep(0.35, 3.0, marchT);
        float a1 = amp * grow * bendAngle(Pl * 0.6, t);
        float a2 = 0.5 * amp * grow * bendAngle(Pl.zyx * 0.5 + 3.1, t * 0.9);
        vec3 Pb = Pl;
        Pb.xz = rot2(Pb.xz, a1);
        Pb.xy = rot2(Pb.xy, a2);

        float rayPattern = smoothstep(
            0.5, 0.7,
            sin(Pb.x + cos(Pb.y) * cos(Pb.z)) *
            sin(Pb.z + sin(Pb.y) * cos(Pb.x + t))
        );

        if (uRayCount > 0) {
            float ang = atan(Pb.y, Pb.x);
            float comb = 0.5 + 0.5 * cos(float(uRayCount) * ang);
            comb = pow(comb, 3.0);
            rayPattern *= smoothstep(0.15, 0.95, comb);
        }

        vec3 spectralDefault = 1.0 + vec3(
            cos(marchT * 3.0 + 0.0),
            cos(marchT * 3.0 + 1.0),
            cos(marchT * 3.0 + 2.0)
        );

        float saw = fract(marchT * 0.25);
        float tRay = saw * saw * (3.0 - 2.0 * saw);
        vec3 userGradient = 2.0 * sampleGradient(tRay);
        vec3 spectral = (uColorCount > 0) ? userGradient : spectralDefault;
        vec3 base = (0.05 / (0.4 + stepLen))
                  * smoothstep(5.0, 0.0, rad)
                  * spectral;

        col += base * rayPattern;
        marchT += stepLen;
    }

    col *= edgeFade(frag, uResolution, uOffset);
    col *= uIntensity;

    col = clamp(col, 0.0, 1.0);
    if (uLightMode > 0.5) {
        float energy = max(max(col.r, col.g), col.b);
        vec3 hue = col / max(energy, 0.0001);
        float neutral = min(hue.r, min(hue.g, hue.b));
        hue = max(hue - vec3(neutral * 0.68), vec3(0.0));
        hue /= max(max(hue.r, max(hue.g, hue.b)), 0.0001);
        vec3 pigment = mix(hue, hue * hue, 0.24) * 0.64;
        float coverage = smoothstep(0.001, 0.32, energy);
        coverage = pow(coverage, 0.72) * 0.92;
        col = mix(vec3(1.0), pigment, coverage);
    }
    fragColor = vec4(col, 1.0);
}`;

/** `#rgb`/`#rrggbb` → 0..1 triple. Falls back to white on anything unparseable. */
export function hexToRgb01(hex: string): [number, number, number] {
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const intVal = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(intVal) || (h.length !== 6 && h.length !== 8)) return [1, 1, 1];
  return [((intVal >> 16) & 255) / 255, ((intVal >> 8) & 255) / 255, (intVal & 255) / 255];
}

/** A number or a `"120px"` string → pixels. Anything else is 0, never NaN into a uniform. */
export function toPx(v: number | string | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const num = parseFloat(String(v).trim().replace("px", ""));
  return Number.isNaN(num) ? 0 : num;
}

export type BurstAnimation = "rotate" | "rotate3d" | "hover";

const ANIMATION_UNIFORM: Record<BurstAnimation, number> = { rotate: 0, rotate3d: 1, hover: 2 };

export interface PrismaticBurstProps {
  /** Overall brightness multiplier. */
  intensity?: number;
  speed?: number;
  /** `hover` steers the burst with the pointer; the other two turn on their own. */
  animationType?: BurstAnimation;
  /** Gradient stops the rays are coloured from. Omit for the shader's own spectrum. */
  colors?: string[];
  /** 0–50. Bends the rays; higher is more liquid, and more expensive. */
  distort?: number;
  paused?: boolean;
  offset?: { x?: number | string; y?: number | string };
  /** 0–1. How slowly the burst catches up to the pointer. */
  hoverDampness?: number;
  /** >0 combs the burst into that many discrete rays. */
  rayCount?: number;
  mixBlendMode?: "none" | "lighten" | "screen" | "plus-lighter" | "normal";
  className?: string;
}

export function PrismaticBurst({
  intensity = 2,
  speed = 0.5,
  animationType = "rotate3d",
  colors,
  distort = 0,
  paused = false,
  offset,
  hoverDampness = 0,
  rayCount = 0,
  mixBlendMode = "lighten",
  className = "",
}: PrismaticBurstProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Uniform writes go through these, so the props effect below can reach the live program
  // without re-running setup.
  const programRef = useRef<ProgramLike | null>(null);
  const rendererRef = useRef<RendererLike | null>(null);
  const gradientRef = useRef<TextureLike | null>(null);
  const pausedRef = useRef(paused);
  const hoverDampRef = useRef(hoverDampness);
  // Flipped once the GL program exists, which is what lets the props effect below be the ONLY
  // place uniforms are written: it runs again on `ready`, so the first paint gets our props even
  // though setup finishes after the first render (the `ogl` import is async).
  const [ready, setReady] = useState(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    hoverDampRef.current = hoverDampness;
  }, [hoverDampness]);

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
      } catch {
        // A driver that refuses the context, a blocked GPU, a compile failure on an exotic
        // device — all of them land here, and all of them mean "show the fallback".
        teardown?.();
      }
    })();

    function start(ogl: typeof import("ogl"), host: HTMLDivElement): () => void {
      const { Renderer, Program, Mesh, Triangle, Texture } = ogl;
      // dpr capped at 2: this is a full-viewport ray march, and a 3x retina buffer triples the
      // fragment count for a backdrop nobody is looking straight at.
      const renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio || 1, 2), alpha: false, antialias: false });
      const gl = renderer.gl;
      // Adaptation 3: these shaders are `#version 300 es`, so WebGL1 can't run them. ogl reports
      // which context it got; on WebGL1 we hand it straight back and let the fallback stand.
      if (!renderer.isWebgl2) {
        loseContext(gl);
        throw new Error("prismatic burst: WebGL2 unavailable");
      }
      rendererRef.current = renderer as unknown as RendererLike;

      gl.canvas.style.position = "absolute";
      gl.canvas.style.inset = "0";
      gl.canvas.style.width = "100%";
      gl.canvas.style.height = "100%";
      gl.canvas.style.mixBlendMode = mixBlendMode === "none" ? "" : mixBlendMode;
      host.appendChild(gl.canvas);

      const gradient = new Texture(gl, {
        image: new Uint8Array([255, 255, 255, 255]),
        width: 1,
        height: 1,
        generateMipmaps: false,
        flipY: false,
      });
      gradient.minFilter = gl.LINEAR;
      gradient.magFilter = gl.LINEAR;
      gradient.wrapS = gl.CLAMP_TO_EDGE;
      gradient.wrapT = gl.CLAMP_TO_EDGE;
      gradientRef.current = gradient as unknown as TextureLike;

      const program = new Program(gl, {
        vertex: vertexShader,
        fragment: fragmentShader,
        uniforms: {
          uResolution: { value: [1, 1] },
          uTime: { value: 0 },
          uIntensity: { value: 1 },
          uSpeed: { value: 1 },
          uAnimType: { value: 0 },
          uMouse: { value: [0.5, 0.5] },
          uColorCount: { value: 0 },
          uDistort: { value: 0 },
          uOffset: { value: [0, 0] },
          uGradient: { value: gradient },
          uNoiseAmount: { value: 0.8 },
          uRayCount: { value: 0 },
          uLightMode: { value: 0 },
        },
      });
      programRef.current = program as unknown as ProgramLike;
      setReady(true);

      const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

      const resize = () => {
        renderer.setSize(host.clientWidth || 1, host.clientHeight || 1);
        program.uniforms.uResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight];
      };
      const ro = "ResizeObserver" in window ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(host);
      else window.addEventListener("resize", resize);
      resize();

      const pointerTarget: [number, number] = [0.5, 0.5];
      const pointerSmooth: [number, number] = [0.5, 0.5];
      const onPointer = (e: PointerEvent) => {
        const rect = host.getBoundingClientRect();
        pointerTarget[0] = Math.min(Math.max((e.clientX - rect.left) / Math.max(rect.width, 1), 0), 1);
        pointerTarget[1] = Math.min(Math.max((e.clientY - rect.top) / Math.max(rect.height, 1), 0), 1);
      };
      // On `window`, not the container: the auth layout stacks the form above this layer, so a
      // container-only listener would go dead the moment the cursor crossed the card.
      window.addEventListener("pointermove", onPointer, { passive: true });

      let onScreen = true;
      const io =
        "IntersectionObserver" in window
          ? new IntersectionObserver((entries) => {
              if (entries[0]) onScreen = entries[0].isIntersecting;
            }, { threshold: 0.01 })
          : null;
      io?.observe(host);

      let raf = 0;
      let last = performance.now();
      let elapsed = 0;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.max(0, now - last) * 0.001;
        last = now;
        if (!pausedRef.current) elapsed += dt;
        // Scrolled away or backgrounded: keep the loop alive (so it resumes instantly) but do no
        // GPU work. `document.hidden` matters most — a login tab left open all afternoon should
        // not be rendering a shader.
        if (!onScreen || document.hidden) return;

        const tau = 0.02 + Math.min(Math.max(hoverDampRef.current, 0), 1) * 0.5;
        const alpha = 1 - Math.exp(-dt / tau);
        pointerSmooth[0] += (pointerTarget[0] - pointerSmooth[0]) * alpha;
        pointerSmooth[1] += (pointerTarget[1] - pointerSmooth[1]) * alpha;
        program.uniforms.uMouse.value = pointerSmooth;
        program.uniforms.uTime.value = elapsed;
        renderer.render({ scene: mesh });
      };
      raf = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onPointer);
        if (ro) ro.disconnect();
        else window.removeEventListener("resize", resize);
        io?.disconnect();
        gl.canvas.remove();
        // Free the GPU resources explicitly. A login page can be mounted and unmounted a lot in
        // one session (login → onboarding → back), and browsers cap live WebGL contexts hard:
        // leak them and the Nth mount silently gets no context at all.
        try {
          mesh.geometry?.remove?.();
          program.remove?.();
          if (gradient.texture) gl.deleteTexture(gradient.texture);
        } catch {
          // A context already lost during teardown throws here; nothing left to free.
        }
        loseContext(gl);
        programRef.current = null;
        rendererRef.current = null;
        gradientRef.current = null;
      };
    }

    return () => {
      disposed = true;
      teardown?.();
    };
    // Setup is mount-only on purpose; prop changes go through the uniform effect below, which is
    // what keeps a colour tweak from rebuilding the GL context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prop changes → uniforms, on the live program. Also the FIRST application, via `ready`.
  useEffect(() => {
    const program = programRef.current;
    const renderer = rendererRef.current;
    const gradient = gradientRef.current;
    if (!program || !renderer || !gradient) return;

    program.uniforms.uIntensity.value = intensity;
    program.uniforms.uSpeed.value = speed;
    program.uniforms.uAnimType.value = ANIMATION_UNIFORM[animationType] ?? 0;
    program.uniforms.uDistort.value = distort;
    program.uniforms.uOffset.value = [toPx(offset?.x), toPx(offset?.y)];
    program.uniforms.uRayCount.value = Math.max(0, Math.floor(rayCount));

    const stops = (colors ?? []).slice(0, 64);
    if (stops.length > 0) {
      const gl = renderer.gl;
      const data = new Uint8Array(stops.length * 4);
      stops.forEach((color, i) => {
        const [r, g, b] = hexToRgb01(color);
        data[i * 4] = Math.round(r * 255);
        data[i * 4 + 1] = Math.round(g * 255);
        data[i * 4 + 2] = Math.round(b * 255);
        data[i * 4 + 3] = 255;
      });
      gradient.image = data;
      gradient.width = stops.length;
      gradient.height = 1;
      gradient.format = gl.RGBA;
      gradient.type = gl.UNSIGNED_BYTE;
      gradient.needsUpdate = true;
    }
    program.uniforms.uColorCount.value = stops.length;
  }, [ready, intensity, speed, animationType, colors, distort, offset, rayCount]);

  return <div ref={containerRef} className={`db-burst ${className}`} aria-hidden />;
}

/**
 * Hand the context back to the browser rather than waiting for GC. Browsers allow a small number
 * of live WebGL contexts per page and drop the OLDEST when the cap is hit — so an un-released
 * context doesn't just waste memory, it can kill the next mount's canvas.
 */
function loseContext(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  try {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // Not available everywhere; GC handles it eventually.
  }
}

// Minimal structural types for the bits of `ogl` held in refs. Importing its types eagerly would
// defeat the lazy import (the values are dynamic, but a top-level `import type` is erased — the
// real reason is narrower: ogl's own types describe uniforms as `any`, and these three shapes are
// all this component touches).
interface ProgramLike {
  uniforms: Record<string, { value: unknown }>;
  remove?: () => void;
}
interface RendererLike {
  gl: WebGL2RenderingContext;
}
interface TextureLike {
  image: Uint8Array;
  width: number;
  height: number;
  format: number;
  type: number;
  needsUpdate: boolean;
  texture: WebGLTexture | null;
}
