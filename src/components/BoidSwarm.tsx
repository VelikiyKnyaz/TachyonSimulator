import React, { useRef } from 'react';
import { useSimulationStore, simMetrics } from '../store';
import { Boid } from './Boid';
import { Projectile } from './Projectile';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

const _crashDummy = new THREE.Object3D();

function DeathMarkers() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const showDeaths = useSimulationStore(state => state.showDeathMarkers);
  const showKills = useSimulationStore(state => state.showKillMarkers);
  const maxCrashes = 1000;

  useFrame(() => {
    if (!meshRef.current) return;
    const markers = simMetrics.deathMarkers;

    let count = 0;
    for (let i = 0; i < markers.length && count < maxCrashes; i++) {
      const m = markers[i];
      if (m.isKill && !showKills) continue;
      if (!m.isKill && !showDeaths) continue;

      _crashDummy.position.set(m.x, m.y + (m.isKill ? 2 : 1), m.z);
      _crashDummy.rotation.set(Math.random(), Math.random(), Math.random());
      const scale = m.isKill ? 1.5 : 1.0;
      _crashDummy.scale.set(scale, scale, scale);
      _crashDummy.updateMatrix();
      meshRef.current.setMatrixAt(count, _crashDummy.matrix);
      meshRef.current.setColorAt(count, new THREE.Color(m.isKill ? "#eab308" : "#ef4444"));
      count++;
    }
    meshRef.current.count = count;
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, maxCrashes]} count={0} visible={showDeaths || showKills}>
      <icosahedronGeometry args={[0.8, 0]} />
      <meshBasicMaterial wireframe transparent opacity={0.8} />
    </instancedMesh>
  );
}

function SpeedRecordMarkers() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const show = useSimulationStore(state => state.showSpeedRecords);
  const maxRecords = 300;

  useFrame(() => {
    if (!meshRef.current || !show) return;
    const markers = Array.from(simMetrics.boidMaxSpeeds.values()).flat();

    meshRef.current.count = Math.min(markers.length, maxRecords);
    for (let i = 0; i < meshRef.current.count; i++) {
      const m = markers[i];
      if (m) {
        _crashDummy.position.set(m.x, m.y + 10, m.z);
        _crashDummy.rotation.set(0, Date.now() * 0.002, 0);
        _crashDummy.scale.set(1, 1, 1);
        _crashDummy.updateMatrix();
        meshRef.current.setMatrixAt(i, _crashDummy.matrix);
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, maxRecords]} count={0} visible={show}>
      <octahedronGeometry args={[1.5, 0]} />
      <meshBasicMaterial color="#38bdf8" wireframe />
    </instancedMesh>
  );
}

function DecelRecordMarkers() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const show = useSimulationStore(state => state.showSpeedRecords);
  const maxRecords = 300;

  useFrame(() => {
    if (!meshRef.current || !show) return;
    const markers = Array.from(simMetrics.boidMaxDecels.values()).flat();

    meshRef.current.count = Math.min(markers.length, maxRecords);
    for (let i = 0; i < meshRef.current.count; i++) {
      const m = markers[i];
      if (m) {
        _crashDummy.position.set(m.x, m.y + 10, m.z);
        _crashDummy.rotation.set(0, Date.now() * 0.002, 0);
        _crashDummy.scale.set(1, 1, 1);
        _crashDummy.updateMatrix();
        meshRef.current.setMatrixAt(i, _crashDummy.matrix);
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, maxRecords]} count={0} visible={show}>
      <octahedronGeometry args={[1.5, 0]} />
      <meshBasicMaterial color="#f97316" wireframe />
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

        // Speed-scaled damage: faster shooter = more devastating hits
        // Base 10 damage at 0 speed, up to 50 at maxSpeedCap
        const maxSpeedCap = useSimulationStore.getState().maxSpeedCap;
        const speedFactor = Math.min(1.0, (proj.shooterSpeed || 0) / maxSpeedCap);
        const damage = 10 + speedFactor * 40; // 10 at standstill, 50 at max speed

        const currentHp = simMetrics.boidHealths.get(targetBoidId) ?? useSimulationStore.getState().baseHealth;
        const newHp = currentHp - damage;
        simMetrics.boidHealths.set(targetBoidId, newHp);

        if (newHp <= 0) {
          // The Boid will naturally evaluate this and respawn / leave a marker on its next frame
          simMetrics.kills[shooterId] = (simMetrics.kills[shooterId] || 0) + 1;
          simMetrics.deaths[targetBoidId] = (simMetrics.deaths[targetBoidId] || 0) + 1;
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
      <DeathMarkers />
      <SpeedRecordMarkers />
      <DecelRecordMarkers />
    </>
  );
}
