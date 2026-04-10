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
const _dangerWorldPoint = new THREE.Vector3();

type BoidState = 'CRUISE' | 'HUNT' | 'EVADE';

export function Boid({ id, index }: { id: string, index: number }) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const arrowRef = useRef<THREE.ArrowHelper>(null);
  const textRef = useRef<any>(null); // For Drei Text component
  const radarGroupRef = useRef<THREE.Group>(null);
  const radialMeshRef = useRef<THREE.Mesh>(null);
  const coneMeshRef = useRef<THREE.Mesh>(null);
  const whiskersRef = useRef<THREE.LineSegments>(null);
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
  const prevSpeed = useRef(0);
  const wasGrounded = useRef(false);
  const hasLanded = useRef(false);       // True after the boid touches ground for the first time after spawn/respawn
  const groundGraceTimer = useRef(0);    // Grace period: keeps boid "grounded" for a few ms after losing raycast contact
  const isStalling = useRef(false);      // True while in stall recovery
  const stallRecoveryDir = useRef(new THREE.Vector3()); // Locked direction during stall recovery
  const stallCheckPos = useRef(new THREE.Vector3());    // Position at last displacement check
  const stallCheckTimer = useRef(0);     // Time since last displacement check
  const respawning = useRef(false);
  const [isHovered, setIsHovered] = useState(false);
  
  // Reactively bind variables that alter JSX (RigidBody)
  const baseFriction = useSimulationStore(state => state.baseFriction);
  const isSelected = useSimulationStore(state => state.selectedBoidId === id);

  // Deep Stateful Vectors (MUST be unique per agent)
  const targetDir = useRef(new THREE.Vector3(Math.random()-0.5, 0, Math.random()-0.5).normalize());
  const idealDir = useRef(new THREE.Vector3());
  const boidMass = useSimulationStore(state => state.boidMass);
  const trailBuffer = useRef<{x: number, y: number, z: number}[]>([]);
  const prevVel = useRef(new THREE.Vector3());
  const lifeTimer = useRef(0);

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
    const store = useSimulationStore.getState();
    const sp = store.spawnPoints[index];
    if (sp) return new THREE.Vector3(sp.x, sp.y, sp.z);
    // Fallback if no spawn point defined
    const scale = store.arenaScale;
    const ap = store.arenaPosition;
    return new THREE.Vector3(ap.x, ap.y + (10 + index * 2.0) * scale, ap.z);
  }, [index]);

  // Whisker Buffer Arrays (Allocated once per Boid)
  const whiskerPositions = useMemo(() => new Float32Array(12 * 2 * 3), []);
  const whiskerColors = useMemo(() => new Float32Array(12 * 2 * 3), []);

  useFrame((state, delta) => {
    if (!bodyRef.current) return;
    const body = bodyRef.current;
    
    const _targetDir = targetDir.current;
    const _idealDir = idealDir.current;

    // Respawner
    if (respawning.current) {
       const store = useSimulationStore.getState();
       const sp = store.spawnPoints[index];
       if (sp) {
         // Spawn at designated point with small random offset to avoid stacking
         const jitter = 1.0;
         body.setTranslation({
           x: sp.x + (Math.random() - 0.5) * jitter,
           y: sp.y,
           z: sp.z + (Math.random() - 0.5) * jitter
         }, true);
       } else {
         const scale = store.arenaScale;
         const ap = store.arenaPosition;
         body.setTranslation({ x: ap.x, y: ap.y + (10 + index * 2.0) * scale, z: ap.z }, true);
       }
       body.setLinvel({ x: 0, y: 0, z: 0 }, true);
       body.setAngvel({ x: 0, y: 0, z: 0 }, true);
       respawning.current = false;
       wasGrounded.current = false;
       hasLanded.current = false;        // Allow spawn boost to fire on next ground contact
       groundGraceTimer.current = 0;
       isStalling.current = false;
       prevNormal.current.set(0, 1, 0); // Reset so we don't compare against stale normal from death location
       heat.current = 0;
       fireCooldown.current = 0;
       prevSpeed.current = 0;
       evadeTimer.current = 0;
       jinkTimer.current = 0;
       evadeRetaliateId.current = null;
       trailBuffer.current = [];
       lifeTimer.current = 0;
       return;
    }

    const settings = useSimulationStore.getState();

    const pos = body.translation();
    const vel = body.linvel();
    
    const die = (isKill: boolean) => {
        if (!isKill) simMetrics.crashes++;
        simMetrics.deathMarkers.push({ 
            id: `${isKill?'kill':'crash'}-${Date.now()}-${id}`, 
            x: pos.x, y: pos.y, z: pos.z, 
            isKill,
            trail: isKill ? undefined : [...trailBuffer.current, {x: pos.x, y: pos.y, z: pos.z}]
        });
        respawning.current = true;
        simMetrics.boidHealths.set(id, settings.baseHealth);
        if (textRef.current) textRef.current.visible = false;
        if (arrowRef.current) arrowRef.current.visible = false;
        if (radarGroupRef.current) radarGroupRef.current.visible = false;
    };

    let currentHealth = simMetrics.boidHealths.get(id);
    if (currentHealth === undefined) {
        simMetrics.boidHealths.set(id, settings.baseHealth);
        currentHealth = settings.baseHealth;
    } else if (currentHealth <= 0 && !respawning.current) {
        // KILLED by projectile damage — NOT a crash!
        console.log(`[DEATH] Boid ${id}: KILLED by projectile damage (health=${currentHealth})`);
        die(true);
        return;
    }

    // Overheat System (Machine Gun)
    if (fireCooldown.current > 0) {
        fireCooldown.current -= delta;
        heat.current = Math.max(0, heat.current - (delta * 2.0)); // Cool down fast when locked
    } else {
        heat.current = Math.max(0, heat.current - (delta * 0.5)); // Natural slow cool down
    }

    // Terminal Velocity Cap: Prevent tunneling through thin floor meshes.
    // At 60fps, a sphere of radius 0.5m can travel ~30m/frame at -80 m/s.
    // Rapier's CCD should handle this, but we cap as a safety net.
    const terminalVelocity = -80;
    if (!wasGrounded.current && vel.y < terminalVelocity) {
        body.setLinvel({ x: vel.x, y: terminalVelocity, z: vel.z }, true);
        vel.y = terminalVelocity;
    }
    
    const rawVel = new THREE.Vector3(vel.x, vel.y, vel.z);
    
    // We evaluate speed *after* the raycast so we can strip out vertical bouncing noise
    let speed = rawVel.length();



    _rayOrigin.set(pos.x, pos.y, pos.z);
    
    // Sensor Track logic: Spheres don't have a specific "down", we use gravity or previous known ground normal!
    const gravityDir = new THREE.Vector3(0, -1, 0);
    
    // --- DUAL RAYCAST FIX (Concave Surface Stability) ---
    // On curved concave surfaces, the previous frame's normal can diverge enough that a single
    // ray in -prevNormal misses the surface entirely. We cast TWO rays and pick the best hit:
    //   1. Previous-normal-based ray (good for smooth slopes and walls)
    //   2. Gravity-based ray (failsafe that always finds the floor below)
    // This ensures the boid never loses ground contact on curves.
    let isGrounded = false;
    let groundToi = 0;
    _surfaceNormal.set(0, 1, 0);
    let bestHit: any = null;
    let bestRay: any = null;
    
    if (wasGrounded.current) {
        // Ray 1: Along previous surface normal (primary — tracks slopes accurately)
        const normalDir = prevNormal.current.clone().negate();
        const ray1 = new rapier.Ray(_rayOrigin, normalDir);
        const hit1 = world.castRay(ray1, 100, true, undefined, interactionGroups(0, [0]), undefined, body as any);
        let toi1 = Infinity;
        if (hit1 && hit1.collider && hit1.collider.parent() !== body) {
            const t = (hit1 as any).toi !== undefined ? (hit1 as any).toi : (hit1 as any).timeOfImpact;
            if (typeof t === 'number' && !isNaN(t)) toi1 = t;
        }
        
        // Ray 2: Straight down (failsafe — always finds floor on concave curves)
        const ray2 = new rapier.Ray(_rayOrigin, gravityDir);
        const hit2 = world.castRay(ray2, 100, true, undefined, interactionGroups(0, [0]), undefined, body as any);
        let toi2 = Infinity;
        if (hit2 && hit2.collider && hit2.collider.parent() !== body) {
            const t = (hit2 as any).toi !== undefined ? (hit2 as any).toi : (hit2 as any).timeOfImpact;
            if (typeof t === 'number' && !isNaN(t)) toi2 = t;
        }
        
        // Pick whichever ray found a closer surface
        if (toi1 <= toi2 && toi1 < Infinity) {
            bestHit = hit1; bestRay = ray1; groundToi = toi1;
        } else if (toi2 < Infinity) {
            bestHit = hit2; bestRay = ray2; groundToi = toi2;
        }
    } else {
        // Not grounded: single gravity ray
        const ray = new rapier.Ray(_rayOrigin, gravityDir);
        const hit = world.castRay(ray, 100, true, undefined, interactionGroups(0, [0]), undefined, body as any);
        if (hit && hit.collider && hit.collider.parent() !== body) {
            const t = (hit as any).toi !== undefined ? (hit as any).toi : (hit as any).timeOfImpact;
            if (typeof t === 'number' && !isNaN(t)) { bestHit = hit; bestRay = ray; groundToi = t; }
        }
    }
    
    // Evaluate grounding from the best hit
    // Radius of Ball is 0.5. Toi < 0.8 accounts for small bumps ensuring continuous grip
    if (bestHit && groundToi < 0.8) {
        isGrounded = true;
        const nHit = bestHit.collider.castRayAndGetNormal(bestRay, 100, true);
        if (nHit !== null) {
            const hitNx = nHit.normal.x, hitNy = nHit.normal.y, hitNz = nHit.normal.z;
            // Reject normals that are nearly horizontal (mesh edge artifacts).
            // A valid ground surface should have a significant upward component.
            // Y > 0.3 ≈ surface tilt < 72° from horizontal — anything steeper is a wall/edge face.
            if (hitNy > 0.3) {
                _surfaceNormal.set(hitNx, hitNy, hitNz).normalize();
            }
            // else: keep previous _surfaceNormal (initialized to (0,1,0) or from prevNormal)
        }
    }

    // --- EFFECTIVE GROUNDING (Raycast + Grace Timer) ---
    // The raw `isGrounded` can flicker false for 1-2 frames on curved meshes when the
    // raycast misses between face boundaries. `effectivelyGrounded` bridges these gaps:
    //  - If raycast hit: grounded, reset grace timer.
    //  - If raycast missed but was grounded recently: stay grounded for up to 150ms,
    //    using the smoothed prevNormal as the surface normal (no fresh hit).
    //  - If grace period expires: truly airborne.
    // ALL grounded logic (speed, velocity projection, motor, steering) uses this flag.
    let effectivelyGrounded = isGrounded;
    let hasValidGroundHit = isGrounded; // True only when we have a fresh raycast hit (for position snap)
    
    if (isGrounded) {
        groundGraceTimer.current = 0;
    } else if (wasGrounded.current) {
        // Raycast missed, but we were grounded recently — use grace period
        groundGraceTimer.current += delta;
        if (groundGraceTimer.current <= 0.15) {
            effectivelyGrounded = true;
            // Use the smoothed previous normal since we have no fresh raycast
            _surfaceNormal.copy(prevNormal.current);
        } else {
            // Grace expired — truly airborne
            wasGrounded.current = false;
            groundGraceTimer.current = 0;
        }
    }

    if (!effectivelyGrounded) {
        simMetrics.totalAirTime += delta;
    }

    // --- AIRBORNE TO GROUND CRASH DETECTION ---
    // Evaluated BEFORE we potentially set hasLanded.current = true for the initial spawn drop
    if (effectivelyGrounded && !wasGrounded.current && hasLanded.current && !respawning.current) {
        // Use prevVel to get the true falling speed right before impact resolution zeroed it out.
        if (Math.abs(prevVel.current.y) > settings.fallCrashTolerance) {
            console.log(`[DEATH] Boid ${id}: FALL CRASH (prevVel.y=${prevVel.current.y.toFixed(2)}, tolerance=${settings.fallCrashTolerance})`);
            die(false);
            return;
        }
    }

    // Apply ground-touching spawn boost ONLY on the very first landing after spawn/respawn.
    // CRITICAL: This must NOT fire on re-grounding after a brief hop on curved surfaces!
    if (isGrounded && !hasLanded.current && !respawning.current) {
        hasLanded.current = true;
        if (settings.initialSpeed > 0) {
            const randAngle = Math.random() * Math.PI * 2;
            let launchDir = new THREE.Vector3(Math.cos(randAngle), 0, Math.sin(randAngle));
            
            // Project random direction perfectly onto the tangent floor
            launchDir.sub(_surfaceNormal.clone().multiplyScalar(launchDir.dot(_surfaceNormal))).normalize();
            
            if (launchDir.lengthSq() > 0.1) {
                targetDir.current.copy(launchDir);
                idealDir.current.copy(launchDir);
                
                rawVel.set(
                    launchDir.x * settings.initialSpeed,
                    launchDir.y * settings.initialSpeed,
                    launchDir.z * settings.initialSpeed
                );
            }
        }
    }

    // --- CLEAN VELOCITY COMPUTATION ---
    // Speed = forward component of velocity along the boid's nose (_targetDir).
    // This reflects real forward progress: a boid stuck on a wall or sliding backwards
    // correctly shows ~0 or negative instead of a phantom positive magnitude.
    // Uses effectivelyGrounded so speed stays clean even during raycast grace periods.
    if (effectivelyGrounded) {
        const normalVelocity = rawVel.dot(_surfaceNormal);
        const cleanVel = rawVel.clone().sub(_surfaceNormal.clone().multiplyScalar(normalVelocity));
        speed = cleanVel.dot(_targetDir);
    }
    
    // Out of bounds / Fall Respawn (threshold scales with arena, offset by arena position)
    const fallThreshold = (settings.arenaPosition?.y ?? 0) - 30 * settings.arenaScale;
    if (pos.y < fallThreshold) {
        console.log(`[DEATH] Boid ${id}: FELL OFF MAP (pos.y=${pos.y.toFixed(2)}, threshold=${fallThreshold.toFixed(2)})`);
        die(false);
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

    const now = Date.now();
    const trailCopy = [...trailBuffer.current, {x: pos.x, y: pos.y, z: pos.z}];

    // Personal Max Speed Tracker
    const currentMaxSpeeds = simMetrics.boidMaxSpeeds.get(id) || [];
    let updatedSpeeds = false;
    
    // Find if there is a record within the 2.0s time window
    const recentMaxIndex = currentMaxSpeeds.findIndex(m => now - m.timestamp < 2000);
    
    if (recentMaxIndex !== -1) {
        // If inside an action window, overwrite ONLY if the new speed is better
        if (speed > currentMaxSpeeds[recentMaxIndex].speed) {
            currentMaxSpeeds[recentMaxIndex] = { speed, x: pos.x, y: pos.y, z: pos.z, timestamp: now, trail: trailCopy };
            currentMaxSpeeds.sort((a, b) => b.speed - a.speed);
            updatedSpeeds = true;
        }
    } else {
        // Outside action window
        if (currentMaxSpeeds.length < 3) {
            currentMaxSpeeds.push({ speed, x: pos.x, y: pos.y, z: pos.z, timestamp: now, trail: trailCopy });
            currentMaxSpeeds.sort((a, b) => b.speed - a.speed);
            updatedSpeeds = true;
        } else if (speed > currentMaxSpeeds[2].speed) {
            currentMaxSpeeds[2] = { speed, x: pos.x, y: pos.y, z: pos.z, timestamp: now, trail: trailCopy };
            currentMaxSpeeds.sort((a, b) => b.speed - a.speed);
            updatedSpeeds = true;
        }
    }

    if (updatedSpeeds) {
        simMetrics.boidMaxSpeeds.set(id, currentMaxSpeeds);
    }

    // Personal Min Speed Tracker (only active after 5 seconds of life)
    lifeTimer.current += delta;
    if (lifeTimer.current >= 5.0) {
        const currentMinSpeeds = simMetrics.boidMinSpeeds.get(id) || [];
        let updatedMins = false;
        
        const recentMinIndex = currentMinSpeeds.findIndex(m => now - m.timestamp < 2000);
        
        if (recentMinIndex !== -1) {
            if (speed < currentMinSpeeds[recentMinIndex].speed) {
                currentMinSpeeds[recentMinIndex] = { speed, x: pos.x, y: pos.y, z: pos.z, timestamp: now, trail: trailCopy };
                currentMinSpeeds.sort((a, b) => a.speed - b.speed);
                updatedMins = true;
            }
        } else {
            if (currentMinSpeeds.length < 3) {
                currentMinSpeeds.push({ speed, x: pos.x, y: pos.y, z: pos.z, timestamp: now, trail: trailCopy });
                currentMinSpeeds.sort((a, b) => a.speed - b.speed);
                updatedMins = true;
            } else if (speed < currentMinSpeeds[2].speed) {
                currentMinSpeeds[2] = { speed, x: pos.x, y: pos.y, z: pos.z, timestamp: now, trail: trailCopy };
                currentMinSpeeds.sort((a, b) => a.speed - b.speed);
                updatedMins = true;
            }
        }

        if (updatedMins) {
            simMetrics.boidMinSpeeds.set(id, currentMinSpeeds);
        }
    }

    if (effectivelyGrounded) {
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
              console.log(`[DEATH] Boid ${id}: GEOMETRIC CRASH (angleDiff=${angleDiff.toFixed(3)}, tolerance=${settings.crashTolerance}, speedRatio=${speedRatio.toFixed(2)})`);
              die(false);
              return;
          }
       }
       // --- SMOOTH NORMAL TRANSITION (Prevents Abrupt Direction Changes on Curves) ---
       // Instead of snapping prevNormal := surfaceNormal instantly, we slerp with a max angular
       // step per frame. This prevents the boid from violently jerking when crossing face 
       // boundaries on low-poly curved meshes. Max ~23° per frame keeps it butter-smooth.
       if (wasGrounded.current) {
           const maxNormalChangePerFrame = 0.4; // ~23 degrees max normal shift per frame
           const normalAngle = prevNormal.current.angleTo(_surfaceNormal);
           if (normalAngle > 0.001 && normalAngle <= maxNormalChangePerFrame) {
               prevNormal.current.copy(_surfaceNormal);
           } else if (normalAngle > maxNormalChangePerFrame) {
               // Slerp: rotate prevNormal toward surfaceNormal by at most maxNormalChangePerFrame
               const slerpT = maxNormalChangePerFrame / normalAngle;
               const q = new THREE.Quaternion().setFromUnitVectors(prevNormal.current, _surfaceNormal);
               const partialQ = new THREE.Quaternion().identity().slerp(q, slerpT);
               prevNormal.current.applyQuaternion(partialQ).normalize();
           }
       } else {
           // First frame landing — adopt the surface normal directly (no stale comparison)
           prevNormal.current.copy(_surfaceNormal);
       }
       wasGrounded.current = true;

       // --- Omnidirectional Edge Detection & Safe Direction Finding ---
       // Instead of casting a narrow forward fan and guessing left/right, we scan 360° around
       // the boid to build a complete map of where ground exists. When danger is detected,
       // the escape direction is the AVERAGE of all safe directions — this naturally handles
       // corners (safe = backward), edges (safe = away from edge), and narrow ridges.
        const maxTurnRateRad = settings.maxTurnRateDeg * (Math.PI / 180);
        const physicalTurnRadius = speed / Math.max(0.1, maxTurnRateRad); 
        // To complete an evasion, a boid needs its physical turn radius space.
        // The user-defined Scale multiplier and Min Base length define how the whiskers grow.
        // We multiply directly by the global Edge Caution slider, removing AI randomness.
        const lookAheadDist = (physicalTurnRadius * settings.whiskerScale + settings.whiskerBase) * settings.lookAheadDist;
        // Elevation must be high enough that scan rays on CONCAVE surfaces don't originate BELOW
        // the rising wall surface. At 0.25x, fast boids on bowls get false edge detections
        // because the wall climbs above the scan origin. 0.75x handles steep curvatures.
        const lidarElevation = Math.max(10.0, lookAheadDist * 0.75);
       
       // Cast 12 rays every 30° around the boid
       const numScanRays = 12;
       const scanStep = (2 * Math.PI) / numScanRays;
       let forwardMissCount = 0;     // Rays within ±60° of forward that miss
       let closestDangerAngle = Infinity;
       const safeDirAccum = new THREE.Vector3(0, 0, 0);
       let safeRayCount = 0;
       
       for (let s = 0; s < numScanRays; s++) {
           const angle = s * scanStep; // 0°, 30°, 60°, ... 330°
           
           const absAngle = angle <= Math.PI ? angle : (2 * Math.PI - angle);
           // Smooth weight: 1.0 at front (0°), ~0.3 at sides/rear — never vanishingly small
           const cosVal = Math.cos(absAngle);
           const angleFactor = 0.3 + 0.7 * Math.max(0.0, cosVal);
           const rayDistance = lookAheadDist * angleFactor;

           const scanDir = direction.clone().applyAxisAngle(_surfaceNormal, angle);
           _lidarOrigin.set(pos.x, pos.y, pos.z)
               .add(scanDir.clone().multiplyScalar(rayDistance))
               .add(_surfaceNormal.clone().multiplyScalar(lidarElevation));
           const scanRay = new rapier.Ray(_lidarOrigin, _surfaceNormal.clone().negate());
           // Cast distance must account for concave curvature: on bowls, the scan origin
           // (offset by rayDistance + lidarElevation) can be very far from the actual surface.
           const scanMaxDist = lidarElevation * 3.0 + rayDistance * 2.0;
           const castResult = world.castRayAndGetNormal(scanRay, scanMaxDist, true, undefined, interactionGroups(0, [0]), undefined, body as any);
           
           let scanHit = false;
           if (castResult && castResult.collider) {
               const hitNormal = new THREE.Vector3(castResult.normal.x, castResult.normal.y, castResult.normal.z);
               const normalDiff = hitNormal.angleTo(_surfaceNormal);
               const thresholdRad = settings.wallEvasionTolerance * (Math.PI / 180);
               if (normalDiff <= thresholdRad) {
                   scanHit = true;
               }
           }
           
           if (!scanHit) {
               // No ground in this direction
               if (absAngle < Math.PI / 3) { // Within ±60° of forward
                   forwardMissCount++;
                   if (absAngle < closestDangerAngle) {
                       closestDangerAngle = absAngle;
                       // Trace the ray to the hit point (wall) or max distance (edge)
                       const hitDist = castResult ? ((castResult as any).toi ?? castResult.timeOfImpact) : scanMaxDist;
                       const pt = scanRay.pointAt(hitDist);
                       _dangerWorldPoint.set(pt.x, pt.y, pt.z);
                   }
               }
            } else {
                // Ground exists in this direction - accumulate for safe direction finding
                safeDirAccum.add(scanDir);
                safeRayCount++;
            }
            
            // --- Fill Raycast Visualization Buffers (runs for ALL 12 rays) ---
            const pIndex = s * 6; // 2 vertices * 3 coords
            whiskerPositions[pIndex] = pos.x;
            whiskerPositions[pIndex + 1] = pos.y;
            whiskerPositions[pIndex + 2] = pos.z;
            
            // Endpoint: fan out horizontally along scanDir from the boid position
            whiskerPositions[pIndex + 3] = pos.x + scanDir.x * rayDistance;
            whiskerPositions[pIndex + 4] = pos.y + scanDir.y * rayDistance;
            whiskerPositions[pIndex + 5] = pos.z + scanDir.z * rayDistance;
            
            // Color: Only forward-cone rays (within ±60°) show red on danger.
            // Side/rear rays don't affect navigation, so show them as dim neutral.
            const isForwardCone = absAngle < Math.PI / 3;  // ±60°
            let rCol: number, gCol: number, bCol: number;
            if (isForwardCone) {
                rCol = scanHit ? 0.0 : 1.0;
                gCol = scanHit ? 1.0 : 0.0;
                bCol = 0.0;
            } else {
                // Side/rear: dim green if safe, dim gray if miss (not alarming red)
                rCol = scanHit ? 0.0 : 0.3;
                gCol = scanHit ? 0.6 : 0.3;
                bCol = scanHit ? 0.0 : 0.3;
            }
            whiskerColors[pIndex] = rCol; whiskerColors[pIndex + 1] = gCol; whiskerColors[pIndex + 2] = bCol;
            whiskerColors[pIndex + 3] = rCol; whiskerColors[pIndex + 4] = gCol; whiskerColors[pIndex + 5] = bCol;
        }
       
       // Compute projected gravity — used by energy management AND state handlers.
       const projectedGravity = gravityDir.clone().sub(
         _surfaceNormal.clone().multiplyScalar(gravityDir.dot(_surfaceNormal))
       );
       const hasSlope = projectedGravity.lengthSq() > 0.01;
       if (!hasSlope) projectedGravity.copy(_targetDir);

        // Require 2+ forward misses to trigger edge danger.
        // A single false positive is common on concave surfaces where rays overshoot the curvature.
        const edgeDanger = forwardMissCount > 1;
       if (edgeDanger) {
            // DANGER: Forward ground is missing. Steer toward the safest direction.
            aiState.current = 'EVADE';
            evadeTimer.current = Math.max(evadeTimer.current, 1.0);
            
            if (safeRayCount > 0) {
                // The average of all safe directions naturally points toward open ground.
                // In corners: rear rays are safe → average points backward.
                // At edges: side rays are safe → average points away from edge.
                safeDirAccum.normalize();
                // Project onto surface tangent plane
                safeDirAccum.sub(_surfaceNormal.clone().multiplyScalar(safeDirAccum.dot(_surfaceNormal)));
                if (safeDirAccum.lengthSq() > 0.001) {
                    evadeTargetDir.current.copy(safeDirAccum.normalize());
                }
            } else {
                // No safe direction found anywhere — emergency full U-turn
                evadeTargetDir.current.copy(direction).negate();
                evadeTargetDir.current.sub(_surfaceNormal.clone().multiplyScalar(
                    evadeTargetDir.current.dot(_surfaceNormal)
                ));
                if (evadeTargetDir.current.lengthSq() > 0.001) {
                    evadeTargetDir.current.normalize();
                }
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
                 
                 // riskTolerance scales CPA sensitivity: cautious pilots (low) dodge earlier at wider radius
                 const personalCpaRadius = settings.evasionCpaRadius * (1.6 - aiStats.riskTolerance); // 0.6x to 1.3x
                 if (cpaDist < personalCpaRadius && cpaDist < worstCpaDist) {
                     worstCpaDist = cpaDist;
                     worstCpaTime = tCPA;
                     threatOwnerId = bullet.ownerId;
                     // Store the bullet's approach direction for dodge perpendicular calculation
                     _threatApproach.copy(_bulletRelVel).normalize();
                 }
             });

             const personalCpaThreshold = settings.evasionCpaRadius * (1.6 - aiStats.riskTolerance);
             const bulletDanger = worstCpaDist < personalCpaThreshold;

             if (bulletDanger) {
                 // EVASION TRIGGER — Detected a bullet that will pass dangerously close
                 
                 if (aiState.current !== 'EVADE') {
                     // --- ENTER EVASION (fresh transition) ---
                     aiState.current = 'EVADE';
                     
                     // Set evasion timer: sustain maneuver for 0.8—1.5 seconds
                     evadeTimer.current = 0.8 + Math.random() * 0.7;
                     
                     // Use personality-consistent dodge direction instead of random coin flip
                     evadeSpinDir.current = aiStats.evasionDir;
                     
                     // Store threat approach for continuous jinking recalculation
                     evadeThreatDir.current.copy(_threatApproach);
                     
                     // Aggression scales retaliation probability (0 = never, 1 = always)
                     if (Math.random() < aiStats.aggression && threatOwnerId) {
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
                     if (evadeRetaliateId.current && (simMetrics.boidHealths.get(evadeRetaliateId.current) ?? 0) > 0 && speed >= settings.huntMinSpeed) {
                         // Aggressive retaliation: dodge complete, now HUNT the shooter (if fast enough)
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
                 
                 // Speed gate: MUST be going fast enough to stay in HUNT
                 if (speed < settings.huntMinSpeed) {
                     aiState.current = 'CRUISE';
                     vendettaTargetId.current = null;
                 } else if (Math.random() < disengageChance) {
                     aiState.current = 'CRUISE';
                     // Low persistence: also drop vendetta on disengage
                     if (aiStats.combatPersistence < 0.4) {
                         vendettaTargetId.current = null;
                     }
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

             // Aggression scales hunt engagement: aggressive boids attack at full radar range,
             // passive boids only engage when targets are very close (60% of radar range)
             const engagementScale = 0.6 + aiStats.aggression * 0.4; // 0.6x to 1.0x
             const personalRadarSq = (settings.radarRadius * engagementScale) * (settings.radarRadius * engagementScale);
             // Derive frontal length from radarRadius and proportion: low proportion = cone dominates
             const frontalLength = settings.radarRadius * (2.0 - settings.radarProportion * 1.8); // 2.0x at proportion=0, 0.2x at proportion=1
             const personalFrontalSq = (frontalLength * engagementScale) * (frontalLength * engagementScale);
             
             const targetInRadar = targetPos ? nearestDist < personalRadarSq : false;
              
             // Frontal Cone Radar: secondary detection area pointing exactly where we are looking
             let targetInFrontalCone = false;
             if (targetPos && !targetInRadar) {
                 if (nearestDist < personalFrontalSq) {
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
              
             // Speed gate: can only ENTER hunt if moving fast enough
             const canHunt = speed >= settings.huntMinSpeed;
             
             if ((targetInRadar || targetInFrontalCone) && aiState.current !== 'HUNT' && canHunt) {
                 wantsHunt = true;
             }

            if (targetPos !== null && wantsHunt) {
                aiState.current = 'HUNT';
                isDogfighting = true;
                
                // Target Leading (Predator AI)
                const targetVel = simMetrics.boidVelocities.get(nearestId) || {x: 0, y: 0, z: 0};
                const dist = Math.sqrt(nearestDist);
                const bulletSpeed = settings.projectileSpeed;
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
                
                // Map the UI slider + personality aggression to trigger discipline.
                // High aggression = wider cone (spray & pray), low = tighter (precision)
                const personalDiscipline = settings.huntConeCone * (1.1 - aiStats.aggression * 0.3); // aggressive loosens cone
                const triggerDiscipline = 0.75 + (personalDiscipline * 0.25);
                
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
                // CRUISE: Maintain current trajectory unless stalling.
                // --- STALL RECOVERY (DISPLACEMENT-BASED, NATURAL TURN) ---
                // Detection: measures NET positional displacement over 0.3s.
                // Response: sets _idealDir to downhill — the REAL turn rate constraint
                // handles rotation naturally. No snapping, no locked directions.
                const stallCheckInterval = 0.3;
                const stallDisplacementThreshold = 1.5; // units in 0.3s ≈ 5 m/s net
                const stallExitSpeed = 20.0;
                
                stallCheckTimer.current += delta;
                if (stallCheckTimer.current >= stallCheckInterval) {
                    const dx = pos.x - stallCheckPos.current.x;
                    const dy = pos.y - stallCheckPos.current.y;
                    const dz = pos.z - stallCheckPos.current.z;
                    const displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    
                    if (displacement < stallDisplacementThreshold) {
                        isStalling.current = true;
                    }
                    
                    stallCheckPos.current.set(pos.x, pos.y, pos.z);
                    stallCheckTimer.current = 0;
                }
                
                if (isStalling.current && speed > stallExitSpeed) {
                    isStalling.current = false;
                }
                
                if (isStalling.current) {
                    // Set INTENTION to downhill — turn rate handles the actual rotation
                    if (hasSlope) {
                        _idealDir.copy(projectedGravity).normalize();
                    } else {
                        _idealDir.copy(_targetDir); // flat: keep going, motor accelerates
                    }
                } else {
                    _idealDir.copy(_targetDir);
                }
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
        // Strip ALL normal velocity (both inward and outward) to keep the boid sliding
        // on the tangent plane. The 15G gravity + position snap handle surface adhesion.
        const normalComponent = newVel.dot(_surfaceNormal);
        newVel.sub(_surfaceNormal.clone().multiplyScalar(normalComponent));
        hasVelChange = true;

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

        // --- WHISKERS VISUALIZER ---
        if (whiskersRef.current) {
            if (settings.showRadars) {
                whiskersRef.current.visible = true;
                
                if (!whiskersRef.current.geometry.hasAttribute('position')) {
                    whiskersRef.current.geometry.setAttribute('position', new THREE.BufferAttribute(whiskerPositions, 3));
                    whiskersRef.current.geometry.setAttribute('color', new THREE.BufferAttribute(whiskerColors, 3));
                } else {
                    const posAttr = whiskersRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
                    posAttr.set(whiskerPositions);
                    posAttr.needsUpdate = true;
                    
                    const colAttr = whiskersRef.current.geometry.getAttribute('color') as THREE.BufferAttribute;
                    colAttr.set(whiskerColors);
                    colAttr.needsUpdate = true;
                }
            } else {
                whiskersRef.current.visible = false;
            }
        }

        // --- RADARS VISUALIZER ---
        if (settings.showRadars && radarGroupRef.current && radialMeshRef.current && coneMeshRef.current) {
            radarGroupRef.current.position.set(pos.x, pos.y, pos.z);
            
            // Point the group in the boid's forward direction
            const lookAtTarget = new THREE.Vector3(pos.x + _targetDir.x, pos.y + _targetDir.y, pos.z + _targetDir.z);
            radarGroupRef.current.lookAt(lookAtTarget);
            radarGroupRef.current.visible = true;

            // Radial radar disk scale — proportional to radarRadius, weighted by proportion
            const radialScale = settings.radarRadius * (0.2 + settings.radarProportion * 1.8); // small at proportion=0, full at proportion=1
            radialMeshRef.current.scale.set(radialScale, radialScale, 1);
            
            // Frontal Cone — derived from proportion (inverse of radial)
            const frontalLength = settings.radarRadius * (2.0 - settings.radarProportion * 1.8);
            const angle = Math.acos(settings.radarFrontalAngle);
            const radiusAtBase = Math.tan(angle) * frontalLength;
            
            coneMeshRef.current.scale.set(radiusAtBase, frontalLength, radiusAtBase);
            coneMeshRef.current.position.set(0, 0, frontalLength / 2);
            
        } else if (radarGroupRef.current) {
            radarGroupRef.current.visible = false;
        }


        // --- APPLY LINEAR MOTOR ---
        if (targetWeight > 0.1 && !isNaN(_targetDir.x)) {
            // Slider is Acceleration (m/s²). Force = Mass * Acceleration
            const motorImpulse = (settings.motorPower * 2.0 * targetWeight) * delta;
            body.applyImpulse({ x: _targetDir.x * motorImpulse, y: _targetDir.y * motorImpulse, z: _targetDir.z * motorImpulse }, true);
        }

        // --- POSITION SNAP: Keep boid riding AT the surface ---
        // Only snap when we have a FRESH raycast hit (not during grace period where groundToi is stale).
        // Use the actual surface normal for snapping direction.
        if (hasValidGroundHit && wasGrounded.current) {
            const idealHeight = 0.5;
            const heightError = groundToi - idealHeight;
            if (Math.abs(heightError) > 0.01) {
                const snapDir = _surfaceNormal.clone().negate();
                body.setTranslation({
                    x: pos.x + snapDir.x * heightError,
                    y: pos.y + snapDir.y * heightError,
                    z: pos.z + snapDir.z * heightError
                }, true);
            }
        }
        
        // --- AERODYNAMIC DRAG (Replaces Hard Speed Cap) ---
        // CRITICAL: Read the ACTUAL body velocity AFTER the motor impulse has been applied.
        // Previously this used stale `newVel` (pre-motor), causing setLinvel to ERASE the motor.
        const postMotorVel = body.linvel();
        const currentSpeedSq = postMotorVel.x * postMotorVel.x + postMotorVel.y * postMotorVel.y + postMotorVel.z * postMotorVel.z;
        const finalSpeed = Math.sqrt(currentSpeedSq);
        
        if (currentSpeedSq > 0.1) {
            const motorForce = settings.motorPower * 2.0; // Max continuous force
            const kDrag = motorForce / (settings.maxSpeedCap * settings.maxSpeedCap);
            let dragImpulse = kDrag * currentSpeedSq * delta;
            
            const maxMomentum = finalSpeed * 2.0;
            if (dragImpulse > maxMomentum * 0.9) dragImpulse = maxMomentum * 0.9;
            
            body.applyImpulse({
                x: -(postMotorVel.x / finalSpeed) * dragImpulse,
                y: -(postMotorVel.y / finalSpeed) * dragImpulse,
                z: -(postMotorVel.z / finalSpeed) * dragImpulse
            }, true);
        }

        // --- VELOCITY DIRECTION STEERING ---
        // CRITICAL: Re-read body velocity AFTER motor + drag to get the true current state.
        // Use the SMOOTHED prevNormal for velocity projection to prevent jerky direction changes
        // when the raw surface normal jumps between mesh faces on curved surfaces.
        const smoothNormal = prevNormal.current;
        const steerVel = body.linvel();
        const steerSpeed = Math.sqrt(steerVel.x * steerVel.x + steerVel.y * steerVel.y + steerVel.z * steerVel.z);
        if (steerSpeed > 1.0) {
            const velDir = new THREE.Vector3(steerVel.x, steerVel.y, steerVel.z).normalize();
            const angleVelToNose = velDir.angleTo(_targetDir);
            
            if (angleVelToNose > 0.05) {
                const maxVelSteer = maxAngleToTurn * 2.0;
                const steerAngle = Math.min(angleVelToNose, maxVelSteer);
                const steerAxis = new THREE.Vector3().crossVectors(velDir, _targetDir).normalize();
                
                if (steerAxis.lengthSq() > 0.001) {
                    velDir.applyAxisAngle(steerAxis, steerAngle);
                    velDir.sub(smoothNormal.clone().multiplyScalar(velDir.dot(smoothNormal))).normalize();
                    
                    body.setLinvel({
                        x: velDir.x * steerSpeed,
                        y: velDir.y * steerSpeed,
                        z: velDir.z * steerSpeed
                    }, true);
                }
            }
        }
     } else {
        // Not effectively grounded — truly airborne (grace timer already handled above)
        wasGrounded.current = false;
        
        // --- AIRBORNE AERODYNAMIC DRAG ---
        // Only drag the HORIZONTAL component so gravity acts freely on Y.
        // Mass-aware: heavier boids resist drag more (F=ma, same drag force, higher mass = less deceleration).
        const airVel = body.linvel();
        const horizSpeedSq = airVel.x * airVel.x + airVel.z * airVel.z;
        if (horizSpeedSq > 1.0) {
            const horizSpeed = Math.sqrt(horizSpeedSq);
            const currentMass = boidMass || 2.0;
            // Drag coefficient inversely proportional to mass: light boids slow faster
            const airDragCoeff = 0.3 / currentMass;
            const airDragImpulse = Math.min(airDragCoeff * horizSpeed * delta, horizSpeed * 0.2);
            body.applyImpulse({
                x: -(airVel.x / horizSpeed) * airDragImpulse,
                y: 0, // Pure gravitational free-fall — no drag on Y
                z: -(airVel.z / horizSpeed) * airDragImpulse
            }, true);
        }
     }

     // --- FLIGHT RECORDER (TRAIL BUFFER) ---
     const lastPt = trailBuffer.current[trailBuffer.current.length - 1];
     if (!lastPt || Math.hypot(lastPt.x - pos.x, lastPt.y - pos.y, lastPt.z - pos.z) > 1.0) {
         trailBuffer.current.push({ x: pos.x, y: pos.y, z: pos.z });
         if (effectivelyGrounded && trailBuffer.current.length > 15) {
             trailBuffer.current.shift();
         }
     }
     
     prevVel.current.copy(rawVel);
   });

  return (
    <group>
      <RigidBody
        ref={bodyRef}
        name={`boid-${id}`}
        position={[initialPosition.x, initialPosition.y, initialPosition.z]}
        mass={boidMass || 2.0}
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
      
      {/* Radar Visualizers (outside RigidBody to freely set rotation/scale without physics side effects) */}
      <group ref={radarGroupRef} visible={false}>
          {/* Radial Radar - XZ plane */}
          <mesh ref={radialMeshRef} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[1, 32]} />
              <meshBasicMaterial color="#10b981" transparent opacity={0.1} side={THREE.DoubleSide} />
          </mesh>
          
          {/* Frontal Radar Cone.
              We rotate it by Math.PI / 2 on X, so its tip points along +Z. 
              Position is adjusted dynamically in useFrame so its base is at origin. 
          */}
          <mesh ref={coneMeshRef} rotation={[-Math.PI / 2, 0, 0]}>
              <coneGeometry args={[1, 1, 16]} />
              <meshBasicMaterial color="#10b981" transparent opacity={0.15} wireframe />
          </mesh>
      </group>
      
      {/* Topographical Whisker Beams Visualizer */}
      <lineSegments ref={whiskersRef} visible={false}>
         <bufferGeometry />
         <lineBasicMaterial vertexColors={true} linewidth={2} transparent opacity={0.6} />
      </lineSegments>

      {/* Target Arrow and Name Tags (outside RigidBody) */} 
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
