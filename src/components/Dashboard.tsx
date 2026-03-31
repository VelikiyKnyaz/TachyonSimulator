import React, { useEffect, useState } from 'react';
import { Activity, Skull, Zap, Box } from 'lucide-react';
import { simMetrics } from '../store';

export function Dashboard() {
  const [metrics, setMetrics] = useState({
    activeBoids: 0,
    crashes: 0,
    avgSpeed: 0,
    maxSpeed: 0,
    shotsFired: 0,
    hits: 0,
    states: { HUNT: 0, DIVE: 0, EVADE: 0, CRUISE: 0 },
    topKiller: { id: '', kills: 0 }
  });

  useEffect(() => {
    const interval = setInterval(() => {
      let totalSpeed = 0;
      let active = 0;
      simMetrics.boidSpeeds.forEach((s) => {
        if (s > 0) {
          totalSpeed += s;
          active++;
        }
      });

      const st: Record<string, number> = { HUNT: 0, DIVE: 0, EVADE: 0, CRUISE: 0, CLIMB: 0 };
      simMetrics.boidStates.forEach(val => {
          if (st[val] !== undefined) st[val]++;
          else st[val] = 1;
      });

      let topKills = 0;
      let topId = '';
      Object.entries(simMetrics.kills).forEach(([id, kills]) => {
          if (kills > topKills) {
              topKills = kills;
              topId = id;
          }
      });

      setMetrics({
        activeBoids: simMetrics.activeBoids,
        crashes: simMetrics.crashes,
        avgSpeed: active > 0 ? totalSpeed / active : 0,
        maxSpeed: simMetrics.maxSpeed,
        shotsFired: simMetrics.shotsFired,
        hits: simMetrics.hits,
        states: st as { HUNT: number; DIVE: number; EVADE: number; CRUISE: number; },
        topKiller: { id: topId, kills: topKills }
      });
    }, 200);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="glass-panel" style={{
      position: 'absolute',
      top: '1rem',
      right: '1rem',
      padding: '1.5rem',
      width: '280px',
      zIndex: 10
    }}>
      <h3 style={{ fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Activity size={16} /> Live Telemetry
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="metric" style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <Box size={14} color="var(--accent-hover)" />
            <p style={{ fontSize: '0.75rem', margin: 0, color: 'var(--text-secondary)' }}>Active</p>
          </div>
          <p style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0, color: 'var(--text-primary)' }}>{metrics.activeBoids}</p>
        </div>
        
        <div className="metric" style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <Skull size={14} color="var(--danger)" />
            <p style={{ fontSize: '0.75rem', margin: 0, color: 'var(--text-secondary)' }}>Crashes</p>
          </div>
          <p style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0, color: 'var(--danger)' }}>{metrics.crashes}</p>
        </div>

        <div className="metric" style={{ gridColumn: 'span 2', background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <Zap size={14} color="var(--warning)" />
            <p style={{ fontSize: '0.75rem', margin: 0, color: 'var(--text-secondary)' }}>Logistics & Combat</p>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
              <div>
                 <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0 }}>AVG SPEED</p>
                 <p style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, color: 'var(--warning)' }}>{Math.round(metrics.avgSpeed)} <span style={{fontSize: '0.6rem'}}>km/h</span></p>
              </div>
              <div>
                 <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0 }}>MAX SPEED</p>
                 <p style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, color: 'var(--accent)' }}>{Math.round(metrics.maxSpeed)} <span style={{fontSize: '0.6rem'}}>km/h</span></p>
              </div>
              <div>
                 <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0 }}>SHOTS FIRED</p>
                 <p style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, color: '#f59e0b' }}>{metrics.shotsFired}</p>
              </div>
              <div>
                 <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0 }}>ACCURACY</p>
                 <p style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, color: '#10b981' }}>
                    {metrics.shotsFired > 0 ? Math.round((metrics.hits / metrics.shotsFired) * 100) : 0}%
                 </p>
              </div>
          </div>
          
          <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem' }}>
             <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0, marginBottom: '0.5rem' }}>AI STATES</p>
             <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem' }}>
                 <span style={{color: '#f87171'}}>Hunt: {metrics.states.HUNT || 0}</span>
                 <span style={{color: '#60a5fa'}}>Dive: {metrics.states.DIVE || 0}</span>
                 <span style={{color: '#a78bfa'}}>Cruise: {metrics.states.CRUISE || 0}</span>
             </div>
          </div>

          <div style={{ background: 'var(--bg-primary)', padding: '0.75rem', borderRadius: '8px', marginTop: '1rem' }}>
            <div style={{ opacity: 0.7, fontSize: '0.75rem' }}>Top Killer</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--accent)' }}>
              {metrics.topKiller.kills > 0 ? `${metrics.topKiller.kills} Kills` : '-'}
            </div>
            <div style={{ opacity: 0.5, fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {metrics.topKiller.id || 'No casualties'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
