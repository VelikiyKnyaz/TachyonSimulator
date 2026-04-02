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
  boidPersonalities: Map<string, { aggression: number, combatPersistence: number, riskTolerance: number }>;
  projectileData: Map<string, {pos: {x:number, y:number, z:number}, vel: {x:number, y:number, z:number}, ownerId: string}>;
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
  boidPersonalities: new Map(),
  projectileData: new Map(),
};

interface SimulationStore {
  boids: string[]; // List of unique Boid IDs
  projectiles: {id: string, pos: {x:number, y:number, z:number}, dir: {x:number, y:number, z:number}, speed: number, ownerId: string, shooterSpeed: number}[];
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
  turnPenaltyMinSpeed: number;
  turnPenaltyMaxSpeed: number;
  
  // --- New Advanced Parameters ---
  showNoses: boolean;
  showStateLabels: boolean;
  showDeathMarkers: boolean;
  showKillMarkers: boolean;
  showSpeedRecords: boolean;
  debugSize: number;
  motorPower: number;
  maxTurnRateDeg: number;
  
  baseHealth: number;
  huntConeCone: number;
  fireRateDelay: number;
  overheatCooldown: number;
  projectileSpeed: number;
  evasionCpaRadius: number;
  
  radarRadius: number;
  radarFrontalLength: number;
  radarFrontalAngle: number;
  initialSpeed: number;
  
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
  setTurnPenaltyMinSpeed: (v: number) => void;
  setTurnPenaltyMaxSpeed: (v: number) => void;

  setDebugSize: (v: number) => void;
  setMotorPower: (v: number) => void;
  setMaxTurnRateDeg: (v: number) => void;
  
  setBaseHealth: (v: number) => void;
  setHuntConeCone: (v: number) => void;
  setFireRateDelay: (v: number) => void;
  setOverheatCooldown: (v: number) => void;
  setProjectileSpeed: (v: number) => void;
  setEvasionCpaRadius: (v: number) => void;
  
  setRadarRadius: (v: number) => void;
  setRadarFrontalLength: (v: number) => void;
  setRadarFrontalAngle: (v: number) => void;
  setInitialSpeed: (v: number) => void;
  
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
  maxSpeedCap: 500.0,
  turnPenalty: 0.5,
  evasionTurnAngle: 0.5,
  lookAheadDist: 1.0,
  centripetalGrip: 1.0,
  baseFriction: 2.0,
  turnPenaltyMinSpeed: 20.0,
  turnPenaltyMaxSpeed: 70.0,

  showNoses: false,
  showStateLabels: true,
  showDeathMarkers: true,
  showKillMarkers: true,
  showSpeedRecords: false,
  debugSize: 3.0,
  motorPower: 12.0,
  maxTurnRateDeg: 120.0,
  
  baseHealth: 500.0,
  huntConeCone: 0.5,
  fireRateDelay: 0.1,
  overheatCooldown: 5.0,
  projectileSpeed: 120.0,
  evasionCpaRadius: 5.0,
  
  radarRadius: 100.0,
  radarFrontalLength: 250.0,
  radarFrontalAngle: 0.5,
  initialSpeed: 50.0,

  setAgentCount: (count) => set({ agentCount: count }),
  setArenaScale: (scale) => set({ arenaScale: scale }),
  setCrashTolerance: (tolerance) => set({ crashTolerance: tolerance }),
  
  setMaxSpeedCap: (v) => set({ maxSpeedCap: v }),
  setTurnPenalty: (v) => set({ turnPenalty: v }),
  setEvasionTurnAngle: (v) => set({ evasionTurnAngle: v }),
  setLookAheadDist: (v: number) => set({ lookAheadDist: v }),
  setCentripetalGrip: (v: number) => set({ centripetalGrip: v }),
  setBaseFriction: (v: number) => set({ baseFriction: v }),
  setTurnPenaltyMinSpeed: (v: number) => set({ turnPenaltyMinSpeed: v }),
  setTurnPenaltyMaxSpeed: (v: number) => set({ turnPenaltyMaxSpeed: v }),

  setDebugSize: (v) => set({ debugSize: v }),
  setMotorPower: (v) => set({ motorPower: v }),
  setMaxTurnRateDeg: (v) => set({ maxTurnRateDeg: v }),
  
  setBaseHealth: (v) => set({ baseHealth: v }),
  setHuntConeCone: (v) => set({ huntConeCone: v }),
  setFireRateDelay: (v) => set({ fireRateDelay: v }),
  setOverheatCooldown: (v) => set({ overheatCooldown: v }),
  setProjectileSpeed: (v) => set({ projectileSpeed: v }),
  setEvasionCpaRadius: (v) => set({ evasionCpaRadius: v }),
  
  setRadarRadius: (v) => set({ radarRadius: v }),
  setRadarFrontalLength: (v) => set({ radarFrontalLength: v }),
  setRadarFrontalAngle: (v) => set({ radarFrontalAngle: v }),
  setInitialSpeed: (v) => set({ initialSpeed: v }),
  
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
