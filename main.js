import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import forceFragmentShader from '/src/shaders/forceFragmentShader.glsl';
import positionFragmentShader from '/src/shaders/positionFragmentShader.glsl';

// Initialize variables
let particleCount = 100; // Default particle count
let deltaTime = 0.016; // Default timestep
let gravitationalConstant = 20; // Default G value
let positionTexture, velocityTexture, positionRenderTarget, velocityRenderTarget;
let particleSystem, forceMaterial, positionMaterial;

// Create scene and camera
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 0, 10);

// Create renderer
const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#simulation'),
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);

// Initialize OrbitControls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableZoom = true;
controls.enableRotate = true;
controls.minDistance = 1;
controls.maxDistance = 100;

// Attach Event Listeners
const slider = document.getElementById('particle-slider');
const particleCountLabel = document.getElementById('particle-count');
slider.addEventListener('input', () => {
  particleCount = parseInt(slider.value, 10);
  particleCountLabel.textContent = particleCount;

  // Reinitialize the data and particle system
  scene.remove(particleSystem);
  initializeDataTextures();
  initializeMaterials();
  initializeParticleSystem();
});

const gSlider = document.getElementById('g-slider');
const gValueElement = document.getElementById('g-value');
gSlider.addEventListener('input', () => {
  gravitationalConstant = parseFloat(gSlider.value);
  gValueElement.textContent = gravitationalConstant.toFixed(1);
});

const timestepSlider = document.getElementById('timestep-slider');
const timestepValueElement = document.getElementById('timestep-value');
timestepSlider.addEventListener('input', () => {
  deltaTime = parseFloat(timestepSlider.value);
  timestepValueElement.textContent = deltaTime.toFixed(3);
});

// Initialize data textures
function initializeDataTextures() {
  const positions = new Float32Array(particleCount * 4);
  const velocities = new Float32Array(particleCount * 4);

  for (let i = 0; i < particleCount; i++) {
    positions[i * 4] = (Math.random() - 0.5) * 10; // x
    positions[i * 4 + 1] = (Math.random() - 0.5) * 10; // y
    positions[i * 4 + 2] = (Math.random() - 0.5) * 10; // z
    positions[i * 4 + 3] = 1.0; // w (not used)

    velocities[i * 4] = 0.0; // vx
    velocities[i * 4 + 1] = 0.0; // vy
    velocities[i * 4 + 2] = 0.0; // vz
    velocities[i * 4 + 3] = 0.0; // w (not used)
  }

  positionTexture = new THREE.DataTexture(
    positions,
    Math.sqrt(particleCount),
    Math.sqrt(particleCount),
    THREE.RGBAFormat,
    THREE.FloatType
  );
  positionTexture.needsUpdate = true;

  velocityTexture = new THREE.DataTexture(
    velocities,
    Math.sqrt(particleCount),
    Math.sqrt(particleCount),
    THREE.RGBAFormat,
    THREE.FloatType
  );
  velocityTexture.needsUpdate = true;

  positionRenderTarget = new THREE.WebGLRenderTarget(
    Math.sqrt(particleCount),
    Math.sqrt(particleCount),
    { type: THREE.FloatType }
  );
  velocityRenderTarget = new THREE.WebGLRenderTarget(
    Math.sqrt(particleCount),
    Math.sqrt(particleCount),
    { type: THREE.FloatType }
  );
}

// Initialize materials
function initializeMaterials() {
  forceMaterial = new THREE.ShaderMaterial({
    uniforms: {
      positionTexture: { value: positionTexture },
      velocityTexture: { value: velocityTexture },
      deltaTime: { value: deltaTime },
      G: { value: gravitationalConstant },
      softening: { value: 0.01 },
    },
    fragmentShader: forceFragmentShader,
  });

  positionMaterial = new THREE.ShaderMaterial({
    uniforms: {
      positionTexture: { value: positionTexture },
      velocityTexture: { value: velocityTexture },
      deltaTime: { value: deltaTime },
    },
    fragmentShader: positionFragmentShader,
  });
}

// Initialize particle system
function initializeParticleSystem() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(particleCount * 3), 3)
  );

  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      positionTexture: { value: positionTexture },
      textureSize: { value: Math.sqrt(particleCount) },
    },
    vertexShader: `
      uniform sampler2D positionTexture;
      uniform float textureSize;

      void main() {
        float particleIndex = float(gl_VertexID);
        float texX = mod(particleIndex, textureSize) / textureSize;
        float texY = floor(particleIndex / textureSize) / textureSize;
        vec2 uv = vec2(texX, texY);

        vec4 pos = texture2D(positionTexture, uv);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos.xyz, 1.0);
        gl_PointSize = 3.0;
      }
    `,
    fragmentShader: `
      void main() {
        gl_FragColor = vec4(1.0);
      }
    `,
    transparent: true,
  });

  particleSystem = new THREE.Points(geometry, particleMaterial);
  scene.add(particleSystem);
}

// Update textures
function updateTextures(deltaTime) {
  // Update uniforms
  forceMaterial.uniforms.positionTexture.value = positionTexture;
  forceMaterial.uniforms.velocityTexture.value = velocityTexture;
  forceMaterial.uniforms.deltaTime.value = deltaTime;
  forceMaterial.uniforms.G.value = gravitationalConstant;

  positionMaterial.uniforms.positionTexture.value = positionTexture;
  positionMaterial.uniforms.velocityTexture.value = velocityTexture;
  positionMaterial.uniforms.deltaTime.value = deltaTime;

  // Apply force shader
  const forceScene = new THREE.Scene();
  const forceQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), forceMaterial);
  forceScene.add(forceQuad);

  renderer.setRenderTarget(velocityRenderTarget);
  renderer.render(forceScene, camera);

  // Apply position shader
  const positionScene = new THREE.Scene();
  const positionQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    positionMaterial
  );
  positionScene.add(positionQuad);

  renderer.setRenderTarget(positionRenderTarget);
  renderer.render(positionScene, camera);

  // Swap textures
  [positionTexture, positionRenderTarget.texture] = [
    positionRenderTarget.texture,
    positionTexture,
  ];
  [velocityTexture, velocityRenderTarget.texture] = [
    velocityRenderTarget.texture,
    velocityTexture,
  ];
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  updateTextures(deltaTime); // Use dynamic timestep
  controls.update(); // Update camera controls
  renderer.setRenderTarget(null);
  renderer.render(scene, camera); // Render the scene
  updateFPS(); // Update FPS counter
}

// Initialize everything
initializeDataTextures();
initializeMaterials();
initializeParticleSystem();
animate();
