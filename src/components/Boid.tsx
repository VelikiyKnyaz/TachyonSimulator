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

// Zero-allocation bullet scan vectors (reused every frame for ALL boids sequentially)
const _bulletRelPos = new THREE.Vector3();
const _bulletRelVel = new THREE.Vector3();
const _boidVel3 = new THREE.Vector3();
const _cpaPoint = new THREE.Vector3();
const _threatApproach = new THREE.Vector3();

type BoidState = 'CRUISE' | 'HUNT' | 'EVADE';

export function Boid({ id, index }: { id: string, index: number }) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const arrowRef = useRef<THREE.ArrowHelper>(null);
  const textRef = useRef<any>(null); // For Drei Text component
  const { rapier, world } = useRapier();
  const prevNormal = useRef(new THREE.Vector3(0, 1, 0));
  const aiState = useRef<BoidState>('CRUISE');
  const vendettaTargetId = useRef<string | null>(null);
  const evadeSpinDir = useRef<number>(1); // 1 = Left, -1 = Right
  const evadeTargetDir = useRef(new THREE.Vector3()); 
  const evadeTimer = useRef(0);          // Countdown: how long to sustain current evasion maneuver
  const jinkTimer = useRef(0);           // Sub-timer: when to flip jink direction
  const evadeThreatDir = useRef(new THREE.Vector3()); // Approach direction of the most dangerous bullet
  const evadeRetaliateId = useRef<string | null>(null); // After dodge, counter-attack this shooter
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
    const combatPersistence = Math.random();   // 0 = fire-and-forget, 1 = relentless pursuer
    const riskTolerance = 0.3 + Math.random() * 0.7;
    
    return {
      aggression,
      combatPersistence,
      riskTolerance,
      evasionDir: Math.random() > 0.5 ? 1 : -1,
      color: BOID_COLORS[index % BOID_COLORS.length]
    };
  }, [index]);

  // Store personality in simMetrics so the info panel can read it
  useMemo(() => {
    simMetrics.boidPersonalities.set(id, {
      aggression: aiStats.aggression,
      combatPersistence: aiStats.combatPersistence,
      riskTolerance: aiStats.riskTolerance,
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
       evadeTimer.current = 0;
       jinkTimer.current = 0;
       evadeRetaliateId.current = null;
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
    
    // CRITICAL BUG FIX (Terminal Velocity Parachute): 
    // Gravity is 15G so they fall terrifyingly fast on spawn. If they exceed -30 m/s downward, 
    // their distance traveled per frame exceeds their collision sphere radius (0.5m), causing them
    // to instantly tunnel completely through thin floor meshes without Rapier detecting the hit!
    // We cap fall speed to -28 m/s to ensure they always intersect the floor for at least 1 frame.
    if (!wasGrounded.current && vel.y < -28) {
        body.setLinvel({ x: vel.x, y: -28, z: vel.z }, true);
        vel.y = -28;
    }
    
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
      const toi = (hit as any).toi !== undefined ? (hit as any).toi : (hit as any).timeOfImpact;
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

    // Apply ground-touching spawn boost (only fires on the exact frame they establish contact with the ground)
    if (isGrounded && !wasGrounded.current && !respawning.current) {
        if (settings.initialSpeed > 0) {
            const randAngle = Math.random() * Math.PI * 2;
            let launchDir = new THREE.Vector3(Math.cos(randAngle), 0, Math.sin(randAngle));
            
            // Project random direction perfectly onto the tangent floor
            launchDir.sub(_surfaceNormal.clone().multiplyScalar(launchDir.dot(_surfaceNormal))).normalize();
            
            if (launchDir.lengthSq() > 0.1) {
                targetDir.current.copy(launchDir);
                idealDir.current.copy(launchDir);
                
                // Update the rawVel variable so the rest of the useFrame loop (including newVel and speed tracking) inherits this boost
                rawVel.set(
                    launchDir.x * settings.initialSpeed,
                    launchDir.y * settings.initialSpeed,
                    launchDir.z * settings.initialSpeed
                );
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

    // We judge AI flight performance against the maneuvering top speed (aerodynamic brake max), 
    // NOT the theoretical vacuum drag limit (maxSpeedCap=500), because in dogfights they are always turning.
    const combatReferenceSpeed = Math.max(50.0, settings.turnPenaltyMaxSpeed * 1.25);
    const speedRatio = Math.min(1.0, speed / combatReferenceSpeed); // 0-1 proportion of combat speed
    let activeDirection = targetDir.current.clone().normalize();
    if (speedRatio > 0.03) {
        if (isGrounded) {
             const tanVel = rawVel.clone().sub(_surfaceNormal.clone().multiplyScalar(rawVel.dot(_surfaceNormal)));
             if (tanVel.lengthSq() > 0.0001) activeDirection = tanVel.normalize();
        } else {
             if (rawVel.lengthSq() > 0.0001) activeDirection = rawVel.clone().normalize();
        }
    }
    const direction = activeDirection;

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
       // CRUCIAL: Boids require physical space to execute a turn. We map the warning distance to their turning radius!
       const maxTurnRateRad = settings.maxTurnRateDeg * (Math.PI / 180);
       const physicalTurnRadius = speed / Math.max(0.1, maxTurnRateRad); 
       // Capped at 50 to prevent shooting rays totally outside the curvature of smaller arenas at high speeds!
       const lookAheadDist = Math.min(50.0 * settings.arenaScale, Math.max(physicalTurnRadius * (settings.lookAheadDist * 1.5), speed * 0.1));
       
       _lidarOrigin.copy(pos).add(direction.clone().multiplyScalar(lookAheadDist));
       // Elevate the Lidar 10 meters perpendicular to the surface BEFORE shooting back down!
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
            // DANGER: We are heading off a cliff! Priority 1 override.
            // jinkTimer is repurposed as a cooldown to lock in the escape direction
            if (aiState.current !== 'EVADE' || jinkTimer.current <= 0) {
                aiState.current = 'EVADE';
                
                // Force evasion timer to ensure we complete the turn
                evadeTimer.current = 1.0; 
                jinkTimer.current = 1.0; // Lock the cliff-escape angle for up to 1 second
                
                const leftDir = direction.clone().applyAxisAngle(_surfaceNormal, Math.PI / 4);
                const rightDir = direction.clone().applyAxisAngle(_surfaceNormal, -Math.PI / 4);
                
                const posVec = new THREE.Vector3(pos.x, pos.y, pos.z);
                const leftOrigin = posVec.clone().add(leftDir.multiplyScalar(lookAheadDist)).add(_surfaceNormal.clone().multiplyScalar(10.0));
                const rightOrigin = posVec.clone().add(rightDir.multiplyScalar(lookAheadDist)).add(_surfaceNormal.clone().multiplyScalar(10.0));

                const leftHit = world.castRay(new rapier.Ray(leftOrigin, _surfaceNormal.clone().negate()), 20.0, true, undefined, interactionGroups(0, [0]), undefined, body as any);
                const rightHit = world.castRay(new rapier.Ray(rightOrigin, _surfaceNormal.clone().negate()), 20.0, true, undefined, interactionGroups(0, [0]), undefined, body as any);
                
                 if (leftHit && !rightHit) evadeSpinDir.current = 1;
                 else if (rightHit && !leftHit) evadeSpinDir.current = -1;
                 else evadeSpinDir.current = Math.random() > 0.5 ? 1 : -1;
                 
                 // Immediately lock in a 120-degree escape coordinate on the surface relative to where we currently face!
                 // This prevents the mathematical trap where _targetDir chasing _idealDir creates an infinite circle.
                 evadeTargetDir.current.copy(_targetDir).applyAxisAngle(_surfaceNormal, evadeSpinDir.current * (Math.PI / 1.5)).normalize();
             } else {
                 // Keep the evasion timer alive as long as we are still in danger of the cliff
                 evadeTimer.current = Math.max(evadeTimer.current, 0.2);
             }
        } else {
             // SAFE FROM TERRAIN!
             jinkTimer.current = 0; // Reset cliff escape lock
             
             // --- BULLET EVASION / COUNTER-ATTACK (CPA-Based Threat Detection) ---
             // Use Closest Point of Approach (CPA) math instead of direction alignment.
             // This correctly detects bullets that will *pass close* to the boid,
             // not just bullets aimed directly at the boid center.
             let worstCpaDist = Infinity;
             let worstCpaTime = Infinity;
             let threatOwnerId: string | null = null;
             
             // Danger scan radius: 0.5 seconds of bullet travel time (adequate reaction window)
             const dangerScanRadius = Math.max(settings.projectileSpeed * 0.5, 60);
             
             // Pre-set boid velocity vector (reuse module-level vector, zero alloc)
             _boidVel3.set(vel.x, vel.y, vel.z);
             
             simMetrics.projectileData.forEach((bullet) => {
                 if (bullet.ownerId === id) return; // Ignore our own bullets
                 
                 // Relative position: bullet relative to boid (zero-alloc)
                 _bulletRelPos.set(
                     bullet.pos.x - pos.x,
                     bullet.pos.y - pos.y,
                     bullet.pos.z - pos.z
                 );
                 
                 const distToBullet = _bulletRelPos.length();
                 if (distToBullet > dangerScanRadius) return; // Outside scan radius
                 
                 // Relative velocity: bullet velocity minus boid velocity
                 _bulletRelVel.set(
                     bullet.vel.x - vel.x,
                     bullet.vel.y - vel.y,
                     bullet.vel.z - vel.z
                 );
                 
                 const relVelSq = _bulletRelVel.lengthSq();
                 if (relVelSq < 0.01) return; // Bullet co-moving with us
                 
                 // Time to Closest Point of Approach
                 const tCPA = -_bulletRelPos.dot(_bulletRelVel) / relVelSq;
                 
                 if (tCPA < 0) return; // Bullet is receding, not approaching
                 if (tCPA > 1.0) return; // Threat is too far in the future (>1 second)
                 
                 // CPA distance: how close will the bullet pass?
                 _cpaPoint.copy(_bulletRelPos).addScaledVector(_bulletRelVel, tCPA);
                 const cpaDist = _cpaPoint.length();
                 
                 // Is this bullet within the evasion CPA radius?
                 if (cpaDist < settings.evasionCpaRadius && cpaDist < worstCpaDist) {
                     worstCpaDist = cpaDist;
                     worstCpaTime = tCPA;
                     threatOwnerId = bullet.ownerId;
                     // Store the bullet's approach direction for dodge perpendicular calculation
                     _threatApproach.copy(_bulletRelVel).normalize();
                 }
             });

             const bulletDanger = worstCpaDist < settings.evasionCpaRadius;

             if (bulletDanger) {
                 // EVASION TRIGGER — Detected a bullet that will pass dangerously close
                 
                 if (aiState.current !== 'EVADE') {
                     // --- ENTER EVASION (fresh transition) ---
                     aiState.current = 'EVADE';
                     
                     // Set evasion timer: sustain maneuver for 0.8—1.5 seconds
                     evadeTimer.current = 0.8 + Math.random() * 0.7;
                     
                     // Pick initial dodge direction perpendicular to threat approach
                     evadeSpinDir.current = Math.random() > 0.5 ? 1 : -1;
                     
                     // Store threat approach for continuous jinking recalculation
                     evadeThreatDir.current.copy(_threatApproach);
                     
                     // Aggressive boids: remember shooter for retaliation AFTER dodge
                     if (aiStats.aggression > 0.5 && threatOwnerId) {
                         evadeRetaliateId.current = threatOwnerId;
                     } else {
                         evadeRetaliateId.current = null;
                     }
                 } else {
                     // --- SUSTAIN EVASION (already evading, update threat info) ---
                     // Refresh the threat direction with the latest dangerous bullet
                     evadeThreatDir.current.copy(_threatApproach);
                     
                     // If a new, closer bullet appears, extend evasion timer slightly
                     if (worstCpaTime < 0.3) {
                         evadeTimer.current = Math.max(evadeTimer.current, 0.5);
                     }
                 }
                 
                 // --- JINKING: Compute dodge direction each frame ---
                 // Perpendicular to threat approach, projected onto surface tangent plane
                 // With ~30° backward bias to increase separation from shooter
                 const dodgeAngle = evadeSpinDir.current * (Math.PI / 2.2); // ~82° perpendicular + backward lean
                 evadeTargetDir.current.copy(evadeThreatDir.current)
                     .negate() // Face away from threat
                     .applyAxisAngle(_surfaceNormal, dodgeAngle)
                     .normalize();
                 
             }
             
             // --- EVASION TIMER MANAGEMENT (persists even when no bullet detected this frame) ---
             if (aiState.current === 'EVADE' && evadeTimer.current > 0) {
                 evadeTimer.current -= delta;
                 jinkTimer.current -= delta;
                 
                 // Evasion expired — transition out
                 if (evadeTimer.current <= 0) {
                     if (evadeRetaliateId.current && (simMetrics.boidHealths.get(evadeRetaliateId.current) ?? 0) > 0) {
                         // Aggressive retaliation: dodge complete, now HUNT the shooter
                         aiState.current = 'HUNT';
                         vendettaTargetId.current = evadeRetaliateId.current;
                     } else {
                         aiState.current = 'CRUISE';
                     }
                     evadeRetaliateId.current = null;
                 }
             } else if (aiState.current === 'EVADE' && !bulletDanger) {
                 // Timer already expired and no active threat — safe to exit
                 aiState.current = 'CRUISE';
             }

             // --- STATE MACHINE ---
             // Two doctrines: CRUISE (stable gliding) and HUNT (combat).
             
             if (aiState.current === 'HUNT') {
                 // Exit combat: personality + SPEED factor.
                 // Slowing down erodes combat will — if you can't maintain speed, disengage.
                 const speedDisengage = 1.0 - Math.min(1.0, speedRatio * 2.0); // 0 at 50%+ speed, 1 at 0 speed
                 const disengageChance = ((1.0 - aiStats.combatPersistence) + speedDisengage) * delta * 0.3;
                 if (Math.random() < disengageChance) {
                     aiState.current = 'CRUISE';
                 }
             }
        }
       
       let targetWeight = 1.0;
       
        // 3. HUNT — Reachable from ANY non-EVADE state
       let isDogfighting = false;
       const canEnterDogfight = aiState.current !== 'EVADE';
       if ((aiState.current === 'HUNT' || canEnterDogfight)) {
           let nearestDist = Infinity; 
           let targetPos: {x:number, y:number, z:number} | null = null;
            let nearestId = '';
            
            // 1. Check if we have an active vendetta against a shooter who is still alive
            if (vendettaTargetId.current && (simMetrics.boidHealths.get(vendettaTargetId.current) ?? 0) > 0) {
                nearestId = vendettaTargetId.current;
                targetPos = simMetrics.boidPositions.get(nearestId) || null;
                
                // CRUCIAL BUG FIX: We must calculate distance to our vendetta! 
                // Previously nearestDist stayed Infinity, causing bullet prediction and rendering to output NaN.
                if (targetPos) {
                    const dx = targetPos.x - pos.x;
                    const dy = targetPos.y - pos.y;
                    const dz = targetPos.z - pos.z;
                    nearestDist = dx*dx + dy*dy + dz*dz;
                }
            } else {
               vendettaTargetId.current = null; // Clear if dead/disconnected
            }

            // 2. If no vendetta, fall back to hunting the closest visible prey
            if (!targetPos) {
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
            }

             // Omni-directional Radar: is the target near us?
             const radarRadiusSq = settings.radarRadius * settings.radarRadius;
             const targetInRadar = targetPos ? nearestDist < radarRadiusSq : false;
             
             // Frontal Cone Radar: secondary detection area pointing exactly where we are looking
             let targetInFrontalCone = false;
             if (targetPos && !targetInRadar) {
                 const frontalLengthSq = settings.radarFrontalLength * settings.radarFrontalLength;
                 if (nearestDist < frontalLengthSq) {
                     const targetDx = targetPos.x - pos.x;
                     const targetDy = targetPos.y - pos.y;
                     const targetDz = targetPos.z - pos.z;
                     const dirToTarget = new THREE.Vector3(targetDx, targetDy, targetDz).normalize();
                     
                     if (_targetDir.dot(dirToTarget) > settings.radarFrontalAngle) {
                         targetInFrontalCone = true;
                     }
                 }
             }

             let wantsHunt = aiState.current === 'HUNT'; // Already in combat → persist
             
             // Iniciar hunt basado en proximidad (radar o cono) y velocidad
             // No more random pacifists: If they see an enemy in range, they ATTACK.
             if ((targetInRadar || targetInFrontalCone) && aiState.current !== 'HUNT') {
                 wantsHunt = true;
             }

            if (targetPos !== null && wantsHunt) {
                aiState.current = 'HUNT';
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
                }

                // FIRE PROJECTILE! (Machine Gun Burst)
                // PHYSICAL REQUIREMENT: Only fire when the nose is aligned with the predicted intercept point.
                const aimDot = _targetDir.dot(rawHuntDir);
                
                // Map the UI slider (0.1 to 0.95) to a physically realistic trigger discipline.
                const triggerDiscipline = 0.75 + (settings.huntConeCone * 0.25);
                
                if (aimDot > triggerDiscipline && fireCooldown.current <= 0) {
                    const spreadX = (Math.random() - 0.5) * 0.2;
                    const spreadZ = (Math.random() - 0.5) * 0.2;

                    simMetrics.shotsFired++;
                    
                    useSimulationStore.getState().spawnProjectile({
                        id: `proj-${Date.now()}-${Math.random()}`,
                        pos: { 
                            x: pos.x + _targetDir.x * 2.0 + spreadX, 
                            y: pos.y + _targetDir.y * 2.0,
                            z: pos.z + _targetDir.z * 2.0 + spreadZ
                        },
                        dir: { x: _targetDir.x, y: _targetDir.y, z: _targetDir.z },
                        speed: bulletSpeed, 
                        ownerId: id,
                        shooterSpeed: speed  // Store shooter's speed at moment of firing for damage scaling
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
                _idealDir.copy(evadeTargetDir.current);
             } else {
               // CRUISE: Maintain current trajectory. Don't seek uphill or downhill.
               // Go straight with full motor for stable acceleration.
               _idealDir.copy(_targetDir);
            }
        }

        // Mathematically constrain both intention (_idealDir) and actual nose (_targetDir) 
        // to NEVER point into or off the ground. They must slide perfectly on the local tangent plane.
        _idealDir.sub(_surfaceNormal.clone().multiplyScalar(_idealDir.dot(_surfaceNormal))).normalize();
        _targetDir.sub(_surfaceNormal.clone().multiplyScalar(_targetDir.dot(_surfaceNormal))).normalize();

        let newVel = new THREE.Vector3(rawVel.x, rawVel.y, rawVel.z);
        let hasVelChange = false;

        // "Action of Turning": The physical penalty strictly applied when the AI aggressively steers the vehicle's nose
        const turnStress = 1.0 - Math.max(0, _targetDir.dot(_idealDir)); 

        // Calculate speed-gated penalty scalar (0.0 to 1.0)
        let penaltySpeedScalar = 0.0;
        const speedRange = settings.turnPenaltyMaxSpeed - settings.turnPenaltyMinSpeed;
        if (speedRange > 0.001) {
            penaltySpeedScalar = Math.max(0.0, Math.min(1.0, (speed - settings.turnPenaltyMinSpeed) / speedRange));
        } else {
            penaltySpeedScalar = speed >= settings.turnPenaltyMaxSpeed ? 1.0 : 0.0;
        }

        // If the boid is actively executing an AI turning command
        if (turnStress > 0.01 && penaltySpeedScalar > 0.001) {
            // Penalization scales with both User's multiplier and the boid's current velocity
            const penaltyStrength = settings.turnPenalty * 0.8 * penaltySpeedScalar; 
            
            // Turn penalty applies to ALL states — there is NO free turning.
            // Evasion must pay the same physics cost as any other maneuver.
            // 1. Aerodynamic Bleed: Actively strip away their momentum based on how hard they are turning
            const velocityBleed = Math.max(0.7, 1.0 - (turnStress * delta * penaltyStrength));
            newVel.multiplyScalar(velocityBleed);
            hasVelChange = true;
            
            // 2. Engine Thrust Vectoring: Instead of dramatically killing the engine to 0.4 (which stalls them on walls),
            // we maintain at least 85% thrust so they can always overpower the -15G world gravity.
            targetWeight *= Math.max(0.85, 1.0 - (turnStress * penaltyStrength * 0.3));
        }

        // --- SURFACE TANGENT PLANE VELOCITY PROJECTION ---
        if (wasGrounded.current) {
            const normalComponent = newVel.dot(_surfaceNormal);
            newVel.sub(_surfaceNormal.clone().multiplyScalar(normalComponent));
            hasVelChange = true;
        }

        if (hasVelChange) {
            body.setLinvel(newVel, true);
        }

        // Strict Physical Turn Rate Constraint
        // INVIOLABLE: This is THE bottleneck. No state, no situation bypasses this.
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
                     crossAxis.set(0, 1, 0).applyAxisAngle(_targetDir, Math.random() * Math.PI);
                }
                _targetDir.applyAxisAngle(crossAxis, maxAngleToTurn);
            }
        }
        
        _targetDir.normalize();

        // Synchronize Nose Visualizer
        if (settings.showNoses && arrowRef.current) {
            arrowRef.current.position.set(pos.x, pos.y, pos.z);
            arrowRef.current.setDirection(_targetDir);
            
            const dynamicLength = settings.debugSize * (1.0 + speedRatio * 3.0);
            arrowRef.current.setLength(dynamicLength, settings.debugSize * 0.4, settings.debugSize * 0.3);
            arrowRef.current.visible = true;
        } else if (arrowRef.current) {
            arrowRef.current.visible = false;
        }

        // Synchronize Floating State Text
        if (settings.showStateLabels && textRef.current) {
             const stateLabels: Record<string, string> = {
                 'CRUISE': 'C', 'HUNT': 'H', 'EVADE': 'E'
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
            // Slider is Acceleration (m/s²). Force = Mass * Acceleration
            const motorImpulse = (settings.motorPower * 2.0 * targetWeight) * delta;
            body.applyImpulse({ x: _targetDir.x * motorImpulse, y: _targetDir.y * motorImpulse, z: _targetDir.z * motorImpulse }, true);
        }

        // --- POSITION SNAP: Keep boid riding AT the surface ---
        // CRITICAL BUG FIX: Never snap on the very first frame of landing (!wasGrounded.current)
        // because the origin search ray was cast straight down (gravity), not perpendicular to the slope!
        // On steep slopes, the vertical drop distance is much larger than the boid's radius, 
        // passing this into a snap function would artificially bury them inside the terrain mesh, destroying CCD.
        if (wasGrounded.current) {
            const idealHeight = 0.5;
            const heightError = groundToi - idealHeight;
            if (Math.abs(heightError) > 0.01) {
                body.setTranslation({
                    x: pos.x + searchRayDir.x * heightError,
                    y: pos.y + searchRayDir.y * heightError,
                    z: pos.z + searchRayDir.z * heightError
                }, true);
            }
        }
        
        // --- AERODYNAMIC DRAG (Replaces Hard Speed Cap) ---
        const currentSpeedSq = newVel.x * newVel.x + newVel.y * newVel.y + newVel.z * newVel.z;
        const finalSpeed = Math.sqrt(currentSpeedSq);
        
        if (currentSpeedSq > 0.1) {
            const motorForce = settings.motorPower * 2.0; // Max continuous force
            const kDrag = motorForce / (settings.maxSpeedCap * settings.maxSpeedCap);
            let dragImpulse = kDrag * currentSpeedSq * delta;
            
            const maxMomentum = finalSpeed * 2.0;
            if (dragImpulse > maxMomentum * 0.9) dragImpulse = maxMomentum * 0.9;
            
            body.applyImpulse({
                x: -(newVel.x / finalSpeed) * dragImpulse,
                y: -(newVel.y / finalSpeed) * dragImpulse,
                z: -(newVel.z / finalSpeed) * dragImpulse
            }, true);
        }

        // --- VELOCITY DIRECTION STEERING ---
        // Uniform rate for all states — the turn rate IS the physical limit.
        if (finalSpeed > 1.0) {
            const velDir = new THREE.Vector3(newVel.x, newVel.y, newVel.z).normalize();
            const angleVelToNose = velDir.angleTo(_targetDir);
            
            if (angleVelToNose > 0.05) {
                const maxVelSteer = maxAngleToTurn * 2.0;
                const steerAngle = Math.min(angleVelToNose, maxVelSteer);
                const steerAxis = new THREE.Vector3().crossVectors(velDir, _targetDir).normalize();
                
                if (steerAxis.lengthSq() > 0.001) {
                    velDir.applyAxisAngle(steerAxis, steerAngle);
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
        linearDamping={0.0} // Removed: This was artificially crushing top speed!
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
