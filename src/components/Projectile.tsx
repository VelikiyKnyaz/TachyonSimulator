import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, RapierRigidBody, useRapier, BallCollider, interactionGroups } from '@react-three/rapier';
import { useSimulationStore, simMetrics } from '../store';

import * as THREE from 'three';

// --- GIGANTIC PERFORMANCE OPTIMIZATION ---
// Create the geometry and material ONCE in memory for all projectiles globally.
const PROJECTILE_GEOM = new THREE.IcosahedronGeometry(0.3, 0); 
const PROJECTILE_MAT = new THREE.MeshBasicMaterial({ color: '#ffff00' });

// Reusable vectors to avoid GC pressure (per-frame allocations)
const _rayOrigin = new THREE.Vector3();
const _surfaceNormal = new THREE.Vector3();

export function Projectile({ id, position, direction, speed, ownerId, onHit }: { 
    id: string, 
    position: THREE.Vector3, 
    direction: THREE.Vector3, 
    speed: number, 
    ownerId: string,
    onHit: (id: string, targetBoidId?: string) => void 
}) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const { world, rapier } = useRapier();
  const dead = useRef(false);
  const targetHit = useRef<string | undefined>(undefined);
  const timeAlive = useRef(0);
  const hitReported = useRef(false);

  // Compute initial velocity ONCE at creation (no useEffect delay!)
  const initialVelocity: [number, number, number] = [
    direction.x * speed,
    direction.y * speed,
    direction.z * speed
  ];

  useFrame((_state, delta) => {
    if (dead.current) {
        if (!hitReported.current) {
            simMetrics.projectileData.delete(id);
            onHit(id, targetHit.current);
            hitReported.current = true;
        }
        return;
    }
    
    if (!bodyRef.current) return;
    const body = bodyRef.current;
    const pos = body.translation();
    const vel = body.linvel();
    
    // Safety lifetime limit
    timeAlive.current += delta;
    if (timeAlive.current > 15.0) {
        dead.current = true;
        return;
    }

    // Broadcast High-Frequency Telemetry
    simMetrics.projectileData.set(id, {
        pos: { x: pos.x, y: pos.y, z: pos.z },
        vel: { x: vel.x, y: vel.y, z: vel.z },
        ownerId
    });

    // Out of bounds cleanup (scales with arena, offset by arena position)
    const storeState = useSimulationStore.getState();
    const arenaScale = storeState.arenaScale;
    const ap = storeState.arenaPosition ?? { x: 0, y: 0, z: 0 };
    const bound = 150 * arenaScale;
    if (pos.y < ap.y - 50 * arenaScale || pos.y > ap.y + bound || Math.abs(pos.x - ap.x) > bound || Math.abs(pos.z - ap.z) > bound) {
        dead.current = true;
        return;
    }
    
    // --- CONSTANT-SPEED SURFACE-FOLLOWING ---
    // Rule: Projectiles NEVER change speed. They only change direction to follow surfaces.
    _rayOrigin.set(pos.x, pos.y, pos.z);
    const ray = new rapier.Ray(_rayOrigin, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 10, true, undefined, interactionGroups(0, [0]), undefined, body);
    
    if (hit && hit.collider) {
      const toi = (hit as any).toi !== undefined ? (hit as any).toi : (hit as any).timeOfImpact;
      
      if (typeof toi === 'number' && !isNaN(toi) && toi < 2.0) {
        // Near a surface — project velocity onto tangent plane
        const nHit = hit.collider.castRayAndGetNormal(ray, 10, true);
        if (nHit !== null) {
          _surfaceNormal.set(nHit.normal.x, nHit.normal.y, nHit.normal.z).normalize();
          
          // Project velocity onto the surface tangent plane:
          // v_tangent = v - normal * dot(v, normal)
          const dotVN = vel.x * _surfaceNormal.x + vel.y * _surfaceNormal.y + vel.z * _surfaceNormal.z;
          let tx = vel.x - _surfaceNormal.x * dotVN;
          let ty = vel.y - _surfaceNormal.y * dotVN;
          let tz = vel.z - _surfaceNormal.z * dotVN;
          
          // Re-normalize to the ORIGINAL constant speed
          const tangentLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
          if (tangentLen > 0.01) {
            const scale = speed / tangentLen;
            tx *= scale;
            ty *= scale;
            tz *= scale;
          }
          
          body.setLinvel({ x: tx, y: ty, z: tz }, true);
          
          // Push projectile gently toward surface to prevent floating away
          // This is a position correction, not a velocity change
          if (toi > 0.8) {
            // Projectile is drifting away from surface — nudge it back
            const correction = (toi - 0.5) * delta * 20;
            body.setTranslation({
              x: pos.x - _surfaceNormal.x * correction,
              y: pos.y - _surfaceNormal.y * correction,
              z: pos.z - _surfaceNormal.z * correction
            }, true);
          }
        }
      }
    }
    
    // ENFORCE constant speed even when airborne (no surface detected)
    // This guarantees the projectile NEVER slows down or speeds up
    const currentVel = body.linvel();
    const currentSpeed = Math.sqrt(currentVel.x * currentVel.x + currentVel.y * currentVel.y + currentVel.z * currentVel.z);
    if (currentSpeed > 0.01 && Math.abs(currentSpeed - speed) > 0.5) {
      const correction = speed / currentSpeed;
      body.setLinvel({
        x: currentVel.x * correction,
        y: currentVel.y * correction,
        z: currentVel.z * correction
      }, true);
    }
  });

  return (
    <RigidBody
      ref={bodyRef}
      position={[position.x, position.y, position.z]}
      linearVelocity={initialVelocity}
      mass={1.0}
      colliders={false}
      restitution={0.0}
      friction={0.0}
      linearDamping={0.0}
      angularDamping={0.0}
      ccd={false}
      gravityScale={0}       // NO gravity! Surface-following is fully handled by the active tangent projection system.
      name={`projectile-${ownerId}`}
      dominanceGroup={-127}
      collisionGroups={interactionGroups(2, [0])}
      solverGroups={interactionGroups(2, [0])}
      onIntersectionEnter={({ rigidBodyObject }) => {
          if (!rigidBodyObject || dead.current) return;
          if (rigidBodyObject.name === `boid-${ownerId}`) return;
          if (rigidBodyObject.name && rigidBodyObject.name.startsWith('boid-')) {
              dead.current = true;
              targetHit.current = rigidBodyObject.name.replace('boid-', '');
          }
      }}
    >
      <BallCollider args={[0.3]} collisionGroups={interactionGroups(2, [0])} solverGroups={interactionGroups(2, [0])} />
      <BallCollider args={[2.5]} sensor collisionGroups={interactionGroups(2, [1])} />
      <mesh geometry={PROJECTILE_GEOM} material={PROJECTILE_MAT} />
    </RigidBody>
  );
}
