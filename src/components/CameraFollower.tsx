import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useSimulationStore, simMetrics } from '../store';
import * as THREE from 'three';

const _targetPos = new THREE.Vector3();
const _cameraOffset = new THREE.Vector3();

export function CameraFollower() {
  const selectedBoidId = useSimulationStore(state => state.selectedBoidId);
  const { camera, controls } = useThree();
  const smoothTarget = useRef(new THREE.Vector3());
  const isFollowing = useRef(false);
  
  useFrame(() => {
    if (!selectedBoidId) {
      isFollowing.current = false;
      return;
    }
    
    const boidPos = simMetrics.boidPositions.get(selectedBoidId);
    if (!boidPos) return;
    
    _targetPos.set(boidPos.x, boidPos.y, boidPos.z);
    
    // Smooth interpolation for the camera target
    const lerpFactor = isFollowing.current ? 0.08 : 0.01; // Fast follow, slow initial zoom
    smoothTarget.current.lerp(_targetPos, lerpFactor);
    isFollowing.current = true;
    
    // Update OrbitControls target to follow the boid
    if (controls && (controls as any).target) {
      (controls as any).target.copy(smoothTarget.current);
      (controls as any).update();
    }
    
    // Move camera to maintain relative offset (smooth follow)
    _cameraOffset.copy(camera.position).sub((controls as any)?.target || smoothTarget.current);
    const dist = _cameraOffset.length();
    
    // Auto-zoom in when first selecting (to a comfortable following distance)
    if (dist > 25) {
      _cameraOffset.normalize().multiplyScalar(dist * 0.98); // Slowly zoom in
      camera.position.copy(smoothTarget.current).add(_cameraOffset);
    }
  });

  return null;
}
