import React, { useEffect, useState } from 'react';
import { Activity, Skull, Zap, Box, Crosshair, Clock, ShieldAlert } from 'lucide-react';
import { simMetrics } from '../store';

export function Dashboard() {
  const [metrics, setMetrics] = useState({
    activeBoids: 0,
    crashes: 0,
    kills: 0,
    avgSpeed: 0,
    maxSpeed: 0,
    shotsFired: 0,
    hits: 0,
    totalAirTime: 0
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

      const totalKills = Object.values(simMetrics.kills).reduce((a, b) => a + b, 0);

      setMetrics({
        activeBoids: simMetrics.activeBoids,
        crashes: simMetrics.crashes,
        kills: totalKills,
        avgSpeed: active > 0 ? totalSpeed / active : 0,
        maxSpeed: simMetrics.maxSpeed,
        shotsFired: simMetrics.shotsFired,
        hits: simMetrics.hits,
        totalAirTime: simMetrics.totalAirTime
      });
    }, 200);

    return () => clearInterval(interval);
  }, []);

  const accuracy = metrics.shotsFired > 0 ? Math.round((metrics.hits / metrics.shotsFired) * 100) : 0;
  const accuracyColor = accuracy > 50 ? '#10b981' : accuracy > 20 ? '#f59e0b' : '#ef4444';

  return (
    <div className="glass-panel" style={{
      position: 'absolute',
      top: '1rem',
      right: '1rem',
      padding: '1.25rem',
      width: '320px',
      zIndex: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
        <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Activity size={16} color="var(--accent-hover)" /> Live Telemetry
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '0.25rem 0.75rem', borderRadius: '12px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success)' }}></div>
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{metrics.activeBoids} ACTIVE</span>
        </div>
      </div>

      {/* Card 1: Combat Efficiency */}
      <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px', borderLeft: '3px solid #eab308' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <Crosshair size={14} color="#eab308" />
          <p style={{ fontSize: '0.75rem', margin: 0, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Combat Efficiency</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
           <div>
             <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0 0 0.25rem 0' }}>SHOTS FIRED</p>
             <p style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, color: '#f59e0b' }}>{metrics.shotsFired}</p>
           </div>
           <div>
             <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0 0 0.25rem 0' }}>KILLS</p>
             <p style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, color: '#eab308' }}>{metrics.kills}</p>
           </div>
           <div style={{ textAlign: 'right' }}>
             <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0 0 0.25rem 0' }}>ACCURACY</p>
             <p style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, color: accuracyColor }}>{accuracy}%</p>
           </div>
        </div>
      </div>

      {/* Card 2: Kinematics */}
      <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px', borderLeft: '3px solid var(--accent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <Zap size={14} color="var(--accent)" />
          <p style={{ fontSize: '0.75rem', margin: 0, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Kinematics</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
           <div>
             <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0 0 0.25rem 0' }}>AVG SPEED</p>
             <p style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, color: 'var(--warning)' }}>
               {Math.round(metrics.avgSpeed)} <span style={{fontSize: '0.65rem', color: 'var(--text-muted)'}}>km/h</span>
             </p>
           </div>
           <div style={{ textAlign: 'right' }}>
             <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0 0 0.25rem 0' }}>MAX SPEED</p>
             <p style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, color: 'var(--accent)' }}>
               {Math.round(metrics.maxSpeed)} <span style={{fontSize: '0.65rem', color: 'var(--text-muted)'}}>km/h</span>
             </p>
           </div>
        </div>
      </div>

      {/* Card 3: Hazards */}
      <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px', borderLeft: '3px solid var(--danger)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <ShieldAlert size={14} color="var(--danger)" />
          <p style={{ fontSize: '0.75rem', margin: 0, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hazards</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
           <div>
             <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0 0 0.25rem 0' }}>FATAL CRASHES</p>
             <p style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, color: 'var(--danger)' }}>{metrics.crashes}</p>
           </div>
           <div style={{ textAlign: 'right' }}>
             <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0 0 0.25rem 0' }}>FLEET AIR TIME</p>
             <p style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, color: '#f87171' }}>
               {metrics.totalAirTime.toFixed(1)} <span style={{fontSize: '0.65rem', color: 'var(--text-muted)'}}>s</span>
             </p>
           </div>
        </div>
      </div>
    </div>
  );
}
