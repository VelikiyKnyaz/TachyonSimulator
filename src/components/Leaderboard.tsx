import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { simMetrics, useSimulationStore } from '../store';

const BOID_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ef4444'];
const GREEK_LETTERS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega'];

interface LeaderboardEntry {
  id: string;
  index: number;
  kills: number;
  deaths: number;
  kdr: number;
  health: number;
  maxHealth: number;
  color: string;
}

export function Leaderboard() {
  const boids = useSimulationStore(state => state.boids);
  const selectedBoidId = useSimulationStore(state => state.selectedBoidId);
  const setSelectedBoid = useSimulationStore(state => state.setSelectedBoid);
  const baseHealth = useSimulationStore(state => state.baseHealth);
  const isRunning = useSimulationStore(state => state.isRunning);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    if (!isRunning) return;
    
    const interval = setInterval(() => {
      const newEntries: LeaderboardEntry[] = boids.map((id, index) => {
        const kills = simMetrics.kills[id] || 0;
        const deaths = simMetrics.deaths[id] || 0;
        const kdr = deaths > 0 ? kills / deaths : kills; // If 0 deaths, KDR = kills
        const health = simMetrics.boidHealths.get(id) ?? baseHealth;
        
        return {
          id,
          index,
          kills,
          deaths,
          kdr,
          health,
          maxHealth: baseHealth,
          color: BOID_COLORS[index % BOID_COLORS.length]
        };
      });

      // Sort by KDR descending, then by kills descending as tiebreaker
      newEntries.sort((a, b) => {
        if (b.kdr !== a.kdr) return b.kdr - a.kdr;
        return b.kills - a.kills;
      });

      setEntries(newEntries);
    }, 500);

    return () => clearInterval(interval);
  }, [boids, isRunning, baseHealth]);

  if (!isRunning || boids.length === 0) return null;

  const handleClick = (id: string) => {
    setSelectedBoid(selectedBoidId === id ? null : id);
  };

  return (
    <div className="glass-panel" style={{
      position: 'absolute',
      bottom: '1rem',
      right: '1rem',
      padding: '1rem',
      width: '280px',
      maxHeight: '340px',
      zIndex: 10,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '0.5rem', 
        marginBottom: '0.75rem',
        paddingBottom: '0.5rem',
        borderBottom: '1px solid rgba(255,255,255,0.08)'
      }}>
        <Trophy size={14} color="#eab308" />
        <span style={{ 
          fontSize: '0.75rem', 
          textTransform: 'uppercase', 
          letterSpacing: '0.05em', 
          color: 'var(--text-secondary)',
          fontWeight: 600 
        }}>
          Leaderboard
        </span>
      </div>

      {/* Header row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '24px 1fr 36px 36px 44px',
        gap: '4px',
        padding: '0 4px 6px 4px',
        fontSize: '0.6rem',
        color: 'var(--text-muted, #64748b)',
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
        fontWeight: 700
      }}>
        <span>#</span>
        <span>Agent</span>
        <span style={{ textAlign: 'center' }}>K</span>
        <span style={{ textAlign: 'center' }}>D</span>
        <span style={{ textAlign: 'right' }}>KDR</span>
      </div>

      {/* Scrollable list */}
      <div style={{ 
        overflowY: 'auto', 
        flex: 1,
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.1) transparent'
      }}>
        {entries.map((entry, rank) => {
          const isSelected = selectedBoidId === entry.id;
          const healthPct = Math.max(0, entry.health / entry.maxHealth);
          
          return (
            <div
              key={entry.id}
              onClick={() => handleClick(entry.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr 36px 36px 44px',
                gap: '4px',
                padding: '5px 4px',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                background: isSelected 
                  ? 'rgba(59, 130, 246, 0.15)' 
                  : rank === 0 
                    ? 'rgba(234, 179, 8, 0.06)' 
                    : 'transparent',
                border: isSelected 
                  ? '1px solid rgba(59, 130, 246, 0.4)' 
                  : '1px solid transparent',
                marginBottom: '2px',
                position: 'relative',
                overflow: 'hidden',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = rank === 0 
                    ? 'rgba(234, 179, 8, 0.06)' 
                    : 'transparent';
                }
              }}
            >
              {/* Health bar background */}
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                width: `${healthPct * 100}%`,
                height: '2px',
                background: healthPct > 0.5 
                  ? 'var(--success)' 
                  : healthPct > 0.25 
                    ? 'var(--warning)' 
                    : 'var(--danger)',
                opacity: 0.6,
                transition: 'width 0.3s ease',
                borderRadius: '0 0 6px 6px'
              }} />

              {/* Rank */}
              <span style={{ 
                fontSize: '0.7rem', 
                fontWeight: 700,
                color: rank === 0 ? '#eab308' : rank === 1 ? '#94a3b8' : rank === 2 ? '#cd7f32' : 'var(--text-muted, #64748b)',
                display: 'flex',
                alignItems: 'center'
              }}>
                {rank + 1}
              </span>

              {/* Boid identity */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: entry.color,
                  flexShrink: 0,
                  boxShadow: isSelected ? `0 0 6px ${entry.color}` : 'none'
                }} />
                <span style={{ 
                  fontSize: '0.75rem', 
                  color: 'var(--text-primary)',
                  fontWeight: isSelected ? 700 : 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {GREEK_LETTERS[entry.index % GREEK_LETTERS.length]}
                </span>
              </div>

              {/* Kills */}
              <span style={{ 
                fontSize: '0.75rem', 
                fontWeight: 700, 
                color: entry.kills > 0 ? '#eab308' : 'var(--text-muted, #64748b)',
                textAlign: 'center'
              }}>
                {entry.kills}
              </span>

              {/* Deaths */}
              <span style={{ 
                fontSize: '0.75rem', 
                fontWeight: 500, 
                color: entry.deaths > 0 ? 'var(--danger)' : 'var(--text-muted, #64748b)',
                textAlign: 'center'
              }}>
                {entry.deaths}
              </span>

              {/* KDR */}
              <span style={{ 
                fontSize: '0.75rem', 
                fontWeight: 700, 
                color: entry.kdr >= 2.0 
                  ? 'var(--success)' 
                  : entry.kdr >= 1.0 
                    ? 'var(--text-primary)' 
                    : 'var(--danger)',
                textAlign: 'right'
              }}>
                {entry.kdr.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
