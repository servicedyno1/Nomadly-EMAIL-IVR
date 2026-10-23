import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Line, Sparkles } from '@react-three/drei';
import * as THREE from 'three';

// Live hero scene: a glowing call hub, orbiting call nodes and signal pulses; the whole rig turns toward the mouse.
// Written with createElement (no JSX): the dev visual-edits babel plugin adds <span> wrappers and x-* props to JSX,
// which are invalid inside an R3F <Canvas> and trigger the dev error overlay.
const h = React.createElement;
const GREEN = '#00E3AA';
const BLUE = '#3434EF';
const CREAM = '#FEFDF5';
const ORIGIN = new THREE.Vector3(0, 0, 0);

function useWindowPointer() {
  const p = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const on = (e) => { p.current.x = (e.clientX / window.innerWidth) * 2 - 1; p.current.y = (e.clientY / window.innerHeight) * 2 - 1; };
    window.addEventListener('pointermove', on, { passive: true });
    return () => window.removeEventListener('pointermove', on);
  }, []);
  return p;
}

// Evenly spread points on a squashed sphere (Fibonacci lattice).
const nodePositions = (n, r) => Array.from({ length: n }, (_, i) => {
  const y = 1 - (i / (n - 1)) * 2;
  const rad = Math.sqrt(1 - y * y);
  const t = i * 2.399963;
  return new THREE.Vector3(Math.cos(t) * rad * r, y * r * 0.78, Math.sin(t) * rad * r);
});

const ball = (radius, seg, color, ref) => h('mesh', { ref },
  h('sphereGeometry', { args: [radius, seg, seg] }),
  h('meshBasicMaterial', { color, toneMapped: false }));

function Pulse({ from, speed, offset, color }) {
  const ref = useRef();
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * speed + offset) % 1;
    ref.current.position.lerpVectors(from, ORIGIN, t);
    ref.current.scale.setScalar(0.5 + Math.sin(t * Math.PI) * 0.8);
  });
  return ball(0.05, 12, color, ref);
}

function Node({ pos, i }) {
  const hot = i % 3 === 0;
  return h('group', { position: pos },
    h('mesh', { rotation: [i, i * 0.7, 0] },
      h('boxGeometry', { args: [0.24, 0.24, 0.24] }),
      h('meshStandardMaterial', { color: '#14181B', metalness: 0.7, roughness: 0.25, emissive: hot ? GREEN : '#000000', emissiveIntensity: hot ? 0.5 : 0 })),
    ball(0.055, 10, hot ? GREEN : CREAM));
}

function Hub() {
  const core = useRef();
  const shell = useRef();
  useFrame(({ clock }, d) => {
    shell.current.rotation.y += d * 0.18;
    shell.current.rotation.x += d * 0.06;
    core.current.material.emissiveIntensity = 0.75 + Math.sin(clock.elapsedTime * 1.8) * 0.25;
  });
  return h('group', null,
    h('mesh', { ref: core },
      h('icosahedronGeometry', { args: [0.62, 3] }),
      h('meshStandardMaterial', { color: '#06261d', emissive: GREEN, emissiveIntensity: 0.8, roughness: 0.35, metalness: 0.3 })),
    h('mesh', { ref: shell },
      h('icosahedronGeometry', { args: [1.08, 1] }),
      h('meshBasicMaterial', { color: GREEN, wireframe: true, transparent: true, opacity: 0.32 })));
}

const RINGS = [[1.7, [1.25, 0.2, 0], CREAM, 0.22], [2.2, [0.5, 0.9, 0.2], BLUE, 0.7], [2.8, [1.4, -0.5, 0.3], GREEN, 0.3]];
function Rings() {
  const g = useRef();
  useFrame((_, d) => g.current.children.forEach((m, i) => { m.rotation.z += d * (0.12 + i * 0.05) * (i % 2 ? -1 : 1); }));
  return h('group', { ref: g }, RINGS.map(([r, rot, c, o]) => h('mesh', { key: r, rotation: rot },
    h('torusGeometry', { args: [r, 0.01, 8, 180] }),
    h('meshBasicMaterial', { color: c, transparent: true, opacity: o, toneMapped: false }))));
}

function Spoke({ p, i }) {
  const hot = i % 3 === 0;
  return h('group', null,
    h(Line, { points: [p, ORIGIN], color: hot ? GREEN : CREAM, lineWidth: 1, transparent: true, opacity: hot ? 0.55 : 0.14 }),
    h(Node, { pos: p, i }),
    i % 2 === 0 ? h(Pulse, { from: p, speed: 0.3 + (i % 5) * 0.06, offset: i * 0.13, color: hot ? GREEN : CREAM }) : null);
}

function Scene() {
  const group = useRef();
  const pointer = useWindowPointer();
  const nodes = useMemo(() => nodePositions(14, 2.6), []);
  useFrame(({ clock }, d) => {
    const g = group.current;
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, pointer.current.x * 0.6 + clock.elapsedTime * 0.06, 2.5, d);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, pointer.current.y * 0.35, 2.5, d);
  });
  return h('group', { ref: group },
    h(Float, { speed: 1.4, rotationIntensity: 0.25, floatIntensity: 0.7 },
      h(Hub), h(Rings), nodes.map((p, i) => h(Spoke, { key: i, p, i }))),
    h(Sparkles, { count: 70, scale: [9, 6, 6], size: 2.2, speed: 0.35, color: GREEN, opacity: 0.55 }));
}

export default function Hero3D() {
  return h(Canvas, { dpr: [1, 1.75], camera: { position: [0, 0, 7.4], fov: 45 }, gl: { antialias: true, alpha: true, powerPreference: 'high-performance' } },
    h('ambientLight', { intensity: 0.5 }),
    h('pointLight', { position: [4, 3, 5], intensity: 45, color: GREEN }),
    h('pointLight', { position: [-5, -2, 3], intensity: 30, color: BLUE }),
    h('directionalLight', { position: [0, 5, 5], intensity: 0.8 }),
    h(Scene));
}
