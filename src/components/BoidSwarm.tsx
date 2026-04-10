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

const MAX_TRAIL_VERTICES = 200000;
const _trailPositions = new Float32Array(MAX_TRAIL_VERTICES * 3);
const _trailColors = new Float32Array(MAX_TRAIL_VERTICES * 3);

const _maxSpeedTrailPositions = new Float32Array(100000 * 3);
const _maxSpeedTrailColors = new Float32Array(100000 * 3);

const _minSpeedTrailPositions = new Float32Array(100000 * 3);
const _minSpeedTrailColors = new Float32Array(100000 * 3);

function DeathTrails() {
  const lineRef: any = useRef(null);
  const showDeaths = useSimulationStore(state => state.showDeathMarkers);
  const showKills = useSimulationStore(state => state.showKillMarkers);

  useFrame(() => {
    if (!lineRef.current) return;
    const markers = simMetrics.deathMarkers;
    let vCount = 0;

    for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        if (!m.trail || m.trail.length < 2) continue;
        if (m.isKill && !showKills) continue;
        if (!m.isKill && !showDeaths) continue;

        const r = m.isKill ? 0.92 : 0.94;
        const g = m.isKill ? 0.70 : 0.27;
        const b = m.isKill ? 0.03 : 0.27;

        for (let j = 0; j < m.trail.length - 1; j++) {
            if (vCount >= MAX_TRAIL_VERTICES) break;
            const p1 = m.trail[j];
            const p2 = m.trail[j+1];
            
            _trailPositions[vCount * 3] = p1.x;
            _trailPositions[vCount * 3 + 1] = p1.y;
            _trailPositions[vCount * 3 + 2] = p1.z;
            _trailColors[vCount * 3] = r;
            _trailColors[vCount * 3 + 1] = g;
            _trailColors[vCount * 3 + 2] = b;
            vCount++;

            if (vCount >= MAX_TRAIL_VERTICES) break;
            _trailPositions[vCount * 3] = p2.x;
            _trailPositions[vCount * 3 + 1] = p2.y;
            _trailPositions[vCount * 3 + 2] = p2.z;
            _trailColors[vCount * 3] = r;
            _trailColors[vCount * 3 + 1] = g;
            _trailColors[vCount * 3 + 2] = b;
            vCount++;
        }
    }

    const geo = lineRef.current.geometry;
    geo.setDrawRange(0, vCount);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  });

  return (
    <lineSegments ref={lineRef} visible={showDeaths || showKills}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={MAX_TRAIL_VERTICES} array={_trailPositions} itemSize={3} usage={THREE.DynamicDrawUsage} />
        <bufferAttribute attach="attributes-color" count={MAX_TRAIL_VERTICES} array={_trailColors} itemSize={3} usage={THREE.DynamicDrawUsage} />
      </bufferGeometry>
      <lineBasicMaterial vertexColors transparent opacity={0.6} />
    </lineSegments>
  );
}

function MaxSpeedTrails() {
  const lineRef: any = useRef(null);
  const show = useSimulationStore(state => state.showSpeedRecords);

  useFrame(() => {
    if (!lineRef.current) return;
    const markers = Array.from(simMetrics.boidMaxSpeeds.values()).flat();
    let vCount = 0;

    for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        if (!m.trail || m.trail.length < 2 || !show) continue;

        // Bright Cyan
        const r = 0.02;
        const g = 0.71;
        const b = 0.83;

        for (let j = 0; j < m.trail.length - 1; j++) {
            if (vCount >= 100000) break;
            const p1 = m.trail[j];
            const p2 = m.trail[j+1];
            
            _maxSpeedTrailPositions[vCount * 3] = p1.x;
            _maxSpeedTrailPositions[vCount * 3 + 1] = p1.y;
            _maxSpeedTrailPositions[vCount * 3 + 2] = p1.z;
            _maxSpeedTrailColors[vCount * 3] = r;
            _maxSpeedTrailColors[vCount * 3 + 1] = g;
            _maxSpeedTrailColors[vCount * 3 + 2] = b;
            vCount++;

            if (vCount >= 100000) break;
            _maxSpeedTrailPositions[vCount * 3] = p2.x;
            _maxSpeedTrailPositions[vCount * 3 + 1] = p2.y;
            _maxSpeedTrailPositions[vCount * 3 + 2] = p2.z;
            _maxSpeedTrailColors[vCount * 3] = r;
            _maxSpeedTrailColors[vCount * 3 + 1] = g;
            _maxSpeedTrailColors[vCount * 3 + 2] = b;
            vCount++;
        }
    }

    const geo = lineRef.current.geometry;
    geo.setDrawRange(0, vCount);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  });

  return (
    <lineSegments ref={lineRef} visible={show}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={100000} array={_maxSpeedTrailPositions} itemSize={3} usage={THREE.DynamicDrawUsage} />
        <bufferAttribute attach="attributes-color" count={100000} array={_maxSpeedTrailColors} itemSize={3} usage={THREE.DynamicDrawUsage} />
      </bufferGeometry>
      <lineBasicMaterial vertexColors transparent opacity={0.6} />
    </lineSegments>
  );
}

function MinSpeedTrails() {
  const lineRef: any = useRef(null);
  const show = useSimulationStore(state => state.showSpeedRecords);

  useFrame(() => {
    if (!lineRef.current) return;
    const markers = Array.from(simMetrics.boidMinSpeeds.values()).flat();
    let vCount = 0;

    for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        if (!m.trail || m.trail.length < 2 || !show) continue;

        // Intense Purple (#a855f7)
        const r = 0.66;
        const g = 0.33;
        const b = 0.97;

        for (let j = 0; j < m.trail.length - 1; j++) {
            if (vCount >= 100000) break;
            const p1 = m.trail[j];
            const p2 = m.trail[j+1];
            
            _minSpeedTrailPositions[vCount * 3] = p1.x;
            _minSpeedTrailPositions[vCount * 3 + 1] = p1.y;
            _minSpeedTrailPositions[vCount * 3 + 2] = p1.z;
            _minSpeedTrailColors[vCount * 3] = r;
            _minSpeedTrailColors[vCount * 3 + 1] = g;
            _minSpeedTrailColors[vCount * 3 + 2] = b;
            vCount++;

            if (vCount >= 100000) break;
            _minSpeedTrailPositions[vCount * 3] = p2.x;
            _minSpeedTrailPositions[vCount * 3 + 1] = p2.y;
            _minSpeedTrailPositions[vCount * 3 + 2] = p2.z;
            _minSpeedTrailColors[vCount * 3] = r;
            _minSpeedTrailColors[vCount * 3 + 1] = g;
            _minSpeedTrailColors[vCount * 3 + 2] = b;
            vCount++;
        }
    }

    const geo = lineRef.current.geometry;
    geo.setDrawRange(0, vCount);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  });

  return (
    <lineSegments ref={lineRef} visible={show}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={100000} array={_minSpeedTrailPositions} itemSize={3} usage={THREE.DynamicDrawUsage} />
        <bufferAttribute attach="attributes-color" count={100000} array={_minSpeedTrailColors} itemSize={3} usage={THREE.DynamicDrawUsage} />
      </bufferGeometry>
      <lineBasicMaterial vertexColors transparent opacity={0.6} />
    </lineSegments>
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

function MinSpeedRecordMarkers() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const show = useSimulationStore(state => state.showSpeedRecords);
  const maxRecords = 300;

  useFrame(() => {
    if (!meshRef.current || !show) return;
    const markers = Array.from(simMetrics.boidMinSpeeds.values()).flat();

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
      <meshBasicMaterial color="#a855f7" wireframe />
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
      <DeathTrails />
      <SpeedRecordMarkers />
      <MaxSpeedTrails />
      <MinSpeedRecordMarkers />
      <MinSpeedTrails />
    </>
  );
}
