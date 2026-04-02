import { create } from 'zustand';

interface SimulationMetrics {
  activeBoids: number;
  crashes: number;
  boidSpeeds: Map<string, number>;
  boidVelocities: Map<string, {x: number, y: number, z: number}>;
  boidPositions: Map<string, {x: number, y: number, z: number}>;
  boidStates: Map<string, string>;
  boidHealths: Map<string, number>;
  deathMarkers: {id: string | number, x: number, y: number, z: number, isKill: boolean}[];
  boidMaxSpeeds: Map<string, {speed: number, x: number, y: number, z: number}>;
  kills: Record<string, number>;
  deaths: Record<string, number>;
  shotsFired: number;
  hits: number;
  maxSpeed: number;
  boidPersonalities: Map<string, { aggression: number, energyStyle: number, riskTolerance: number, diveFraction: number, climbFraction: number }>;
}

// Reactive object for high-frequency metrics to prevent component re-renders
export const simMetrics: SimulationMetrics = {
  activeBoids: 0,
  crashes: 0,
  boidSpeeds: new Map(),
  boidVelocities: new Map(),
  boidPositions: new Map(),
  boidStates: new Map(),
  boidHealths: new Map(),
  deathMarkers: [],
  boidMaxSpeeds: new Map(),
  kills: {},
  deaths: {},
  shotsFired: 0,
  hits: 0,
  maxSpeed: 0,
  boidPersonalities: new Map()
};

interface SimulationStore {
  boids: string[]; // List of unique Boid IDs
  projectiles: {id: string, pos: {x:number, y:number, z:number}, dir: {x:number, y:number, z:number}, speed: number, ownerId: string}[];
  isRunning: boolean;
  agentCount: number;
  showCurvature: boolean;
  arenaScale: number;
  crashTolerance: number;
  maxSpeedCap: number;
  turnPenalty: number;
  evasionTurnAngle: number;
  lookAheadDist: number;
  centripetalGrip: number;
  baseFriction: number;
  
  // --- New Advanced Parameters ---
  showNoses: boolean;
  showStateLabels: boolean;
  showDeathMarkers: boolean;
  showKillMarkers: boolean;
  showSpeedRecords: boolean;
  debugSize: number;
  motorPower: number;
  maxTurnRateDeg: number;
  dogfightCone: number;     // Vision cone dot product for dogfight initiation (0=180°, 1=0°)
  bnzChance: number;        // Multiplier for BnZ entry rate
  
  baseHealth: number;
  huntConeCone: number;
  fireRateDelay: number;
  overheatCooldown: number;
  projectileSpeed: number;
  
  setAgentCount: (count: number) => void;
  setArenaScale: (scale: number) => void;
  setCrashTolerance: (tolerance: number) => void;
  
  // Parameter Setters
  setMaxSpeedCap: (v: number) => void;
  setTurnPenalty: (v: number) => void;
  setEvasionTurnAngle: (v: number) => void;
  setLookAheadDist: (v: number) => void;
  setCentripetalGrip: (v: number) => void;
  setBaseFriction: (v: number) => void;

  setDebugSize: (v: number) => void;
  setMotorPower: (v: number) => void;
  setMaxTurnRateDeg: (v: number) => void;
  setDogfightCone: (v: number) => void;
  setBnzChance: (v: number) => void;
  
  setBaseHealth: (v: number) => void;
  setHuntConeCone: (v: number) => void;
  setFireRateDelay: (v: number) => void;
  setOverheatCooldown: (v: number) => void;
  setProjectileSpeed: (v: number) => void;
  
  startSimulation: () => void;
  resetSimulation: () => void;
  toggleCurvature: () => void;
  toggleNoses: () => void;
  toggleStateLabels: () => void;
  toggleDeathMarkers: () => void;
  toggleKillMarkers: () => void;
  toggleSpeedRecords: () => void;
  spawnProjectile: (proj: any) => void;
  removeProjectile: (id: string) => void;
  selectedBoidId: string | null;
  setSelectedBoid: (id: string | null) => void;
}

export const useSimulationStore = create<SimulationStore>((set) => ({
  boids: [],
  projectiles: [],
  isRunning: false,
  agentCount: 10,
  showCurvature: false,
  arenaScale: 1.0,
  crashTolerance: 0.45,
  
  // Default values copied from user preferences
  maxSpeedCap: 35.0,
  turnPenalty: 0.2,
  evasionTurnAngle: 0.5,
  lookAheadDist: 1.0,
  centripetalGrip: 1.0,
  baseFriction: 2.0,

  showNoses: false,
  showStateLabels: true,
  showDeathMarkers: true,
  showKillMarkers: true,
  showSpeedRecords: false,
  debugSize: 3.0,
  motorPower: 600.0,
  maxTurnRateDeg: 120.0,
  dogfightCone: 0.3,       // ~72° forward cone
  bnzChance: 3.0,          // BnZ entry rate multiplier
  
  baseHealth: 100.0,
  huntConeCone: 0.5,
  fireRateDelay: 0.1,
  overheatCooldown: 5.0,
  projectileSpeed: 120.0,

  setAgentCount: (count) => set({ agentCount: count }),
  setArenaScale: (scale) => set({ arenaScale: scale }),
  setCrashTolerance: (tolerance) => set({ crashTolerance: tolerance }),
  
  setMaxSpeedCap: (v) => set({ maxSpeedCap: v }),
  setTurnPenalty: (v) => set({ turnPenalty: v }),
  setEvasionTurnAngle: (v) => set({ evasionTurnAngle: v }),
  setLookAheadDist: (v) => set({ lookAheadDist: v }),
  setCentripetalGrip: (v) => set({ centripetalGrip: v }),
  setBaseFriction: (v) => set({ baseFriction: v }),

  setDebugSize: (v) => set({ debugSize: v }),
  setMotorPower: (v) => set({ motorPower: v }),
  setMaxTurnRateDeg: (v) => set({ maxTurnRateDeg: v }),
  setDogfightCone: (v) => set({ dogfightCone: v }),
  setBnzChance: (v) => set({ bnzChance: v }),
  
  setBaseHealth: (v) => set({ baseHealth: v }),
  setHuntConeCone: (v) => set({ huntConeCone: v }),
  setFireRateDelay: (v) => set({ fireRateDelay: v }),
  setOverheatCooldown: (v) => set({ overheatCooldown: v }),
  setProjectileSpeed: (v) => set({ projectileSpeed: v }),
  
  toggleCurvature: () => set((state) => ({ showCurvature: !state.showCurvature })),
  toggleNoses: () => set((state) => ({ showNoses: !state.showNoses })),
  toggleStateLabels: () => set((state) => ({ showStateLabels: !state.showStateLabels })),
  toggleDeathMarkers: () => set((state) => ({ showDeathMarkers: !state.showDeathMarkers })),
  toggleKillMarkers: () => set((state) => ({ showKillMarkers: !state.showKillMarkers })),
  toggleSpeedRecords: () => set((state) => ({ showSpeedRecords: !state.showSpeedRecords })),
  
  spawnProjectile: (proj) => set((state) => ({ projectiles: [...state.projectiles, proj] })),
  removeProjectile: (id) => set((state) => ({ projectiles: state.projectiles.filter(p => p.id !== id) })),
  selectedBoidId: null,
  setSelectedBoid: (id) => set({ selectedBoidId: id }),

  startSimulation: () => {
    simMetrics.activeBoids = 0;
    simMetrics.crashes = 0;
    simMetrics.boidSpeeds.clear();
    simMetrics.boidVelocities.clear();
    simMetrics.boidPositions.clear();
    simMetrics.boidStates.clear();
    simMetrics.boidHealths.clear();
    simMetrics.boidMaxSpeeds.clear();
    simMetrics.deathMarkers = [];
    simMetrics.kills = {};
    simMetrics.deaths = {};
    simMetrics.shotsFired = 0;
    simMetrics.hits = 0;
    simMetrics.maxSpeed = 0;
    
    set((state) => {
      const boids = Array.from({ length: state.agentCount }).map((_, i) => `boid-${Date.now()}-${i}`);
      simMetrics.activeBoids = boids.length;
      return { isRunning: true, boids, projectiles: [] };
    });
  },
  
  resetSimulation: () => {
    set({ isRunning: false, boids: [], projectiles: [], selectedBoidId: null });
    simMetrics.activeBoids = 0;
    simMetrics.crashes = 0;
    simMetrics.boidSpeeds.clear();
    simMetrics.boidVelocities.clear();
    simMetrics.boidPositions.clear();
    simMetrics.boidStates.clear();
    simMetrics.boidHealths.clear();
    simMetrics.boidMaxSpeeds.clear();
    simMetrics.deathMarkers = [];
    simMetrics.shotsFired = 0;
    simMetrics.hits = 0;
    simMetrics.maxSpeed = 0;
    simMetrics.boidPersonalities.clear();
  }
}));
