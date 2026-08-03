import { useEffect, useRef } from 'react';
import * as THREE from 'three';
// three.js is a third-party 3D graphics library — it draws to a <canvas>
// using WebGL. None of the THREE.* code below is React; React's only job
// here is to give three.js a <canvas> DOM element to draw into, and to
// clean everything up when the component goes away. That handoff is what
// useRef and useEffect are for — the two most important hooks to learn
// from this file.

interface ParticleNetworkProps {
  nodeCount?: number;
  autoRotate?: boolean;
}

// A plain helper function (no hooks, no JSX) that builds a soft circular
// "glow" image on an in-memory <canvas>, used as the texture for each dot.
// This runs on 2D Canvas APIs, unrelated to React or three.js's 3D scene.
function makeGlowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,.85)');
  grad.addColorStop(0.55, 'rgba(255,255,255,.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export default function ParticleNetwork({ nodeCount = 140, autoRotate = true }: ParticleNetworkProps) {
  // useRef gives you a "box" (`{ current: ... }`) that persists across
  // re-renders WITHOUT causing a re-render when you change it (unlike
  // useState). It's the standard way to get a direct handle to a real DOM
  // element — here, the <canvas> below. Initially null because the canvas
  // doesn't exist in the DOM yet on the very first render.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // useEffect runs a function AFTER React has rendered/updated the DOM.
  // This is the right place for anything that reaches "outside" React:
  // reading canvasRef.current, subscribing to window events, starting a
  // three.js render loop, etc. — none of that belongs in the render
  // (JSX-returning) part of the component.
  useEffect(() => {
    const canvas = canvasRef.current;
    // canvasRef.current is now the actual <canvas> DOM node, because this
    // effect runs AFTER the JSX below has been mounted into the page.
    const host = canvas?.parentElement;
    if (!canvas || !host) return; // defensive guard; should always exist in practice

    const w = host.clientWidth;
    const h = host.clientHeight;

    // ---- Everything from here down is three.js scene setup: a camera,
    // a renderer attached to our <canvas>, a cloud of glowing points
    // ("nodes"), thin connecting lines between nearby nodes, and a curved
    // "flight path" line with a moving dot that travels along it. This is
    // library-specific 3D-graphics code, not a React concept — skim it. ----

    const scene = new THREE.Scene();
    const bg = new THREE.Color('#080a14');
    scene.fog = new THREE.FogExp2('#080a14', 0.011);

    const camera = new THREE.PerspectiveCamera(58, w / h, 0.1, 500);
    camera.position.set(0, 0, 76);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    renderer.setClearColor(bg, 1);

    const glowTexture = makeGlowTexture();

    // `nodeCount` (our prop) decides how many particle "nodes" to create,
    // clamped between 40 and 260 so it can't be set to something silly.
    const n = Math.max(40, Math.min(260, nodeCount));
    const points: THREE.Vector3[] = [];
    const positions: number[] = [];
    const colors: number[] = [];
    const palette = ['#6366f1', '#818cf8', '#a78bfa', '#7c3aed', '#4f46e5', '#5b8cff'].map(
      (c) => new THREE.Color(c),
    );

    for (let i = 0; i < n; i++) {
      const x = (Math.random() * 2 - 1) * 54;
      const y = (Math.random() * 2 - 1) * 30;
      const z = (Math.random() * 2 - 1) * 36;
      const v = new THREE.Vector3(x, y, z);
      points.push(v);
      positions.push(x, y, z);
      const c = palette[(Math.random() * palette.length) | 0];
      colors.push(c.r, c.g, c.b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.5,
      map: glowTexture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      opacity: 0.95,
    });
    const nodes = new THREE.Points(geo, mat);

    // For every node, connect it to up to 3 nearby nodes (within distance
    // 15) with a thin line — this is what makes it look like a "network".
    const segments: number[] = [];
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let j = i + 1; j < n && k < 3; j++) {
        if (points[i].distanceTo(points[j]) < 15) {
          segments.push(points[i].x, points[i].y, points[i].z, points[j].x, points[j].y, points[j].z);
          k++;
        }
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#4340a0'),
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(lineGeo, lineMat);

    // Pick ~9 nodes sorted left-to-right and draw a smooth curve through
    // them (the "flight path" the glowing dot travels along).
    const sorted = points.slice().sort((a, b) => a.x - b.x);
    const step = Math.max(1, Math.floor(sorted.length / 9));
    const route: THREE.Vector3[] = [];
    for (let i = 0; i < sorted.length && route.length < 9; i += step) route.push(sorted[i]);
    if (route.length < 2) route.push(points[0], points[1]);
    const curve = new THREE.CatmullRomCurve3(route);
    const curveGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(220));
    const curveMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#b9a6ff'),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pathLine = new THREE.Line(curveGeo, curveMat);

    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const dotMat = new THREE.PointsMaterial({
      size: 7,
      map: glowTexture,
      color: new THREE.Color('#ffffff'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const dot = new THREE.Points(dotGeo, dotMat); // the moving white dot

    const end = route[route.length - 1];
    const endGeo = new THREE.BufferGeometry().setFromPoints([end]);
    const endMat = new THREE.PointsMaterial({
      size: 10,
      map: glowTexture,
      color: new THREE.Color('#fbbf24'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const endNode = new THREE.Points(endGeo, endMat); // the amber "destination" node

    const group = new THREE.Group();
    group.add(lines, nodes, pathLine, dot, endNode);
    scene.add(group);

    // ---- Interactivity: track the mouse position and window size using
    // plain browser event listeners (NOT React event props, since these
    // need to fire even when the mouse isn't over this exact element). ----
    let mouseX = 0;
    let mouseY = 0;
    const onMove = (e: MouseEvent) => {
      // Normalize mouse position to a -1..1 range, which is what three.js
      // camera math conventionally expects.
      mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      mouseY = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    const onResize = () => {
      const nw = host.clientWidth;
      const nh = host.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh, false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('resize', onResize);

    // ---- The render loop. requestAnimationFrame asks the browser to call
    // `animate` again right before the next repaint (~60 times/sec),
    // creating smooth animation. This is a manual game-loop, similar in
    // spirit to what you'd write in any real-time graphics context. ----
    const t0 = performance.now();
    let raf = 0; // stores the id returned by requestAnimationFrame, so we can cancel it later
    const animate = () => {
      raf = requestAnimationFrame(animate); // schedule the NEXT frame
      const t = (performance.now() - t0) / 1000; // seconds elapsed since mount
      const spin = autoRotate === false ? 0 : 0.0015;
      group.rotation.y += spin;
      // `+= (target - current) * 0.04` is "lerp" (linear interpolation) —
      // a common trick for smoothly easing a value toward a target instead
      // of snapping to it instantly. Used here for a subtle parallax-follow effect.
      group.rotation.x += (mouseY * 0.16 - group.rotation.x) * 0.04;
      camera.position.x += (mouseX * 10 - camera.position.x) * 0.035;
      camera.position.y += (mouseY * 7 - camera.position.y) * 0.035;
      camera.lookAt(0, 0, 0);
      const tt = (t * 0.05) % 1; // a value that loops 0 -> 1 repeatedly over time
      const p = curve.getPoint(tt); // where the moving dot should be along the path right now
      dotGeo.attributes.position.setXYZ(0, p.x, p.y, p.z);
      dotGeo.attributes.position.needsUpdate = true; // tells three.js "re-upload this to the GPU"
      dotMat.size = 6.5 + Math.sin(t * 4) * 1.6; // pulsing size using a sine wave
      endMat.size = 9 + Math.sin(t * 2) * 2.6;
      renderer.render(scene, camera); // actually draw the frame
    };
    animate(); // kick off the loop once; it re-schedules itself forever after this

    // THE CLEANUP FUNCTION — this is the most important React concept in
    // this file. When a useEffect's setup function returns a function,
    // React calls that returned function when the component unmounts (or
    // before the effect re-runs, if its dependencies changed). Without
    // this, navigating away from the landing page would leave the render
    // loop running forever and leak GPU memory (`.dispose()` calls) —
    // a classic memory leak. ALWAYS clean up subscriptions/timers/loops
    // you start in an effect.
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      geo.dispose();
      mat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      curveGeo.dispose();
      curveMat.dispose();
      dotGeo.dispose();
      dotMat.dispose();
      endGeo.dispose();
      endMat.dispose();
      glowTexture.dispose();
    };
    // The DEPENDENCY ARRAY. React re-runs this effect only when a value
    // listed here changes between renders (and runs the previous cleanup
    // first). Here, if nodeCount or autoRotate props change, the whole
    // three.js scene is torn down and rebuilt from scratch with the new
    // values. An empty array `[]` would mean "run once on mount only."
  }, [nodeCount, autoRotate]);

  return (
    // The `ref={canvasRef}` attribute is how React hands us the real DOM
    // node — after this renders, canvasRef.current will point at this
    // exact <canvas> element, which is what the effect above reads.
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    />
  );
}
