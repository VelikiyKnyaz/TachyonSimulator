import React, { useRef, useState } from 'react';
import { PivotControls } from '@react-three/drei';
import * as THREE from 'three';
import { useSimulationStore } from '../store';

const SPAWN_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ef4444'];

function SpawnMarker({ index }: { index: number }) {
  const sp = useSimulationStore(state => state.spawnPoints[index]);
  const setSpawnPoint = useSimulationStore(state => state.setSpawnPoint);
  const isRunning = useSimulationStore(state => state.isRunning);
  const gizmoScale = useSimulationStore(state => state.gizmoScale);
  const color = SPAWN_COLORS[index % SPAWN_COLORS.length];

  // Store final drag position in a ref — only commit to store on drag end
  const lastWorldPos = useRef<{ x: number; y: number; z: number } | null>(null);
  // Increment to force PivotControls remount after drag (resets internal matrix)
  const [resetKey, setResetKey] = useState(0);

  if (!sp || isRunning) return null;

  return (
    <PivotControls
      key={`sp-${index}-${resetKey}`}
      anchor={[0, 0, 0]}
      depthTest={false}
      scale={gizmoScale}
      lineWidth={2}
      activeAxes={[true, true, true]}
      disableRotations
      disableScaling
      onDrag={(l, _dl, w, _dw) => {
        const delta = new THREE.Vector3();
        delta.setFromMatrixPosition(l);
        lastWorldPos.current = { x: sp.x + delta.x, y: sp.y + delta.y, z: sp.z + delta.z };
      }}
      onDragEnd={() => {
        if (lastWorldPos.current) {
          setSpawnPoint(index, lastWorldPos.current);
          lastWorldPos.current = null;
          setResetKey(k => k + 1);
        }
      }}
    >
      <group position={[sp.x, sp.y, sp.z]}>
        <mesh>
          <octahedronGeometry args={[0.6, 0]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.8} />
        </mesh>
        <mesh>
          <octahedronGeometry args={[0.25, 0]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
    </PivotControls>
  );
}

export function SpawnGizmos() {
  const spawnCount = useSimulationStore(state => state.spawnPoints.length);
  const isRunning = useSimulationStore(state => state.isRunning);

  if (isRunning) return null;

  return (
    <group>
      {Array.from({ length: spawnCount }, (_, i) => (
        <SpawnMarker key={i} index={i} />
      ))}
    </group>
  );
}
