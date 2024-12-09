import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import forceFragmentShader from '/src/shaders/forceFragmentShader.glsl';
import positionFragmentShader from '/src/shaders/positionFragmentShader.glsl';

// Initialize variables
let particleCount = 100; // default particle count (updated)
let positionTexture, velocityTexture, positionRenderTarget, velocityRenderTarget;
let particleSystem;

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
      textureSize: { value: Math.sqrt(particleCount) }, // Pass the square root of particle count
    },
    vertexShader: `
      uniform sampler2D positionTexture;
      uniform float textureSize; // Pass the texture size

      void main() {
        float particleIndex = float(gl_VertexID);
        float texX = mod(particleIndex, textureSize) / textureSize; // X coordinate
        float texY = floor(particleIndex / textureSize) / textureSize; // Y coordinate
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

// Update Textures
function updateTextures(deltaTime) {
    const forceMaterial = new THREE.ShaderMaterial({
      uniforms: {
        positionTexture: { value: positionTexture },
        velocityTexture: { value: velocityTexture },
        deltaTime: { value: deltaTime },
        G: { value: gravitationalConstant }, // Use dynamic G value
        softening: { value: 0.01 },
      },
      fragmentShader: forceFragmentShader,
    });
  
    renderer.setRenderTarget(velocityRenderTarget);
    renderer.render(scene, camera);
  
    const positionMaterial = new THREE.ShaderMaterial({
      uniforms: {
        positionTexture: { value: positionTexture },
        velocityTexture: { value: velocityTexture },
        deltaTime: { value: deltaTime },
      },
      fragmentShader: positionFragmentShader,
    });
  
    renderer.setRenderTarget(positionRenderTarget);
    renderer.render(scene, camera);
  
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


let lastFrameTime = performance.now(); // Track time of the last frame
let fps = 0; // Current FPS value

function updateFPS() {
  const now = performance.now();
  fps = Math.round(1000 / (now - lastFrameTime)); // Calculate FPS
  lastFrameTime = now;

  // Update the FPS counter in the HTML
  const fpsValueElement = document.getElementById('fps-value');
  if (fpsValueElement) {
    fpsValueElement.textContent = fps;
  }
}

let deltaTime = 0.016; // Default timestep

const timestepSlider = document.getElementById('timestep-slider');
const timestepValueElement = document.getElementById('timestep-value');

timestepSlider.addEventListener('input', () => {
  deltaTime = parseFloat(timestepSlider.value); // Update timestep
  timestepValueElement.textContent = deltaTime.toFixed(3); // Display the value
});

let gravitationalConstant = 20; // Default value for G

const gSlider = document.getElementById('g-slider');
const gValueElement = document.getElementById('g-value');

gSlider.addEventListener('input', () => {
  gravitationalConstant = parseFloat(gSlider.value); // Update G
  gValueElement.textContent = gravitationalConstant; // Display current G
});



function animate() {
    requestAnimationFrame(animate);
  
    updateTextures(deltaTime); // Use dynamic timestep
    controls.update();
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  
    // Update FPS
    updateFPS();
  }
  
  

// Initialize everything and start the animation
initializeDataTextures();
initializeParticleSystem();
animate();

// Update particle count dynamically with slider
const slider = document.getElementById('particle-slider');
const particleCountLabel = document.getElementById('particle-count');

slider.addEventListener('input', () => {
  particleCount = parseInt(slider.value, 10);
  particleCountLabel.textContent = particleCount;

  // Reinitialize the data and particle system
  scene.remove(particleSystem);
  initializeDataTextures();
  initializeParticleSystem();
});
