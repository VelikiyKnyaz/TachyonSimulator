import React, { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Sky } from '@react-three/drei';
import { Physics, RigidBody } from '@react-three/rapier';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { Arena } from './components/Arena';
import { BoidSwarm } from './components/BoidSwarm';
import { CameraFollower } from './components/CameraFollower';
import { BoidInfoPanel } from './components/BoidInfoPanel';
import { useSimulationStore } from './store';

export default function App() {
  const [arenaModel, setArenaModel] = useState<{url: string, type: string} | null>(null);
  const isRunning = useSimulationStore(state => state.isRunning);
  const arenaScale = useSimulationStore(state => state.arenaScale);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (['glb', 'gltf', 'obj', 'fbx'].includes(ext)) {
        const url = URL.createObjectURL(file);
        setArenaModel({ url, type: ext });
      }
    }
  };

  return (
    <div 
      className="app-container"
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
      style={{ display: 'flex', width: '100%', height: '100%' }}
    >
      <Sidebar arenaLoaded={true} />
      
      <main className="simulation-view" style={{ flexGrow: 1, position: 'relative' }}>
        {!arenaModel && !isRunning && (
          <div className="empty-state glass-panel" style={{
            position: 'absolute', top: '50%', left: '50%', 
            transform: 'translate(-50%, -50%)', padding: '2.5rem',
            textAlign: 'center', zIndex: 10, maxWidth: '400px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            <h2 style={{ color: 'var(--accent-hover)', marginBottom: '1rem' }}>Arena Sandbox Ready</h2>
            <p style={{ lineHeight: '1.6', marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
              Press <strong>Start</strong> to run on the default plane, or drag and drop an <code>.obj</code>, <code>.fbx</code>, or <code>.glb</code> model to use a custom arena.
            </p>
          </div>
        )}

        <Canvas shadows camera={{ position: [0, 50, 100], fov: 60 }}>
          <color attach="background" args={['#0a0f1c']} />
          <Suspense fallback={null}>
            <Environment preset="night" />
            <Sky distance={450000} sunPosition={[0, -0.1, 0]} inclination={0} azimuth={0.25} turbidity={10} rayleigh={0.1} />
            <directionalLight castShadow position={[100, 100, 50]} intensity={1.5} shadow-mapSize={[2048, 2048]} />
            <ambientLight intensity={0.5} />
            
            <Physics>
              {!arenaModel ? (
              <RigidBody type="fixed" key={`plane-${arenaScale}`}>
                  <mesh receiveShadow position={[0, -0.5 * arenaScale, 0]}>
                    <boxGeometry args={[200 * arenaScale, 1 * arenaScale, 200 * arenaScale]} />
                    <meshStandardMaterial color="#131b2f" roughness={0.8} />
                  </mesh>
                </RigidBody>
              ) : (
                <Arena url={arenaModel.url} fileType={arenaModel.type} />
              )}
              
              <BoidSwarm />
            </Physics>
            
            <OrbitControls makeDefault />
            <CameraFollower />
          </Suspense>
        </Canvas>

        {(arenaModel || isRunning) && <Dashboard />}
        <BoidInfoPanel />
      </main>
    </div>
  );
}
