import React from 'react';
import { Play, RotateCcw, Box, Settings, Map, Map as MapIcon } from 'lucide-react';
import { useSimulationStore } from '../store';

export function Sidebar({ arenaLoaded }: { arenaLoaded: boolean }) {
  const { 
    isRunning, startSimulation, resetSimulation, agentCount, setAgentCount, showCurvature, toggleCurvature, arenaScale, setArenaScale, crashTolerance, setCrashTolerance,
    // Debug Params
    maxSpeedCap, setMaxSpeedCap,
    turnPenalty, setTurnPenalty,
    evasionTurnAngle, setEvasionTurnAngle,
    lookAheadDist, setLookAheadDist,
    centripetalGrip, setCentripetalGrip,
    baseFriction, setBaseFriction,
    showNoses, toggleNoses,
    showStateLabels, toggleStateLabels,
    debugSize, setDebugSize,
    motorPower, setMotorPower,
    maxTurnRateDeg, setMaxTurnRateDeg,
    diveEnergyThreshold, setDiveEnergyThreshold,
    climbEnergyThreshold, setClimbEnergyThreshold,
    huntConeCone, setHuntConeCone,
    fireRateDelay, setFireRateDelay,
    overheatCooldown, setOverheatCooldown,
    projectileSpeed, setProjectileSpeed
  } = useSimulationStore();
  
  return (
    <aside className="glass-panel" style={{ 
      width: '320px', 
      height: 'calc(100vh - 2rem)', 
      margin: '1rem', 
      padding: '1.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '2rem',
      overflowY: 'auto',
      zIndex: 10
    }}>
      <div className="header" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <Box color="var(--accent-hover)" size={32} />
        <div>
          <h1 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '1.5rem' }}>Tachyon</h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--accent-hover)', margin: 0, fontWeight: 500 }}>Arena AI Simulator</p>
        </div>
      </div>

      <div className="controls">
        <h3 style={{ fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Simulation</h3>
        <button onClick={startSimulation} disabled={isRunning} style={{ width: '100%', marginBottom: '0.75rem' }}>
          <Play size={18} /> Start
        </button>
        <button onClick={resetSimulation} className="secondary-btn" style={{ width: '100%', marginBottom: '0.5rem' }}>
          <RotateCcw size={18} /> Reset
        </button>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <button 
              className={`btn-secondary ${showCurvature ? 'active-toggle' : ''}`} 
              onClick={toggleCurvature}
              disabled={!arenaLoaded}
              style={{ width: '100%', color: showCurvature ? 'var(--accent)' : '', borderColor: showCurvature ? 'var(--accent-hover)' : '' }}
            >
              <MapIcon size={16} /> Grid
            </button>
            <button 
              className={`btn-secondary ${showNoses ? 'active-toggle' : ''}`} 
              onClick={toggleNoses}
              style={{ width: '100%', color: showNoses ? 'var(--success)' : '', borderColor: showNoses ? 'var(--success)' : '' }}
            >
              <Box size={16} /> Nose
            </button>
            <button 
              className={`btn-secondary ${showStateLabels ? 'active-toggle' : ''}`} 
              onClick={toggleStateLabels}
              style={{ width: '100%', color: showStateLabels ? 'var(--warning)' : '', borderColor: showStateLabels ? 'var(--warning)' : '' }}
            >
              <Box size={16} /> State
            </button>
        </div>

        {(showNoses || showStateLabels) && (
            <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>
                <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span>Debug UI Scale</span><span style={{ fontWeight: 'bold' }}>{debugSize.toFixed(1)}x</span>
                </label>
                <input type="range" className="slider" min="1.0" max="10.0" step="0.5" value={debugSize} onChange={(e) => setDebugSize(parseFloat(e.target.value))} style={{ width: '100%' }} />
            </div>
        )}
      </div>

      <div className="settings">
        <h3 style={{ fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Settings size={16} /> Parameters
        </h3>
        
        <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '8px' }}>
          <div className="parameters-section">
            <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
              <span>Agent Count</span>
              <span style={{ fontWeight: 'bold' }}>{agentCount}</span>
            </label>
            <input 
              type="range" 
              className="slider" 
              min="1" 
              max="50" 
              value={agentCount} 
              disabled={isRunning}
              onChange={(e) => setAgentCount(parseInt(e.target.value))}
              style={{ width: '100%', marginBottom: '1rem' }}
            />

            <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
              <span>Arena Scale</span>
              <span style={{ fontWeight: 'bold' }}>{arenaScale.toFixed(1)}x</span>
            </label>
            <input 
              type="range" 
              className="slider" 
              min="0.1" 
              max="10.0" 
              step="0.1"
              value={arenaScale} 
              disabled={!arenaLoaded || isRunning}
              onChange={(e) => setArenaScale(parseFloat(e.target.value))}
              style={{ width: '100%', marginBottom: '1rem' }}
            />

            <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
              <span>Crash Tolerance</span>
              <span style={{ fontWeight: 'bold' }}>{crashTolerance.toFixed(2)} rad</span>
            </label>
            <input 
              type="range" className="slider" 
              min="0.1" max="1.5" step="0.05"
              value={crashTolerance} disabled={isRunning}
              onChange={(e) => setCrashTolerance(parseFloat(e.target.value))}
              style={{ width: '100%', marginBottom: '1rem' }}
            />

            {/* --- AI ACCORDION MENUS --- */}
            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              
              {/* CATEGORY 1: Físicas */}
              <details style={{ padding: '0.5rem', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', border: '1px solid var(--accent-hover)' }} open>
                <summary style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--accent)', cursor: 'pointer', fontWeight: 'bold' }}>🏎️ Locomoción & Físicas</summary>
                <div style={{ marginTop: '0.75rem' }}>
                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Motor Power (N)</span><span style={{ fontWeight: 'bold' }}>{motorPower.toFixed(0)}</span>
                  </label>
                  <input type="range" className="slider" min="100" max="2000" step="50" value={motorPower} onChange={(e) => setMotorPower(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: '0.75rem' }} />

                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Max Speed (m/s)</span><span style={{ fontWeight: 'bold', color: 'var(--warning)' }}>{maxSpeedCap.toFixed(1)}</span>
                  </label>
                  <input type="range" className="slider" min="10" max="100" step="1" value={maxSpeedCap} onChange={(e) => setMaxSpeedCap(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: '0.75rem' }} />

                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Turn Penalty (Brake)</span><span style={{ fontWeight: 'bold', color: 'var(--danger)' }}>{turnPenalty.toFixed(2)}x</span>
                  </label>
                  <input type="range" className="slider" min="0.0" max="4.0" step="0.1" value={turnPenalty} onChange={(e) => setTurnPenalty(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: '0.75rem' }} />

                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Centripetal Grip</span><span style={{ fontWeight: 'bold' }}>{centripetalGrip.toFixed(2)}</span>
                  </label>
                  <input type="range" className="slider" min="0.0" max="1.0" step="0.05" value={centripetalGrip} onChange={(e) => setCentripetalGrip(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: '0.75rem' }} />

                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Base Friction</span><span style={{ fontWeight: 'bold' }}>{baseFriction.toFixed(1)}</span>
                  </label>
                  <input type="range" className="slider" min="0.0" max="10.0" step="0.1" value={baseFriction} onChange={(e) => setBaseFriction(parseFloat(e.target.value))} style={{ width: '100%' }} />
                </div>
              </details>

              {/* CATEGORY 2: Sensores */}
              <details style={{ padding: '0.5rem', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', border: '1px solid var(--accent-hover)' }}>
                <summary style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--success)', cursor: 'pointer', fontWeight: 'bold' }}>👁️ Sensores & Energía</summary>
                <div style={{ marginTop: '0.75rem' }}>
                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Lidar Range (x)</span><span style={{ fontWeight: 'bold' }}>{lookAheadDist.toFixed(2)}</span>
                  </label>
                  <input type="range" className="slider" min="0.05" max="1.0" step="0.05" value={lookAheadDist} onChange={(e) => setLookAheadDist(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: '0.75rem' }} />

                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Evade U-Turn (pi)</span><span style={{ fontWeight: 'bold' }}>{evasionTurnAngle.toFixed(2)}π</span>
                  </label>
                  <input type="range" className="slider" min="0.1" max="1.5" step="0.05" value={evasionTurnAngle} onChange={(e) => setEvasionTurnAngle(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: '0.75rem' }} />

                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Max Turn Rate (deg/s)</span><span style={{ fontWeight: 'bold', color: 'var(--warning)' }}>{maxTurnRateDeg.toFixed(0)}°</span>
                  </label>
                  <input type="range" className="slider" min="30" max="720" step="10" value={maxTurnRateDeg} onChange={(e) => setMaxTurnRateDeg(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: '0.75rem' }} />

                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Dive Energy Min</span><span style={{ fontWeight: 'bold' }}>{diveEnergyThreshold.toFixed(0)}m/s</span>
                  </label>
                  <input type="range" className="slider" min="10" max="60" step="1" value={diveEnergyThreshold} onChange={(e) => setDiveEnergyThreshold(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: '0.75rem' }} />

                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Climb Energy Max</span><span style={{ fontWeight: 'bold' }}>{climbEnergyThreshold.toFixed(0)}m/s</span>
                  </label>
                  <input type="range" className="slider" min="20" max="80" step="1" value={climbEnergyThreshold} onChange={(e) => setClimbEnergyThreshold(parseFloat(e.target.value))} style={{ width: '100%' }} />
                </div>
              </details>

              {/* CATEGORY 3: Combate */}
              <details style={{ padding: '0.5rem', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', border: '1px solid var(--accent-hover)' }}>
                <summary style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--danger)', cursor: 'pointer', fontWeight: 'bold' }}>⚔️ Combate & Caza</summary>
                <div style={{ marginTop: '0.75rem' }}>
                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Aim Assist Cone</span><span style={{ fontWeight: 'bold' }}>{huntConeCone.toFixed(2)}</span>
                  </label>
                  <input type="range" className="slider" min="0.1" max="0.95" step="0.05" value={huntConeCone} onChange={(e) => setHuntConeCone(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: '0.75rem' }} />

                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Fire Rate (s)</span><span style={{ fontWeight: 'bold' }}>{fireRateDelay.toFixed(3)}s</span>
                  </label>
                  <input type="range" className="slider" min="0.01" max="0.5" step="0.01" value={fireRateDelay} onChange={(e) => setFireRateDelay(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: '0.75rem' }} />

                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Overheat Penalty</span><span style={{ fontWeight: 'bold' }}>{overheatCooldown.toFixed(1)}s</span>
                  </label>
                  <input type="range" className="slider" min="0.5" max="5.0" step="0.1" value={overheatCooldown} onChange={(e) => setOverheatCooldown(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: '0.75rem' }} />

                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                    <span>Proj. Speed (m/s)</span><span style={{ fontWeight: 'bold' }}>{projectileSpeed.toFixed(0)}</span>
                  </label>
                  <input type="range" className="slider" min="50" max="300" step="10" value={projectileSpeed} onChange={(e) => setProjectileSpeed(parseFloat(e.target.value))} style={{ width: '100%' }} />
                </div>
              </details>

            </div>
          </div>
        </div>
      </div>

      <div className="status" style={{ marginTop: 'auto', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', borderLeft: `3px solid ${arenaLoaded ? 'var(--success)' : 'var(--warning)'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Map size={16} color={arenaLoaded ? 'var(--success)' : 'var(--warning)'} />
          <p style={{ fontSize: '0.875rem', margin: 0, color: 'var(--text-primary)' }}>
            {arenaLoaded ? 'Environment Ready' : 'Awaiting Model...'}
          </p>
        </div>
      </div>
    </aside>
  );
}
