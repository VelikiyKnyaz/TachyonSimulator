import React, { useRef } from 'react';
import { useSimulationStore, simMetrics } from '../store';
import { Boid } from './Boid';
import { Projectile } from './Projectile';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

const _crashDummy = new THREE.Object3D();

function CrashHeatmap() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const maxCrashes = 1000;
  
  useFrame(() => {
    if (!meshRef.current) return;
    const markers = simMetrics.crashMarkers;
    if (meshRef.current.count !== markers.length) {
       meshRef.current.count = Math.min(markers.length, maxCrashes);
       for (let i = 0; i < meshRef.current.count; i++) {
           _crashDummy.position.set(markers[i].x, markers[i].y + 1, markers[i].z);
           _crashDummy.rotation.set(Math.random(), Math.random(), Math.random());
           _crashDummy.updateMatrix();
           meshRef.current.setMatrixAt(i, _crashDummy.matrix);
       }
       meshRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, maxCrashes]} count={0}>
        <icosahedronGeometry args={[0.8, 0]} />
        <meshBasicMaterial color="#ef4444" wireframe transparent opacity={0.8} />
    </instancedMesh>
  );
}

export function BoidSwarm() {
  const boids = useSimulationStore(state => state.boids);
  const projectiles = useSimulationStore(state => state.projectiles);
  const removeProjectile = useSimulationStore(state => state.removeProjectile);

  const handleProjectileHit = (projId: string, targetBoidId?: string) => {
      if (targetBoidId) {
          const proj = useSimulationStore.getState().projectiles.find(p => p.id === projId);
          if (proj) {
              const shooterId = proj.ownerId;
              simMetrics.hits++;
              simMetrics.kills[shooterId] = (simMetrics.kills[shooterId] || 0) + 1;
              simMetrics.deaths[targetBoidId] = (simMetrics.deaths[targetBoidId] || 0) + 1;
              // Add a crash marker to represent explosion
              const targetPos = simMetrics.boidPositions.get(targetBoidId);
              if (targetPos) {
                 simMetrics.crashMarkers.push({ id: `explode-${Date.now()}`, x: targetPos.x, y: targetPos.y, z: targetPos.z });
              }
          }
      }
      removeProjectile(projId);
  };

  return (
    <>
      <group>
        {boids.map((id, index) => (
          <Boid key={id} id={id} index={index} />
        ))}
        {projectiles.map((p) => (
          <Projectile 
            key={p.id} 
            id={p.id} 
            speed={p.speed} 
            ownerId={p.ownerId} 
            position={new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z)} 
            direction={new THREE.Vector3(p.dir.x, p.dir.y, p.dir.z)} 
            onHit={handleProjectileHit} 
          />
        ))}
      </group>
      <CrashHeatmap />
    </>
  );
}
