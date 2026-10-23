import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Line, Sparkles } from '@react-three/drei';
import * as THREE from 'three';

// Live hero scene: a glowing call hub, orbiting call nodes and signal pulses; the whole rig turns toward the mouse.
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

function Pulse({ from, speed, offset, color }) {
  const ref = useRef();
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * speed + offset) % 1;
    ref.current.position.lerpVectors(from, ORIGIN, t);
    ref.current.scale.setScalar(0.5 + Math.sin(t * Math.PI) * 0.8);
  });
  return <mesh ref={ref}><sphereGeometry args={[0.05, 12, 12]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>;
}

function Node({ pos, i }) {
  const hot = i % 3 === 0;
  return (
    <group position={pos}>
      <mesh rotation={[i, i * 0.7, 0]}>
        <boxGeometry args={[0.24, 0.24, 0.24]} />
        <meshStandardMaterial color="#14181B" metalness={0.7} roughness={0.25} emissive={hot ? GREEN : '#000000'} emissiveIntensity={hot ? 0.5 : 0} />
      </mesh>
      <mesh><sphereGeometry args={[0.055, 10, 10]} /><meshBasicMaterial color={hot ? GREEN : CREAM} toneMapped={false} /></mesh>
    </group>
  );
}

function Hub() {
  const core = useRef();
  const shell = useRef();
  useFrame(({ clock }, d) => {
    shell.current.rotation.y += d * 0.18;
    shell.current.rotation.x += d * 0.06;
    core.current.material.emissiveIntensity = 0.75 + Math.sin(clock.elapsedTime * 1.8) * 0.25;
  });
  return (
    <group>
      <mesh ref={core}><icosahedronGeometry args={[0.62, 3]} /><meshStandardMaterial color="#06261d" emissive={GREEN} emissiveIntensity={0.8} roughness={0.35} metalness={0.3} /></mesh>
      <mesh ref={shell}><icosahedronGeometry args={[1.08, 1]} /><meshBasicMaterial color={GREEN} wireframe transparent opacity={0.32} /></mesh>
    </group>
  );
}

const RINGS = [[1.7, [1.25, 0.2, 0], CREAM, 0.22], [2.2, [0.5, 0.9, 0.2], BLUE, 0.7], [2.8, [1.4, -0.5, 0.3], GREEN, 0.3]];
function Rings() {
  const g = useRef();
  useFrame((_, d) => g.current.children.forEach((m, i) => { m.rotation.z += d * (0.12 + i * 0.05) * (i % 2 ? -1 : 1); }));
  return (
    <group ref={g}>
      {RINGS.map(([r, rot, c, o]) => <mesh key={r} rotation={rot}><torusGeometry args={[r, 0.01, 8, 180]} /><meshBasicMaterial color={c} transparent opacity={o} toneMapped={false} /></mesh>)}
    </group>
  );
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
  return (
    <group ref={group}>
      <Float speed={1.4} rotationIntensity={0.25} floatIntensity={0.7}>
        <Hub />
        <Rings />
        {nodes.map((p, i) => (
          <group key={i}>
            <Line points={[p, ORIGIN]} color={i % 3 === 0 ? GREEN : CREAM} lineWidth={1} transparent opacity={i % 3 === 0 ? 0.55 : 0.14} />
            <Node pos={p} i={i} />
            {i % 2 === 0 && <Pulse from={p} speed={0.3 + (i % 5) * 0.06} offset={i * 0.13} color={i % 3 === 0 ? GREEN : CREAM} />}
          </group>
        ))}
      </Float>
      <Sparkles count={70} scale={[9, 6, 6]} size={2.2} speed={0.35} color={GREEN} opacity={0.55} />
    </group>
  );
}

export default function Hero3D() {
  return (
    <Canvas dpr={[1, 1.75]} camera={{ position: [0, 0, 7.4], fov: 45 }} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[4, 3, 5]} intensity={45} color={GREEN} />
      <pointLight position={[-5, -2, 3]} intensity={30} color={BLUE} />
      <directionalLight position={[0, 5, 5]} intensity={0.8} />
      <Scene />
    </Canvas>
  );
}
