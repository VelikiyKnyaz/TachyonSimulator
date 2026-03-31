import React, { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { RigidBody, RapierRigidBody, useRapier, BallCollider, interactionGroups } from '@react-three/rapier';
import * as THREE from 'three';
import { simMetrics, useSimulationStore } from '../store';

const BOID_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ef4444'];

// Reusable objects for Garbage Collection performance (Only stateless ones)
const _rayOrigin = new THREE.Vector3();
const _lidarOrigin = new THREE.Vector3();
const _surfaceNormal = new THREE.Vector3(0, 1, 0);

type BoidState = 'CRUISE' | 'DIVE' | 'CLIMB' | 'EVADE' | 'HUNT';

export function Boid({ id, index }: { id: string, index: number }) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const arrowRef = useRef<THREE.ArrowHelper>(null);
  const textRef = useRef<any>(null); // For Drei Text component
  const { rapier, world } = useRapier();
  const prevNormal = useRef(new THREE.Vector3(0, 1, 0));
  const aiState = useRef<BoidState>('CRUISE');
  const evadeSpinDir = useRef<number>(1); // 1 = Left, -1 = Right
  const fireCooldown = useRef(0); // Used for Overheat cooldown
  const heat = useRef(0);         // Used for Machine-gun burst
  const wasGrounded = useRef(false);
  const respawning = useRef(false);
  
  // Reactively bind variables that alter JSX (RigidBody)
  const baseFriction = useSimulationStore(state => state.baseFriction);
  const crashTolerance = useSimulationStore(state => state.crashTolerance);

  // Deep Stateful Vectors (MUST be unique per agent)
  const targetDir = useRef(new THREE.Vector3(Math.random()-0.5, 0, Math.random()-0.5).normalize());
  const idealDir = useRef(new THREE.Vector3());

  // AI Personalities
  const aiStats = useMemo(() => ({
    riskTolerance: 0.5 + Math.random() * 1.5,
    evasionDir: Math.random() > 0.5 ? 1 : -1,
    huntPreference: Math.random(),
    color: BOID_COLORS[index % BOID_COLORS.length]
  }), [index]);

  const initialPosition = useMemo(() => {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 5;
    return new THREE.Vector3(Math.cos(angle) * radius, 10 + index * 2.0, Math.sin(angle) * radius);
  }, [index]);

  useFrame((state, delta) => {
    if (!bodyRef.current) return;
    const body = bodyRef.current;
    
    const _targetDir = targetDir.current;
    const _idealDir = idealDir.current;

    // Respawner
    if (respawning.current) {
       body.setTranslation({ x: initialPosition.x, y: initialPosition.y, z: initialPosition.z }, true);
       body.setLinvel({ x: 0, y: 0, z: 0 }, true);
       body.setAngvel({ x: 0, y: 0, z: 0 }, true);
       respawning.current = false;
       wasGrounded.current = false;
       heat.current = 0;
       fireCooldown.current = 0;
       return;
    }

    // Overheat System (Machine Gun)
    if (fireCooldown.current > 0) {
        fireCooldown.current -= delta;
        heat.current = Math.max(0, heat.current - (delta * 2.0)); // Cool down fast when locked
    } else {
        heat.current = Math.max(0, heat.current - (delta * 0.5)); // Natural slow cool down
    }

    const pos = body.translation();
    const vel = body.linvel();
    const speed = new THREE.Vector3(vel.x, vel.y, vel.z).length();
    
    // Out of bounds / Fall Respawn
    if (pos.y < -30) {
        simMetrics.crashes++;
        simMetrics.crashMarkers.push({ id: id + '-' + Date.now(), x: pos.x, y: pos.y, z: pos.z });
        respawning.current = true;
        return;
    }

    // Marble's current rolling direction (Default to intended direction if stopped)
    const direction = speed > 1.0 ? new THREE.Vector3(vel.x, vel.y, vel.z).normalize() : targetDir.current.clone().normalize();

    simMetrics.boidSpeeds.set(id, speed);
    simMetrics.boidPositions.set(id, {x: pos.x, y: pos.y, z: pos.z});
    simMetrics.boidStates.set(id, aiState.current);
    if (speed > simMetrics.maxSpeed) simMetrics.maxSpeed = speed;

    if (!wasGrounded.current) {
        simMetrics.boidSpeeds.set(id, 0); // Exclude from active stats safely
    }

    _rayOrigin.set(pos.x, pos.y, pos.z);
    
    // Sensor Track logic: Spheres don't have a specific "down", we use gravity or previous known ground normal!
    const gravityDir = new THREE.Vector3(0, -1, 0);
    const searchRayDir = wasGrounded.current ? prevNormal.current.clone().negate() : gravityDir;
    
    const ray = new rapier.Ray(_rayOrigin, searchRayDir);
    const hit = world.castRay(ray, 100, true, undefined, undefined, undefined, body as any);

    let isGrounded = false;
    _surfaceNormal.copy(gravityDir.negate());

    if (hit && hit.collider && hit.collider.parent() !== body) {
      const toi = hit.toi !== undefined ? hit.toi : (hit as any).timeOfImpact;
      // Radius of Ball is 0.5. Toi < 0.8 accounts for small bumps ensuring continuous grip
      if (typeof toi === 'number' && !isNaN(toi) && toi < 0.8) {
        isGrounded = true;
        const nHit = hit.collider.castRayAndGetNormal(ray, 100, true);
        if (nHit !== null) {
          _surfaceNormal.set(nHit.normal.x, nHit.normal.y, nHit.normal.z).normalize();
        }
      }
    }

    if (isGrounded) {
       // --- GEOMETRIC CRASH DETECTION (Sharp Angles/Lips) ---
       if (wasGrounded.current && !respawning.current) {
          const angleDiff = _surfaceNormal.angleTo(prevNormal.current);
          if (!isNaN(angleDiff) && angleDiff > crashTolerance && speed > 25.0) { // Crashing into a sharp curb
              simMetrics.crashes++;
              simMetrics.crashMarkers.push({ id: id + '-' + Date.now(), x: pos.x, y: pos.y, z: pos.z });
              respawning.current = true;
          }
       }
       prevNormal.current.copy(_surfaceNormal);
       wasGrounded.current = true;

       // --- Lidar Edge Avoidance (Dynamic Terrain Safe) ---
       const settings = useSimulationStore.getState();
       const lookAheadDist = Math.max(speed * settings.lookAheadDist, 2.0); // Sufficient buffer
       _lidarOrigin.copy(pos).add(direction.clone().multiplyScalar(lookAheadDist));
       // CRUCIAL MATH FIX: Elevate the Lidar 10 meters perpendicular to the surface BEFORE shooting back down!
       _lidarOrigin.add(_surfaceNormal.clone().multiplyScalar(10.0));
       
       const lidarRay = new rapier.Ray(_lidarOrigin, _surfaceNormal.clone().negate());
       const lidarHit = world.castRay(lidarRay, 20.0, true, undefined, undefined, undefined, body as any);
       
       if (!lidarHit) {
           // DANGER: We are heading off a cliff!
           if (aiState.current !== 'EVADE') {
               aiState.current = 'EVADE';
               
               // INTELLIGENCE: Shoot two diagonal 'whiskers' to find the safest spin route instantly
               const leftDir = direction.clone().applyAxisAngle(_surfaceNormal, Math.PI / 4);
               const rightDir = direction.clone().applyAxisAngle(_surfaceNormal, -Math.PI / 4);
               
               const posVec = new THREE.Vector3(pos.x, pos.y, pos.z);
               const leftOrigin = posVec.clone().add(leftDir.multiplyScalar(lookAheadDist)).add(_surfaceNormal.clone().multiplyScalar(10.0));
               const rightOrigin = posVec.clone().add(rightDir.multiplyScalar(lookAheadDist)).add(_surfaceNormal.clone().multiplyScalar(10.0));

               const leftHit = world.castRay(new rapier.Ray(leftOrigin, _surfaceNormal.clone().negate()), 20.0, true, undefined, undefined, undefined, body as any);
               const rightHit = world.castRay(new rapier.Ray(rightOrigin, _surfaceNormal.clone().negate()), 20.0, true, undefined, undefined, undefined, body as any);
               
               // Decide which side is safe and engrave it into our evasive memory.
               if (leftHit && !rightHit) evadeSpinDir.current = 1;       // Left is solid ground
               else if (rightHit && !leftHit) evadeSpinDir.current = -1; // Right is solid ground
               else evadeSpinDir.current = 1;                            // Both dead/alive: arbitrary Left
           }
       } else {
           // SAFE AHEAD! Turn off evade immediately and evaluate aerodynamics!
           if (aiState.current === 'EVADE') {
               aiState.current = 'CRUISE';
           }

           // Obtain/Consume Potential Energy (DIVE / CLIMB)
           if (speed < settings.diveEnergyThreshold) aiState.current = 'DIVE';
           else if (speed > settings.climbEnergyThreshold && aiState.current !== 'HUNT') aiState.current = 'CLIMB'; // Convert excess kinetic to potential
           else if (aiState.current !== 'HUNT') aiState.current = 'CRUISE';
       }

       // To avoid Boids randomly floating up without gravity, we give them a gentle pull downward if they are just cruising flat.
       const projectedGravity = gravityDir.clone().sub(
         _surfaceNormal.clone().multiplyScalar(gravityDir.dot(_surfaceNormal))
       );
       if (projectedGravity.lengthSq() < 0.01) projectedGravity.copy(_targetDir); // If flat, just keep going straight where looking

       
       let targetWeight = 0;
       
       // 3. Aim towards Rival (HUNT)
       let isHunting = false;
       if ((aiState.current === 'CRUISE' || aiState.current === 'HUNT') && speed >= 30.0) {
           let nearestDist = 100000; 
           let targetPos: {x:number, y:number, z:number} | null = null;
           
           simMetrics.boidPositions.forEach((posOther, otherId) => {
               if (otherId === id) return;
               const dx = posOther.x - pos.x;
               const dy = posOther.y - pos.y;
               const dz = posOther.z - pos.z;
               const distSq = dx*dx + dy*dy + dz*dz;
               if (distSq < nearestDist && distSq > 0.1) { 
                   nearestDist = distSq;
                   targetPos = posOther;
               }
           });

           let wantsToHunt = aiState.current === 'HUNT';
           if (aiState.current === 'CRUISE' && Math.random() < (aiStats.huntPreference * delta * 5.0)) {
               wantsToHunt = true;
           }

           if (targetPos !== null && wantsToHunt) {
               aiState.current = 'HUNT';
               isHunting = true;
               
               const huntDir = new THREE.Vector3((targetPos as any).x - pos.x, (targetPos as any).y - pos.y, (targetPos as any).z - pos.z).normalize();
               const projectedHunt = huntDir.sub(_surfaceNormal.clone().multiplyScalar(huntDir.dot(_surfaceNormal))).normalize();
               
               if (projectedHunt.lengthSq() > 0.01) {
                   _idealDir.copy(projectedHunt);
                   targetWeight = 1.0;
               }

               // FIRE PROJECTILE! (Machine Gun Burst)
               const aimDot = _targetDir.dot(huntDir);
               // Fire aggressively if aimed
               if (aimDot > settings.huntConeCone && fireCooldown.current <= 0) {
                   const spreadX = (Math.random() - 0.5) * 0.4;
                   const spreadY = (Math.random() - 0.5) * 0.4;

                   simMetrics.shotsFired++;
                   useSimulationStore.getState().spawnProjectile({
                       id: `proj-${Date.now()}-${Math.random()}`,
                       pos: { x: pos.x + _targetDir.x * 2.0 + spreadX, y: pos.y + 0.5 + spreadY, z: pos.z + _targetDir.z * 2.0 },
                       dir: { x: _targetDir.x, y: _targetDir.y, z: _targetDir.z },
                       speed: Math.max(speed + 50, settings.projectileSpeed), 
                       ownerId: id
                   });
                   
                   heat.current += 0.1;
                   if (heat.current >= 1.0) {
                       fireCooldown.current = settings.overheatCooldown; 
                   } else {
                       fireCooldown.current = settings.fireRateDelay;
                   }
               }
           }
       }

         if (!isHunting) {
             // --- AI COMMAND INTERPRETER --- (Decide the Vector _idealDir based on state)
             if (aiState.current === 'EVADE') {
                // Constantly drag the steering wheel 90 degrees into the safe zone determined by our whiskers.
                // The physical 'Turn Rate' will restrict this to an organic carve!
                _idealDir.copy(_targetDir).applyAxisAngle(_surfaceNormal, evadeSpinDir.current * (Math.PI / 2)).normalize();
                targetWeight = 1.0;
             } else if (aiState.current === 'DIVE') {
                // Seek gravity to gain kinetic energy
                _idealDir.copy(projectedGravity).normalize();
                targetWeight = 1.0; // Gravity + Motor Thrust to gain max speed (Pump!)
             } else if (aiState.current === 'CLIMB') {
                // Trade excess kinetic energy for potential energy by seeking height
                _idealDir.copy(projectedGravity).normalize().negate(); 
                targetWeight = 0.0; // PURE PHYSICS: Engine cut off! Coast using pure momentum up the ramp.
             } else {
                // RULE: No other reason to turn. Fly perfectly straight unless gravity slows us to a halt.
                _idealDir.copy(_targetDir);
                targetWeight = 1.0; // Enforce the straight line trajectory
             }
         }

       // Mathematically constrain both intention (_idealDir) and actual nose (_targetDir) 
       // to NEVER point into or off the ground. They must slide perfectly on the local tangent plane.
       _idealDir.sub(_surfaceNormal.clone().multiplyScalar(_idealDir.dot(_surfaceNormal))).normalize();
       _targetDir.sub(_surfaceNormal.clone().multiplyScalar(_targetDir.dot(_surfaceNormal))).normalize();

       // Calculate precisely how much we are turning to enforce the Turn Penalty Rule
       const turnAmount = 1.0 - Math.max(0, _targetDir.dot(_idealDir)); 
       
       // Energy penalty for turning (The sharper the ideal turn, the more velocity is lost)
       // We lowered the penalty significantly so they don't fall out of the sky while turning to HUNT
       if (turnAmount > 0.01) {
           body.setLinvel({
               x: vel.x * (1.0 - (turnAmount * delta * settings.turnPenalty)),
               y: vel.y, // Gravity isn't damped
               z: vel.z * (1.0 - (turnAmount * delta * settings.turnPenalty))
           }, true);
       }

       // Strict Physical Turn Rate Constraint
       const maxAngleToTurn = settings.maxTurnRateDeg * (Math.PI / 180) * delta;
       const angleToIdeal = _targetDir.angleTo(_idealDir);

       if (angleToIdeal > 0.001) {
           if (angleToIdeal <= maxAngleToTurn) {
               _targetDir.copy(_idealDir);
           } else {
               // Physically constrained rotation using cross product
               const crossAxis = new THREE.Vector3().crossVectors(_targetDir, _idealDir).normalize();
               
               // Fallback: If vectors are exactly opposite (180 deg), cross product is zero!
               if (crossAxis.lengthSq() < 0.001) {
                    crossAxis.set(0, 1, 0).applyAxisAngle(_targetDir, Math.random() * Math.PI); // Pick random normal
               }
               _targetDir.applyAxisAngle(crossAxis, maxAngleToTurn);
           }
       }
       
       _targetDir.normalize();

       // Synchronize Nose Visualizer
       if (settings.showNoses && arrowRef.current) {
           arrowRef.current.position.set(pos.x, pos.y, pos.z);
           arrowRef.current.setDirection(_targetDir);
           arrowRef.current.setLength(settings.debugSize * 1.5, settings.debugSize * 0.4, settings.debugSize * 0.3);
           arrowRef.current.visible = true;
       } else if (arrowRef.current) {
           arrowRef.current.visible = false;
       }

       // Synchronize Floating State Text
       if (settings.showStateLabels && textRef.current) {
           textRef.current.text = aiState.current === 'CRUISE' ? 'CR' : aiState.current === 'CLIMB' ? 'CL' : aiState.current[0]; 
           textRef.current.position.set(pos.x, pos.y + (settings.debugSize * 0.8), pos.z);
           textRef.current.visible = true;
           textRef.current.fontSize = settings.debugSize;
       } else if (textRef.current) {
           textRef.current.visible = false;
       }

       // --- APPLY LINEAR MOTOR ---
       if (targetWeight > 0.1 && !isNaN(_targetDir.x)) {
           // We scale motor power by delta, giving raw acceleration straight lines!
           const motorPower = (settings.motorPower * targetWeight) * delta;
           body.applyImpulse({ x: _targetDir.x * motorPower, y: _targetDir.y * motorPower, z: _targetDir.z * motorPower }, true);
       }

       // Centripetal grip (Gravity mapper ensures they stay glued as long as physics allow)
       const grip = speed * settings.centripetalGrip;
       body.applyImpulse({ x: -_surfaceNormal.x * grip * delta * 50, y: -_surfaceNormal.y * grip * delta * 50, z: -_surfaceNormal.z * grip * delta * 50 }, true);
       
       // Max Speed Cap (Terminal velocity) - lower from 60 to 35m/s so they don't blast instantly off the table
       if (speed > settings.maxSpeedCap) {
           body.setLinvel({ x: vel.x * 0.95, y: vel.y * 0.95, z: vel.z * 0.95 }, true);
       }
    } else {
       wasGrounded.current = false;
       // We allow pure ballistic air-time for Boom & Zoom, no artificial slams!
    }
  });

  return (
    <group>
      <RigidBody
        ref={bodyRef}
        name={`boid-${id}`}
        position={[initialPosition.x, initialPosition.y, initialPosition.z]}
        mass={2}            // Heavier to impact with gravitas
        colliders={false}
        restitution={0.0}   // DEAD BOUNCE: Boids must not bounce like basketballs
        friction={baseFriction} // Ultra high friction to ensure rolling over sliding
        linearDamping={0.1}
        angularDamping={2.0}// Caps infinite spin velocity
        ccd={true}          // Essential to prevent fast spheres jumping through ramps
        collisionGroups={interactionGroups(1, [0, 1])}
        onCollisionEnter={({ colliderObject }) => {
            if (colliderObject?.name?.startsWith('boid-')) {
               // Physical collision with another boid = Instant Death
               if (!respawning.current) {
                   simMetrics.crashes++;
                   simMetrics.crashMarkers.push({ id: `col-${Date.now()}-${id}`, x: bodyRef.current!.translation().x, y: bodyRef.current!.translation().y, z: bodyRef.current!.translation().z });
                   respawning.current = true;
               }
            }
        }}
      >
        <BallCollider args={[0.5]} />
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[0.5, 12, 12]} />  {/* Lower res ensures wireframe spin is highly visible */}
          <meshStandardMaterial 
              color={aiStats.color} 
              roughness={0.9}
              metalness={0.1}
              wireframe={true}
          />
          {/* Core glowing sphere so it's not totally empty inside */}
          <mesh>
               <sphereGeometry args={[0.2, 16, 16]} />
               <meshBasicMaterial color={aiStats.color} />
          </mesh>
        </mesh>
      </RigidBody>

      <arrowHelper 
          ref={arrowRef} 
          args={[new THREE.Vector3(1,0,0), new THREE.Vector3(0,0,0), 3.0, aiStats.color]} 
          visible={false} 
      />

      <Text
          ref={textRef}
          position={[0, 0, 0]}
          fontSize={3.0}    // Default value before settings override
          color={aiStats.color}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.05}
          outlineColor="#000000"
          visible={false}
      >
        C
      </Text>
    </group>
  );
}
