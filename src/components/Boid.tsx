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

type BoidState = 'CRUISE' | 'BNZ_CLIMB' | 'BNZ_DIVE' | 'DOGFIGHT' | 'EVADE';

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
  const [isHovered, setIsHovered] = useState(false);
  
  // Reactively bind variables that alter JSX (RigidBody)
  const baseFriction = useSimulationStore(state => state.baseFriction);
  const isSelected = useSimulationStore(state => state.selectedBoidId === id);

  // Deep Stateful Vectors (MUST be unique per agent)
  const targetDir = useRef(new THREE.Vector3(Math.random()-0.5, 0, Math.random()-0.5).normalize());
  const idealDir = useRef(new THREE.Vector3());

  // AI Personalities — Diverse psychological profiles for emergent behavior
  const aiStats = useMemo(() => {
    // Core personality axes (0-1 range)
    const aggression = Math.random();          // 0 = pacifist, 1 = warlord
    const bnzIntensity = Math.random();        // 0 = gentle BnZ (small climbs), 1 = extreme BnZ (massive climbs)
    const combatPersistence = Math.random();   // 0 = fire-and-forget, 1 = relentless pursuer
    const riskTolerance = 0.3 + Math.random() * 0.7;
    
    return {
      aggression,
      bnzIntensity,
      combatPersistence,
      riskTolerance,
      evasionDir: Math.random() > 0.5 ? 1 : -1,
      // BnZ climb depth: how much speed the boid sacrifices climbing before diving.
      // Low intensity (0): climb until speedRatio=0.60 (abort early, shallow climb)
      // High intensity (1): climb until speedRatio=0.20 (push climb until almost stalling, maximum peak altitude!)
      bnzClimbDepth: 0.60 - bnzIntensity * 0.40,
      // BnZ initiation chance: how eagerly the boid enters BnZ from cruise
      bnzEagerness: 0.2 + bnzIntensity * 0.8,    // 0.2 to 1.0
      // Dogfight exit threshold: at what speedRatio the boid gives up the chase
      // Low persistence (0): exits dogfight at speedRatio=0.80 (quickly returns to own dynamics)
      // High persistence (1): exits dogfight at speedRatio=0.30 (chases until almost stalled)
      dogfightExitRatio: 0.80 - combatPersistence * 0.50,
      color: BOID_COLORS[index % BOID_COLORS.length]
    };
  }, [index]);

  // Store personality in simMetrics so the info panel can read it
  useMemo(() => {
    simMetrics.boidPersonalities.set(id, {
      aggression: aiStats.aggression,
      energyStyle: aiStats.bnzIntensity,
      riskTolerance: aiStats.riskTolerance,
      diveFraction: aiStats.bnzClimbDepth,
      climbFraction: aiStats.dogfightExitRatio
    });
  }, [id, aiStats]);

  const initialPosition = useMemo(() => {
    const scale = useSimulationStore.getState().arenaScale;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 5 * scale;
    return new THREE.Vector3(Math.cos(angle) * radius, (10 + index * 2.0) * scale, Math.sin(angle) * radius);
  }, [index]);

  useFrame((state, delta) => {
    if (!bodyRef.current) return;
    const body = bodyRef.current;
    
    const _targetDir = targetDir.current;
    const _idealDir = idealDir.current;

    // Respawner
    if (respawning.current) {
       // Respawn at a scaled position based on current arenaScale
       const scale = useSimulationStore.getState().arenaScale;
       const angle = Math.random() * Math.PI * 2;
       const radius = Math.random() * 5 * scale;
       const spawnY = (10 + index * 2.0) * scale;
       body.setTranslation({ x: Math.cos(angle) * radius, y: spawnY, z: Math.sin(angle) * radius }, true);
       body.setLinvel({ x: 0, y: 0, z: 0 }, true);
       body.setAngvel({ x: 0, y: 0, z: 0 }, true);
       respawning.current = false;
       wasGrounded.current = false;
       prevNormal.current.set(0, 1, 0); // Reset so we don't compare against stale normal from death location
       heat.current = 0;
       fireCooldown.current = 0;
       return;
    }

    const settings = useSimulationStore.getState();

    // Health Initialization & Monitoring
    let currentHealth = simMetrics.boidHealths.get(id);
    if (currentHealth === undefined) {
        simMetrics.boidHealths.set(id, settings.baseHealth);
        currentHealth = settings.baseHealth;
    } else if (currentHealth <= 0 && !respawning.current) {
        // KILLED by projectile damage — NOT a crash! Don't increment crashes counter.
        // kills/deaths stats already tracked by handleProjectileHit in BoidSwarm.
        simMetrics.deathMarkers.push({ id: `death-${Date.now()}-${id}`, x: body.translation().x, y: body.translation().y, z: body.translation().z, isKill: true });
        respawning.current = true;
        simMetrics.boidHealths.set(id, settings.baseHealth);
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
    const rawVel = new THREE.Vector3(vel.x, vel.y, vel.z);
    
    // We evaluate speed *after* the raycast so we can strip out vertical bouncing noise
    let speed = rawVel.length();



    _rayOrigin.set(pos.x, pos.y, pos.z);
    
    // Sensor Track logic: Spheres don't have a specific "down", we use gravity or previous known ground normal!
    const gravityDir = new THREE.Vector3(0, -1, 0);
    const searchRayDir = wasGrounded.current ? prevNormal.current.clone().negate() : gravityDir;
    
    const ray = new rapier.Ray(_rayOrigin, searchRayDir);
    const hit = world.castRay(ray, 100, true, undefined, interactionGroups(0, [0]), undefined, body as any); // filterGroups: only hit arena (group 0), ignore boids and projectiles!

    let isGrounded = false;
    let groundToi = 0;
    _surfaceNormal.copy(gravityDir.negate());

    if (hit && hit.collider && hit.collider.parent() !== body) {
      const toi = hit.toi !== undefined ? hit.toi : (hit as any).timeOfImpact;
      // Radius of Ball is 0.5. Toi < 0.8 accounts for small bumps ensuring continuous grip
      if (typeof toi === 'number' && !isNaN(toi) && toi < 0.8) {
        isGrounded = true;
        groundToi = toi;
        const nHit = hit.collider.castRayAndGetNormal(ray, 100, true);
        if (nHit !== null) {
          _surfaceNormal.set(nHit.normal.x, nHit.normal.y, nHit.normal.z).normalize();
        }
      }
    }

    // --- CLEAN VELOCITY COMPUTATION ---
    // The physics solver applies massive impulses every step to prevent the 15G gravity from tunneling the boid.
    // This pollutes body.linvel() with extreme, oscillatory vertical bouncing energy.
    // We strictly project the velocity onto the local surface tangent before computing speed for the AI and UI!
    if (isGrounded) {
        const normalVelocity = rawVel.dot(_surfaceNormal);
        const cleanVel = rawVel.clone().sub(_surfaceNormal.clone().multiplyScalar(normalVelocity));
        speed = cleanVel.length();
    }
    
    // Out of bounds / Fall Respawn (threshold scales with arena)
    if (pos.y < -30 * settings.arenaScale) {
        simMetrics.crashes++;
        simMetrics.deathMarkers.push({ id: id + '-' + Date.now(), x: pos.x, y: pos.y, z: pos.z, isKill: false });
        respawning.current = true;
        simMetrics.boidHealths.set(id, settings.baseHealth);
        return;
    }

    // Marble's current rolling direction (Default to intended direction if stopped)
    const speedRatio = speed / settings.maxSpeedCap; // 0-1 proportion of max speed
    const direction = speedRatio > 0.03 ? (isGrounded ? rawVel.clone().sub(_surfaceNormal.clone().multiplyScalar(rawVel.dot(_surfaceNormal))).normalize() : rawVel.clone().normalize()) : targetDir.current.clone().normalize();

    simMetrics.boidSpeeds.set(id, speed);
    simMetrics.boidVelocities.set(id, { x: rawVel.x, y: rawVel.y, z: rawVel.z });
    simMetrics.boidPositions.set(id, {x: pos.x, y: pos.y, z: pos.z});
    simMetrics.boidStates.set(id, aiState.current);
    if (speed > simMetrics.maxSpeed) simMetrics.maxSpeed = speed;

    // Personal Max Speed Tracker
    const currentMax = simMetrics.boidMaxSpeeds.get(id);
    if (!currentMax || speed > currentMax.speed) {
        simMetrics.boidMaxSpeeds.set(id, { speed, x: pos.x, y: pos.y, z: pos.z });
    }

    if (isGrounded) {
       // --- GEOMETRIC CRASH DETECTION (Sharp Angle Change Between Consecutive Surfaces) ---
       // ONLY compare when the boid was continuously grounded (not the first frame of landing).
       // On the first frame of landing, just record the surface normal without checking.
       // This prevents false crashes from: initial spawn, re-grounding after a jump, or stale prevNormal.
       if (wasGrounded.current && !respawning.current) {
          const angleDiff = _surfaceNormal.angleTo(prevNormal.current);
          // crashTolerance = maximum allowed angle CHANGE between two consecutive surface faces.
          // Small changes (smooth curves) are tolerated. Large sudden changes (walls/lips) cause crashes.
          // Speed gate: only count as crash if moving fast enough (proportional to max speed)
          if (!isNaN(angleDiff) && angleDiff > settings.crashTolerance && speedRatio > 0.7) {
              simMetrics.crashes++;
              simMetrics.deathMarkers.push({ id: id + '-' + Date.now(), x: pos.x, y: pos.y, z: pos.z, isKill: false });
              respawning.current = true;
              simMetrics.boidHealths.set(id, settings.baseHealth);
          }
       }
       // ALWAYS update prevNormal to current surface normal (whether we just landed or were already grounded)
       prevNormal.current.copy(_surfaceNormal);
       wasGrounded.current = true;

       // --- Lidar Edge Avoidance (Dynamic Terrain Safe) ---
       // Reduced scaling so they don't get false cliff scares halfway up walls at high speeds!
       const lookAheadDist = Math.max(speed * (settings.lookAheadDist * 0.1), settings.maxSpeedCap * 0.06);
       _lidarOrigin.copy(pos).add(direction.clone().multiplyScalar(lookAheadDist));
       // CRUCIAL MATH FIX: Elevate the Lidar 10 meters perpendicular to the surface BEFORE shooting back down!
       _lidarOrigin.add(_surfaceNormal.clone().multiplyScalar(10.0));
       
       const lidarRay = new rapier.Ray(_lidarOrigin, _surfaceNormal.clone().negate());
       const lidarHit = world.castRay(lidarRay, 20.0, true, undefined, interactionGroups(0, [0]), undefined, body as any);
       
       // Compute projected gravity — used by energy management AND state handlers.
       // projectedGravity = component of world gravity on the surface tangent plane.
       // On flat surfaces, this is ~zero. On slopes, it points downhill.
       const projectedGravity = gravityDir.clone().sub(
         _surfaceNormal.clone().multiplyScalar(gravityDir.dot(_surfaceNormal))
       );
       const hasSlope = projectedGravity.lengthSq() > 0.01;
       if (!hasSlope) projectedGravity.copy(_targetDir); // Flat fallback

       if (!lidarHit) {
           // DANGER: We are heading off a cliff!
           if (aiState.current !== 'EVADE') {
               aiState.current = 'EVADE';
               
               const leftDir = direction.clone().applyAxisAngle(_surfaceNormal, Math.PI / 4);
               const rightDir = direction.clone().applyAxisAngle(_surfaceNormal, -Math.PI / 4);
               
               const posVec = new THREE.Vector3(pos.x, pos.y, pos.z);
               const leftOrigin = posVec.clone().add(leftDir.multiplyScalar(lookAheadDist)).add(_surfaceNormal.clone().multiplyScalar(10.0));
               const rightOrigin = posVec.clone().add(rightDir.multiplyScalar(lookAheadDist)).add(_surfaceNormal.clone().multiplyScalar(10.0));

               const leftHit = world.castRay(new rapier.Ray(leftOrigin, _surfaceNormal.clone().negate()), 20.0, true, undefined, interactionGroups(0, [0]), undefined, body as any);
               const rightHit = world.castRay(new rapier.Ray(rightOrigin, _surfaceNormal.clone().negate()), 20.0, true, undefined, interactionGroups(0, [0]), undefined, body as any);
               
               if (leftHit && !rightHit) evadeSpinDir.current = 1;
               else if (rightHit && !leftHit) evadeSpinDir.current = -1;
               else evadeSpinDir.current = 1;
           }
        } else {
            // SAFE AHEAD!
            if (aiState.current === 'EVADE') {
                if (hasSlope) {
                   aiState.current = 'BNZ_DIVE'; // Plunge beautifully back into the bowl from the upper rim!
                } else {
                   aiState.current = 'CRUISE'; // Safe default flatland behavior
                }
            }

           // --- STATE MACHINE ---
           // Two doctrines: CRUISE (stable) and BnZ (energy cycling).
           // DOGFIGHT is reachable from ANY state. After DOGFIGHT, return to preferred doctrine.
           
           if (aiState.current === 'BNZ_CLIMB') {
               // Climbing: burning speed for altitude.
               // → BNZ_DIVE when speed drops to climb depth
               if (speedRatio < aiStats.bnzClimbDepth || !hasSlope) {
                   aiState.current = 'BNZ_DIVE';
               }
           } else if (aiState.current === 'BNZ_DIVE') {
               // Diving: converting altitude to speed.
               // Let them dive until they reach immense speeds (1.3x their normal max) or run out of slope!
               if (speedRatio > 1.30 || !hasSlope) {
                   // BnZ-focused boids re-enter climb to loop the cycle
                   if (hasSlope && Math.random() < aiStats.bnzEagerness) {
                       aiState.current = 'BNZ_CLIMB';
                   } else {
                       aiState.current = 'CRUISE';
                   }
               }
           } else if (aiState.current === 'DOGFIGHT') {
               // Chasing target, bleeding speed on turns.
               // Exit when speed drops below personality threshold.
               if (speedRatio < aiStats.dogfightExitRatio) {
                   // Return to preferred doctrine, not always CRUISE
                   if (hasSlope && aiStats.bnzEagerness > 0.5) {
                       aiState.current = 'BNZ_CLIMB'; // Energy-focused: rebuild via BnZ
                   } else {
                       aiState.current = 'CRUISE';
                   }
               }
           } else if (aiState.current === 'CRUISE') {
               // Stable flight. Consider entering BnZ based on personality.
               if (hasSlope && speedRatio > 0.60 && Math.random() < (aiStats.bnzEagerness * delta * settings.bnzChance)) {
                   aiState.current = 'BNZ_CLIMB';
               }
           }
       }

       
       let targetWeight = 0;
       
       // 3. DOGFIGHT — Reachable from ANY non-EVADE state, BUT requires vision cone
       let isDogfighting = false;
       const canEnterDogfight = aiState.current !== 'EVADE' && speedRatio >= aiStats.dogfightExitRatio;
       if ((aiState.current === 'DOGFIGHT' || canEnterDogfight)) {
           let nearestDist = 100000; 
           let targetPos: {x:number, y:number, z:number} | null = null;
           
           let nearestId = '';
           simMetrics.boidPositions.forEach((posOther, otherId) => {
               if (otherId === id) return;
               const dx = posOther.x - pos.x;
               const dy = posOther.y - pos.y;
               const dz = posOther.z - pos.z;
               const distSq = dx*dx + dy*dy + dz*dz;
               if (distSq < nearestDist && distSq > 0.1) { 
                   nearestDist = distSq;
                   targetPos = posOther;
                   nearestId = otherId;
               }
           });

            // Vision cone: is the target in front of us?
            let targetInCone = false;
            if (targetPos) {
                const toTarget = new THREE.Vector3(
                    (targetPos as any).x - pos.x,
                    (targetPos as any).y - pos.y,
                    (targetPos as any).z - pos.z
                ).normalize();
                targetInCone = _targetDir.dot(toTarget) > settings.dogfightCone;
            }

            let wantsDogfight = aiState.current === 'DOGFIGHT'; // Already in combat → persist
            // Only INITIATE dogfight if enemy is in vision cone
            if (targetInCone && aiState.current !== 'DOGFIGHT') {
                // From CRUISE
                if (aiState.current === 'CRUISE' && Math.random() < (aiStats.aggression * delta * 2.0)) {
                    wantsDogfight = true;
                }
                // From BNZ_DIVE — the "boom" attack run
                if (aiState.current === 'BNZ_DIVE' && Math.random() < (aiStats.aggression * delta * 3.0)) {
                    wantsDogfight = true;
                }
                // From BNZ_CLIMB — only for very aggressive boids
                if (aiState.current === 'BNZ_CLIMB' && aiStats.aggression > 0.7 && Math.random() < (aiStats.aggression * delta * 1.0)) {
                    wantsDogfight = true;
                }
            }

           if (targetPos !== null && wantsDogfight) {
               aiState.current = 'DOGFIGHT';
               isDogfighting = true;
               
               // Target Leading (Predator AI)
               const targetVel = simMetrics.boidVelocities.get(nearestId) || {x: 0, y: 0, z: 0};
               const dist = Math.sqrt(nearestDist);
               const bulletSpeed = Math.max(speed * 1.5, settings.projectileSpeed);
               const timeToHit = dist / bulletSpeed; // Physical prediction of impact
               
               // Track the predicted future position
               const futureTargetPos = new THREE.Vector3(
                   (targetPos as any).x + targetVel.x * timeToHit,
                   (targetPos as any).y + targetVel.y * timeToHit,
                   (targetPos as any).z + targetVel.z * timeToHit
               );

               const rawHuntDir = new THREE.Vector3(futureTargetPos.x - pos.x, futureTargetPos.y - pos.y, futureTargetPos.z - pos.z).normalize();
               const projectedHunt = rawHuntDir.clone().sub(_surfaceNormal.clone().multiplyScalar(rawHuntDir.dot(_surfaceNormal))).normalize();
               
               if (projectedHunt.lengthSq() > 0.01) {
                   _idealDir.copy(projectedHunt);
                   targetWeight = 1.0;
               }

               // FIRE PROJECTILE! (Machine Gun Burst)
               // PHYSICAL REQUIREMENT: Only fire when the nose is aligned with the predicted intercept point.
               const aimDot = _targetDir.dot(rawHuntDir);
               
               // Map the UI slider (0.1 to 0.95) to a physically realistic trigger discipline.
               // 0.1  = 0.77 (~39 degrees tolerance — "Spray and pray")
               // 0.95 = 0.99 (~8 degrees absolute tolerance — Strict sniper)
               const triggerDiscipline = 0.75 + (settings.huntConeCone * 0.25);
               
               if (aimDot > triggerDiscipline && fireCooldown.current <= 0) {
                   // Small spread to simulate bursts, tied purely to the boid's position.
                   const spreadX = (Math.random() - 0.5) * 0.2;
                   const spreadZ = (Math.random() - 0.5) * 0.2;

                   simMetrics.shotsFired++;
                   
                   // KEY FIX:
                   // 1. Direction: Fire EXACTLY where the nose (_targetDir) points
                   // 2. Height (Y): Spawn at ground level (pos.y + _targetDir.y), no floating.
                   // This ensures Rapier keeps the projectile "skating" on the curved surface
                   // using gravity to push it against the ground.
                   useSimulationStore.getState().spawnProjectile({
                       id: `proj-${Date.now()}-${Math.random()}`,
                       pos: { 
                           x: pos.x + _targetDir.x * 2.0 + spreadX, 
                           y: pos.y + _targetDir.y * 2.0, // Ground level, no floating offset
                           z: pos.z + _targetDir.z * 2.0 + spreadZ
                       },
                       dir: { x: _targetDir.x, y: _targetDir.y, z: _targetDir.z },
                       speed: bulletSpeed, 
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
       if (!isDogfighting) {
           // --- AI COMMAND INTERPRETER ---
           if (aiState.current === 'EVADE') {
              _idealDir.copy(_targetDir).applyAxisAngle(_surfaceNormal, evadeSpinDir.current * (Math.PI / 2)).normalize();
              targetWeight = 1.0;
           } else if (aiState.current === 'BNZ_CLIMB') {
               // BnZ CLIMB: smoothly carve uphill. 
               // Blend forward momentum with uphill gradient to avoid artificial 180-degree U-turns.
               const uphill = projectedGravity.clone().negate().normalize();
               const blend = direction.clone().add(uphill.multiplyScalar(1.5)); // 80% momentum, 80% gradient
               if (blend.lengthSq() < 0.01) blend.copy(direction).applyAxisAngle(_surfaceNormal, 0.5); // Break stall symmetry
               _idealDir.copy(blend).normalize();
               targetWeight = 1.0;
            } else if (aiState.current === 'BNZ_DIVE') {
               // BnZ DIVE: smoothly carve downhill.
               const downhill = projectedGravity.clone().normalize();
               const blend = direction.clone().add(downhill.multiplyScalar(1.5));
               if (blend.lengthSq() < 0.01) blend.copy(direction).applyAxisAngle(_surfaceNormal, 0.5);
               _idealDir.copy(blend).normalize();
               targetWeight = 1.0;
           } else {
              // CRUISE: Maintain current trajectory. Don't seek uphill or downhill.
              // Go straight with full motor for stable acceleration.
              _idealDir.copy(_targetDir);
              targetWeight = 1.0;
           }
       }

       // Mathematically constrain both intention (_idealDir) and actual nose (_targetDir) 
       // to NEVER point into or off the ground. They must slide perfectly on the local tangent plane.
       _idealDir.sub(_surfaceNormal.clone().multiplyScalar(_idealDir.dot(_surfaceNormal))).normalize();
       _targetDir.sub(_surfaceNormal.clone().multiplyScalar(_targetDir.dot(_surfaceNormal))).normalize();

       // Calculate precisely how much we are turning to enforce the Turn Penalty Rule
       const turnAmount = 1.0 - Math.max(0, _targetDir.dot(_idealDir)); 
       
       let newVel = new THREE.Vector3(rawVel.x, rawVel.y, rawVel.z);
       let hasVelChange = false;

       // Energy penalty for turning (The sharper the ideal turn, the more velocity is lost)
       // We lowered the penalty significantly so they don't fall out of the sky while turning to HUNT
       if (turnAmount > 0.01) {
           const penalty = 1.0 - (turnAmount * delta * settings.turnPenalty);
           newVel.x *= penalty;
           newVel.y *= penalty;
           newVel.z *= penalty;
           hasVelChange = true;
       }

       // --- SURFACE TANGENT PLANE VELOCITY PROJECTION ---
       // When grounded, the velocity must lie FLAT on the surface tangent plane.
       // Strip the ENTIRE normal component (both bounce-up AND penetration-down).
       // This solves the uphill bouncing: Rapier's solver ejects the ball upward from
       // trimesh edges BEFORE useFrame runs. The old "anti-bounce" only caught downward
       // velocity (speedIntoSurface < 0), completely missing the upward ejection.
       if (wasGrounded.current) {
           const normalComponent = newVel.dot(_surfaceNormal);
           // Remove ALL velocity along the surface normal — zero bounce, zero penetration.
           newVel.sub(_surfaceNormal.clone().multiplyScalar(normalComponent));
           hasVelChange = true;
       }

       if (hasVelChange) {
           body.setLinvel(newVel, true);
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
           const stateLabels: Record<string, string> = {
               'CRUISE': 'C', 'BNZ_CLIMB': 'Z', 'BNZ_DIVE': 'S', 'DOGFIGHT': 'D', 'EVADE': 'E'
           };
           textRef.current.text = stateLabels[aiState.current] || aiState.current[0]; 
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

       // --- POSITION SNAP: Keep boid riding AT the surface ---
       // This replaces centripetal grip impulses which caused slam-bounce oscillation.
       // The ball radius is 0.5. We want the center at exactly 0.5 above the surface.
       // groundToi = distance from ray origin (boid center) to surface.
       // Ideal groundToi = 0.5 (ball radius). If > 0.5, boid is floating. If < 0.5, boid is penetrating.
       const idealHeight = 0.5; // Ball radius
       const heightError = groundToi - idealHeight;
       if (Math.abs(heightError) > 0.01) {
           // Snap position toward/away from surface to maintain correct height
           body.setTranslation({
               x: pos.x + searchRayDir.x * heightError,
               y: pos.y + searchRayDir.y * heightError,
               z: pos.z + searchRayDir.z * heightError
           }, true);
       }
       
       // --- AERODYNAMIC DRAG (Replaces Hard Speed Cap) ---
       // Force_drag = k * v^2
       // calculated relative to the true projected tangential velocity (newVel) calculated above.
       const currentSpeedSq = newVel.x * newVel.x + newVel.y * newVel.y + newVel.z * newVel.z;
       const finalSpeed = Math.sqrt(currentSpeedSq);
       
       if (currentSpeedSq > 0.1) {
           const kDrag = settings.motorPower / (settings.maxSpeedCap * settings.maxSpeedCap);
           let dragImpulse = kDrag * currentSpeedSq * delta;
           
           // PREVENT EULER INSTABILITY: Drag should never reverse velocity during a lag spike
           const maxMomentum = finalSpeed * 2.0; // mass = 2
           if (dragImpulse > maxMomentum * 0.9) dragImpulse = maxMomentum * 0.9;
           
           // Apply aerodynamic drag directly opposing current velocity vector
           body.applyImpulse({
               x: -(newVel.x / finalSpeed) * dragImpulse,
               y: -(newVel.y / finalSpeed) * dragImpulse,
               z: -(newVel.z / finalSpeed) * dragImpulse
           }, true);
       }

       // --- VELOCITY DIRECTION STEERING ---
       // The velocity direction must also respect the turn rate, not just the nose (_targetDir).
       // Without this, tangent plane projection and physics forces can change the actual
       // movement direction instantly, bypassing the turn rate constraint.
       // We gradually steer the velocity direction toward _targetDir.
       if (finalSpeed > 1.0) {
           const velDir = new THREE.Vector3(newVel.x, newVel.y, newVel.z).normalize();
           const angleVelToNose = velDir.angleTo(_targetDir);
           
           // Only steer if velocity and nose diverge significantly
           if (angleVelToNose > 0.05) {
               const maxVelSteer = maxAngleToTurn * 2.0; // Allow slightly faster velocity alignment than nose rotation
               const steerAngle = Math.min(angleVelToNose, maxVelSteer);
               const steerAxis = new THREE.Vector3().crossVectors(velDir, _targetDir).normalize();
               
               if (steerAxis.lengthSq() > 0.001) {
                   velDir.applyAxisAngle(steerAxis, steerAngle);
                   // Project steered direction onto tangent plane to keep it on the surface
                   velDir.sub(_surfaceNormal.clone().multiplyScalar(velDir.dot(_surfaceNormal))).normalize();
                   
                   const currentSpeed = Math.sqrt(newVel.x * newVel.x + newVel.y * newVel.y + newVel.z * newVel.z);
                   body.setLinvel({
                       x: velDir.x * currentSpeed,
                       y: velDir.y * currentSpeed,
                       z: velDir.z * currentSpeed
                   }, true);
               }
           }
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
        mass={2}
        gravityScale={15.0} // Massive gravity boost to give it authority against the powerful 600N motor
        colliders={false}
        restitution={0.0}
        friction={0.0}
        linearDamping={0.1}
        angularDamping={2.0}
        ccd={true}
        collisionGroups={interactionGroups(1, [0, 1, 2])}
        solverGroups={interactionGroups(1, [0])} // They can no longer violently bump into each other (only into the arena) to avoid spawn explosions
      >
        <BallCollider args={[0.5]} friction={0.0} solverGroups={interactionGroups(1, [0])} />
        
        {/* Visible boid mesh */}
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[0.5, 12, 12]} />
          <meshStandardMaterial 
              color={aiStats.color} 
              roughness={0.9}
              metalness={0.1}
              wireframe={true}
          />
          <mesh>
               <sphereGeometry args={[0.2, 16, 16]} />
               <meshBasicMaterial color={aiStats.color} />
          </mesh>
        </mesh>

        {/* Large invisible hit area for clicking — 6x the boid radius */}
        <mesh
          visible={false}
          onClick={(e) => {
            e.stopPropagation();
            const store = useSimulationStore.getState();
            store.setSelectedBoid(store.selectedBoidId === id ? null : id);
          }}
          onPointerEnter={() => setIsHovered(true)}
          onPointerLeave={() => setIsHovered(false)}
        >
          <sphereGeometry args={[6.0, 8, 8]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>

        {/* Hover ring — shows when mouse is near */}
        {isHovered && (
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.8, 1.2, 24]} />
            <meshBasicMaterial color={aiStats.color} transparent opacity={0.4} side={THREE.DoubleSide} />
          </mesh>
        )}

        {/* Selection ring — persistent glow when selected */}
        {isSelected && (
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.0, 1.5, 32]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
        )}
      </RigidBody>

      <arrowHelper 
          ref={arrowRef} 
          args={[new THREE.Vector3(1,0,0), new THREE.Vector3(0,0,0), 3.0, aiStats.color]} 
          visible={false} 
      />

      <Text
          ref={textRef}
          position={[0, 0, 0]}
          fontSize={3.0}
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
