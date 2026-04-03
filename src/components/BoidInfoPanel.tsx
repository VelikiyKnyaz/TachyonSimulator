import { useEffect, useState } from 'react';
import { useSimulationStore, simMetrics } from '../store';

const BAR_COLORS: Record<string, [string, string]> = {
  aggression: ['#22c55e', '#ef4444'],         // Green to Red
  bnzIntensity: ['#60a5fa', '#f59e0b'],       // Blue to Amber
  combatPersistence: ['#a78bfa', '#ec4899'],   // Violet to Pink
  riskTolerance: ['#f472b6', '#a855f7'],       // Pink to Purple
};

function PersonalityBar({ label, value, colorRange, description }: { label: string, value: number, colorRange: [string, string], description: string }) {
  const pct = Math.round(value * 100);
  const r1 = parseInt(colorRange[0].slice(1, 3), 16), g1 = parseInt(colorRange[0].slice(3, 5), 16), b1 = parseInt(colorRange[0].slice(5, 7), 16);
  const r2 = parseInt(colorRange[1].slice(1, 3), 16), g2 = parseInt(colorRange[1].slice(3, 5), 16), b2 = parseInt(colorRange[1].slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * value), g = Math.round(g1 + (g2 - g1) * value), b = Math.round(b1 + (b2 - b1) * value);
  const barColor = `rgb(${r}, ${g}, ${b})`;
  
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
        <span style={{ fontSize: '0.75rem', color: '#e2e8f0', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: '0.7rem', color: barColor, fontWeight: 700 }}>{pct}%</span>
      </div>
      <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: '3px',
          background: `linear-gradient(90deg, ${colorRange[0]}, ${barColor})`,
          transition: 'width 0.3s ease',
          boxShadow: `0 0 8px ${barColor}44`
        }} />
      </div>
      <div style={{ fontSize: '0.6rem', color: '#94a3b8', marginTop: '2px' }}>{description}</div>
    </div>
  );
}

function getArchetype(aggression: number, bnzIntensity: number, combatPersistence: number): { name: string, emoji: string, desc: string } {
  // Archetypes based on the three personality axes
  if (aggression > 0.7 && bnzIntensity > 0.6) return { name: 'Ace Predator', emoji: '🦅', desc: 'Extreme BnZ + aggressive — climbs high, dives to kill' };
  if (aggression > 0.7 && combatPersistence > 0.7) return { name: 'Pitbull', emoji: '🐕', desc: 'Relentless dogfighter, never breaks off a chase' };
  if (aggression > 0.6 && combatPersistence < 0.3) return { name: 'Sniper', emoji: '🎯', desc: 'Fires opportunistically, preserves own energy' };
  if (bnzIntensity > 0.7 && aggression <= 0.3) return { name: 'Roller Coaster', emoji: '🎢', desc: 'Lives for the energy extremes, avoids combat' };
  if (aggression <= 0.3 && bnzIntensity <= 0.3) return { name: 'Ghost', emoji: '👻', desc: 'Conservative cruiser, hard to notice' };
  if (bnzIntensity > 0.6) return { name: 'Daredevil', emoji: '🏎️', desc: 'Deep BnZ dives for maximum speed rushes' };
  if (aggression > 0.5 && combatPersistence > 0.5) return { name: 'Dogfighter', emoji: '⚔️', desc: 'Balanced combat persistence and aggression' };
  if (combatPersistence > 0.7) return { name: 'Tracker', emoji: '🔍', desc: 'Persistent pursuer, won\'t give up once locked on' };
  return { name: 'Balanced', emoji: '⚡', desc: 'Adaptable all-rounder' };
}

export function BoidInfoPanel() {
  const selectedBoidId = useSimulationStore(state => state.selectedBoidId);
  const setSelectedBoid = useSimulationStore(state => state.setSelectedBoid);
  const [liveData, setLiveData] = useState({ speed: 0, state: 'CRUISE', health: 100, kills: 0, deaths: 0 });
  
  useEffect(() => {
    if (!selectedBoidId) return;
    const interval = setInterval(() => {
      const speed = simMetrics.boidSpeeds.get(selectedBoidId) || 0;
      const state = simMetrics.boidStates.get(selectedBoidId) || 'CRUISE';
      const health = simMetrics.boidHealths.get(selectedBoidId) || 0;
      const kills = simMetrics.kills[selectedBoidId] || 0;
      const deaths = simMetrics.deaths[selectedBoidId] || 0;
      setLiveData({ speed, state, health, kills, deaths });
    }, 100);
    return () => clearInterval(interval);
  }, [selectedBoidId]);

  if (!selectedBoidId) return null;

  const personality = simMetrics.boidPersonalities.get(selectedBoidId);
  if (!personality) return null;

  const archetype = getArchetype(personality.aggression, personality.combatPersistence, personality.riskTolerance);

  const stateColors: Record<string, string> = {
    'CRUISE': '#60a5fa',
    'HUNT': '#ef4444',
    'EVADE': '#22c55e',
  };

  const stateLabels: Record<string, string> = {
    'CRUISE': 'CRUISE',
    'HUNT': 'HUNT',
    'EVADE': 'EVADE',
  };

  const healthPct = (liveData.health / useSimulationStore.getState().baseHealth) * 100;
  const healthColor = healthPct > 60 ? '#22c55e' : healthPct > 30 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{
      position: 'absolute',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '340px',
      background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.92))',
      backdropFilter: 'blur(20px)',
      border: '1px solid rgba(148, 163, 184, 0.15)',
      borderRadius: '16px',
      padding: '16px',
      zIndex: 100,
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 30px rgba(99, 102, 241, 0.1)',
      fontFamily: "'Inter', -apple-system, sans-serif",
      color: '#e2e8f0'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
            Selected Agent
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
            <span style={{ fontSize: '1.3rem' }}>{archetype.emoji}</span>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f1f5f9' }}>{archetype.name}</div>
              <div style={{ fontSize: '0.6rem', color: '#94a3b8' }}>{archetype.desc}</div>
            </div>
          </div>
        </div>
        <button
          onClick={() => setSelectedBoid(null)}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#94a3b8',
            borderRadius: '8px',
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: '0.7rem',
            fontWeight: 600,
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'; e.currentTarget.style.color = '#ef4444'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#94a3b8'; }}
        >
          ✕ DESELECT
        </button>
      </div>

      {/* Live Status Bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr 1fr',
        gap: '6px',
        marginBottom: '14px',
        padding: '8px',
        background: 'rgba(0,0,0,0.3)',
        borderRadius: '10px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase' }}>State</div>
          <div style={{
            fontSize: '0.7rem',
            fontWeight: 800,
            color: stateColors[liveData.state] || '#60a5fa',
            textShadow: `0 0 6px ${stateColors[liveData.state] || '#60a5fa'}44`
          }}>{stateLabels[liveData.state] || liveData.state}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase' }}>Speed</div>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f1f5f9' }}>{liveData.speed.toFixed(1)}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase' }}>Kills</div>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ef4444' }}>{liveData.kills}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase' }}>Deaths</div>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f59e0b' }}>{liveData.deaths}</div>
        </div>
      </div>

      {/* Health Bar */}
      <div style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
          <span style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase' }}>Health</span>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: healthColor }}>{Math.round(liveData.health)}/{useSimulationStore.getState().baseHealth}</span>
        </div>
        <div style={{ height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
          <div style={{
            width: `${healthPct}%`,
            height: '100%',
            borderRadius: '2px',
            background: healthColor,
            transition: 'width 0.3s ease, background 0.3s ease',
            boxShadow: `0 0 8px ${healthColor}44`
          }} />
        </div>
      </div>

      {/* Personality Bars */}
      <div style={{ fontSize: '0.65rem', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '8px' }}>
        Personality Profile
      </div>
      
      <PersonalityBar 
        label="Aggression" 
        value={personality.aggression} 
        colorRange={BAR_COLORS.aggression} 
        description={personality.aggression > 0.7 ? 'Actively seeks dogfights' : personality.aggression > 0.4 ? 'Engages when opportunity arises' : 'Avoids combat, prioritizes energy'}
      />
      <PersonalityBar 
        label="Persistence" 
        value={personality.combatPersistence} 
        colorRange={BAR_COLORS.combatPersistence} 
        description={personality.combatPersistence > 0.7 ? 'Relentless pursuer, chases until stalled' : personality.combatPersistence > 0.4 ? 'Moderate chase endurance' : 'Fire-and-forget, preserves energy'}
      />
      <PersonalityBar 
        label="Risk Tolerance" 
        value={personality.riskTolerance} 
        colorRange={BAR_COLORS.riskTolerance} 
        description={personality.riskTolerance > 0.7 ? 'Reckless — reacts late to edges and bullets' : personality.riskTolerance > 0.4 ? 'Balanced caution' : 'Cautious — evades early, recovers from stalls sooner'}
      />
    </div>
  );
}
