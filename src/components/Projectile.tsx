import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, RapierRigidBody, useRapier, BallCollider, interactionGroups } from '@react-three/rapier';


import * as THREE from 'three';

// --- GIGANTIC PERFORMANCE OPTIMIZATION ---
// Create the geometry and material ONCE in memory for all projectiles globally.
// 500 bullets creating 500 geometries per second murders the GPU and Garbage Collector.
// We also reduced geometry complexity from 16x16 to a low-poly 4x4 Icosahedron (looks like a sphere when small).
const PROJECTILE_GEOM = new THREE.IcosahedronGeometry(0.3, 0); 
const PROJECTILE_MAT = new THREE.MeshBasicMaterial({ color: '#ffff00' });

const _rayOrigin = new THREE.Vector3();
const _gravityDir = new THREE.Vector3(0, -1, 0);

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

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.setLinvel({
        x: direction.x * speed,
        y: direction.y * speed,
        z: direction.z * speed
      }, true);
    }
  }, [direction, speed]);

  useFrame((state, delta) => {
    if (dead.current) {
        onHit(id, targetHit.current);
        return;
    }
    
    if (!bodyRef.current) return;
    const body = bodyRef.current;
    const pos = body.translation();
    
    // Safety generic lifetime so it doesn't wander in infinity forever if locked out of bounds
    timeAlive.current += delta;
    if (timeAlive.current > 15.0) {
        dead.current = true;
        return;
    }

    // Out of bounds cleanup (Optimization)
    if (pos.y < -50) {
        dead.current = true;
        return;
    }
    
    // To ensure projectiles aggressively stick to curves dynamically, 
    // we use Rapier's friction and restitution, relying purely on Centrifugal force of the sphere!
  });

  return (
    <RigidBody
      ref={bodyRef}
      position={[position.x, position.y, position.z]}
      mass={1.0}          // High mass stabilizes the physics solver against the terrain. They don't push Boids because Boids die instantly on touch anyway.
      colliders={false}
      restitution={0.0}   // DEAD BOUNCE (Stick to the floor/curve)
      friction={0.0}      // ZERO FRICTION (Glide perfectly without losing momentum)
      linearDamping={0.0}
      angularDamping={0.0}
      ccd={false}         // Disabling CCD stops them from getting 'stuck' or jittering inside the internal edges of the Arena 3D Mesh.
      gravityScale={3.0} // High default gravity to ensure it aggressively arcs and pushes against concave surfaces
      name={`projectile-${ownerId}`}
      collisionGroups={interactionGroups(2, [0, 1])}
      onCollisionEnter={({ colliderObject }) => {
          if (!colliderObject || dead.current) return;
          
          if (colliderObject.name === `boid-${ownerId}`) return;

          // ONLY DESPAWN ON BOID HIT! They must stick to curves and slide forever otherwise.
          if (colliderObject.name && colliderObject.name.startsWith('boid-')) {
              dead.current = true;
              targetHit.current = colliderObject.name.replace('boid-', '');
          }
      }}
    >
      <BallCollider args={[0.3]} />
      {/* NO SHADOWS: Tiny fast glowing bullets don't need shadow maps, which saves massive FPS */}
      <mesh geometry={PROJECTILE_GEOM} material={PROJECTILE_MAT} />
    </RigidBody>
  );
}
