/**
 * The band in 3D on the big screen: drag to turn round the circle, scroll or pinch to zoom,
 * right-drag to pan, double-click to go back to the starting view, click a piper to watch it.
 * It turns slowly by itself until touched. three.js draws into its own canvas, copied each frame
 * into the screen's 2D canvas so the labels, the readouts and the glow pass are the 2D kit's
 * (as CHIMERA's 3D head does).
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Glow, label, seg } from "../../ui/render/vector.ts";
import { V } from "../../ui/colors.ts";
import { Band3D, type PiperDraw } from "../render/band3d.ts";
import { drawReadouts } from "../render/bagpipe.ts";
import { ROLE_COLOR } from "../render/score.ts";
import { PIPE_NAMES } from "../abc.ts";
import { airs, tickLive, views } from "../live.ts";
import { useStore } from "../store.ts";

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export default function Pipes3D(props: { readH: number; barLabel: () => string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef(props.barLabel);
  barRef.current = props.barLabel;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const wrap = wrapRef.current!;
    const glCanvas = document.createElement("canvas");
    let gl: THREE.WebGLRenderer;
    try {
      gl = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      setFailed(true);
      return;
    }
    gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    gl.setClearColor(0x000000, 1);
    const band = new Band3D();
    const camera = band.camera;
    const glow = new Glow();
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.8;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.8;
    controls.maxDistance = 22;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.45;

    const tween = { on: false, t: 0, dur: 1, p0: new THREE.Vector3(), q0: new THREE.Vector3(), p1: new THREE.Vector3(), q1: new THREE.Vector3() };
    const moveTo = (pos: THREE.Vector3, target: THREE.Vector3, dur: number) => {
      tween.p0.copy(camera.position);
      tween.q0.copy(controls.target);
      tween.p1.copy(pos);
      tween.q1.copy(target);
      tween.t = 0;
      tween.dur = dur;
      tween.on = true;
    };
    const stepTween = (dt: number) => {
      if (!tween.on) return;
      tween.t = Math.min(1, tween.t + dt / tween.dur);
      const e = ease(tween.t);
      camera.position.lerpVectors(tween.p0, tween.p1, e);
      controls.target.lerpVectors(tween.q0, tween.q1, e);
      if (tween.t >= 1) tween.on = false;
    };
    controls.addEventListener("start", () => {
      tween.on = false;
      controls.autoRotate = false;
    });
    const home = () => {
      const h = band.home();
      moveTo(h.pos, h.target, 0.9);
      controls.autoRotate = true;
    };
    canvas.addEventListener("dblclick", home);

    // a click (not a drag) on a piper shows it large
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY]);
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      down = null;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const n = useStore.getState().pipers;
      let best = -1, bd = 90;
      for (let i = 0; i < n; i++) {
        const [px, py] = band.project(band.anchor(i, 0.2), w, h);
        const d = Math.hypot(px - x, py - y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best >= 0) useStore.getState().setFocus(best);
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);

    let w = 0, h = 0, dpr = 1;
    let laidFor = -1;
    const fit = () => {
      const b = wrap.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = b.width;
      h = b.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      gl.setPixelRatio(dpr);
      gl.setSize(Math.max(1, w), Math.max(1, h), false);
      band.resize(Math.max(1, w), Math.max(1, h));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    const draws: PiperDraw[] = views.map((v, i) => ({ view: v, air: airs[i], active: false, muted: false, focus: false, finger: V.green }));

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (w > 0 && h > 0) {
        const s = useStore.getState();
        if (laidFor !== s.pipers) {
          const first = laidFor < 0;
          band.layout(s.pipers);
          laidFor = s.pipers;
          const hm = band.home();
          if (first) {
            camera.position.copy(hm.pos).add(new THREE.Vector3(hm.pos.z * 0.6, -hm.pos.y * 0.3, 0));
            controls.target.copy(hm.target);
            moveTo(hm.pos, hm.target, 1.8);
          } else moveTo(hm.pos, hm.target, 0.8);
        }
        tickLive(now);
        for (let i = 0; i < 5; i++) {
          const d = draws[i];
          d.active = i < s.pipers;
          d.muted = s.mutes[i];
          d.focus = i === s.focus;
          d.finger = ROLE_COLOR(s.arranged.roles[i] ?? "MELODY", i);
        }
        stepTween(dt);
        controls.update(dt);
        band.update(draws, s.pipers, s.focus);
        gl.render(band.scene, camera);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(glCanvas, 0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // who is who, over each bag
        for (let i = 0; i < s.pipers; i++) {
          const [x, y, front] = band.project(band.anchor(i, 0.36), w, h);
          if (!front || y > h - props.readH - 10) continue;
          const role = s.arranged.roles[i] ?? "";
          const col = ROLE_COLOR(role, i);
          const v = views[i];
          label(ctx, String(i + 1), x, y - 14, { size: i === s.focus ? 16 : 13, color: i === s.focus ? V.white : V.blue, align: "center", weight: "m" });
          label(ctx, s.mutes[i] ? "MUTED" : role, x, y, { size: 9, color: s.mutes[i] ? V.blueMid : col, align: "center" });
          if (v.chAmp > 0.05) label(ctx, PIPE_NAMES[v.note], x, y + 12, { size: 9, color: V.white, align: "center", alpha: 0.8 });
        }
        label(ctx, "DRAG TO TURN · SCROLL TO ZOOM · DOUBLE-CLICK TO RESET · CLICK A PIPER TO WATCH IT", 14, 18, { size: 9, color: V.blueMid });
        // the focused piper's readouts, on black, as on the flat screen
        const ry = h - props.readH;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, ry, w, props.readH);
        seg(ctx, 14, ry, w - 14, ry, V.frame, 1);
        drawReadouts(ctx, 14, ry + 20, w - 28, views[s.focus], barRef.current());
        glow.apply(canvas, ctx, dpr);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("dblclick", home);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      controls.dispose();
      band.dispose();
      gl.dispose();
      // browsers allow few live WebGL contexts: give this one back now
      gl.forceContextLoss();
    };
  }, [props.readH]);

  if (failed) return <p className="no-webgl-pipes">3D needs WebGL, which this browser has turned off.</p>;
  return (
    <div ref={wrapRef} className="pipes-3d">
      <canvas ref={canvasRef} aria-label="The band in 3D. Drag to turn, scroll to zoom, double-click to reset, click a piper to watch it." role="img" />
    </div>
  );
}
