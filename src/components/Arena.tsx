import React, { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useSimulationStore } from '../store';

const CurvatureMaterial = new THREE.ShaderMaterial({
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    
    void main() {
      // Rates of change
      vec3 dNx = dFdx(vNormal);
      vec3 dNy = dFdy(vNormal);
      vec3 dPx = dFdx(vViewPosition);
      vec3 dPy = dFdy(vViewPosition);

      // Principal curvature
      float kx = dot(dPx, dNx) / (dot(dPx, dPx) + 0.00001);
      float ky = dot(dPy, dNy) / (dot(dPy, dPy) + 0.00001);
      float k = kx + ky; 
      
      float intensity = clamp(abs(k) * 100.0, 0.0, 1.0);
      
      vec3 concaveColor = vec3(0.0, 0.8, 0.5); // Greenish Blue
      vec3 convexColor = vec3(1.0, 0.3, 0.0); // Orange Red
      vec3 flatColor = vec3(0.2, 0.2, 0.25);
      
      vec3 finalColor = flatColor;
      if (k > 0.001) {
          finalColor = mix(flatColor, convexColor, intensity);
      } else if (k < -0.001) {
          finalColor = mix(flatColor, concaveColor, intensity);
      }

      float fresnel = dot(normalize(vViewPosition), normalize(vNormal));
      finalColor += vec3(0.05) * (1.0 - clamp(fresnel, 0.0, 1.0));
      
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `,
  extensions: {
    derivatives: true
  } as any
});

const StandardMaterial = new THREE.MeshStandardMaterial({ 
  color: '#1e293b', 
  roughness: 0.5,
  metalness: 0.1,
});

function ArenaScene({ scene }: { scene: THREE.Object3D }) {
  const showCurvature = useSimulationStore(state => state.showCurvature);
  const arenaScale = useSimulationStore(state => state.arenaScale);

  // Traverse the scene and configure materials/shadows
  const processedScene = useMemo(() => {
    const s = scene.clone();
    s.scale.set(arenaScale, arenaScale, arenaScale);

    s.traverse((child) => {
      // @ts-ignore
      if (child.isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        // Ensure geometry has normals
        if (!mesh.geometry.attributes.normal) {
          mesh.geometry.computeVertexNormals();
        }

        // Apply Curvature Heatmap or Standard Grid
        mesh.material = showCurvature ? CurvatureMaterial : StandardMaterial;
      }
    });
    return s;
  }, [scene, showCurvature, arenaScale]);

  return (
    <RigidBody type="fixed" colliders="trimesh">
      <primitive object={processedScene} />
    </RigidBody>
  );
}

function ArenaOBJ({ url }: { url: string }) {
  const obj = useLoader(OBJLoader, url);
  return <ArenaScene scene={obj} />;
}

function ArenaFBX({ url }: { url: string }) {
  const fbx = useLoader(FBXLoader, url);
  return <ArenaScene scene={fbx} />;
}

function ArenaGLTF({ url }: { url: string }) {
  const gltf = useLoader(GLTFLoader, url);
  return <ArenaScene scene={gltf.scene} />;
}

export function Arena({ url, fileType }: { url: string, fileType: string }) {
  if (fileType === 'obj') return <ArenaOBJ url={url} />;
  if (fileType === 'fbx') return <ArenaFBX url={url} />;
  return <ArenaGLTF url={url} />;
}
