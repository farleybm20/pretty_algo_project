import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// constants for the simulation
const particleCount = 1024 * 1024; // 1 million particles
const textureSize = Math.sqrt(particleCount); // 1024 x 1024 texture

// create a scene
const scene = new THREE.Scene();

// set up the camera
const camera = new THREE.PerspectiveCamera(
  75, // field of view (degrees)
  window.innerWidth / window.innerHeight, // aspect ratio
  0.1, // near clipping plane
  1000 // far clipping plane
);
camera.position.set(0, 0, 10); // move camera back to view particles

// create the WebGL renderer
const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#simulation'), // link the canvas from HTML
});
renderer.setSize(window.innerWidth, window.innerHeight); // set canvas size
renderer.setClearColor(0x000000, 1); // black background

// initialize orbit controls
const controls = new OrbitControls(camera, renderer.domElement);

// enable control features
controls.enableDamping = true; // smooth motion
controls.dampingFactor = 0.05; // damping inertia
controls.enableZoom = true; // enable zooming with the scroll wheel
controls.enableRotate = true; // enable rotating the camera
controls.enablePan = true; // enable panning with right-click

// set zoom limits
controls.minDistance = 1; // minimum zoom distance
controls.maxDistance = 100; // maximum zoom distance

// set rotation limits (optional)
controls.maxPolarAngle = Math.PI / 2; // limit vertical rotation to 90 degrees
controls.minPolarAngle = 0; // prevent flipping below the horizon

// initialize particle data
const positions = new Float32Array(particleCount * 4); // RGBA per particle
for (let i = 0; i < particleCount; i++) {
  positions[i * 4] = (Math.random() - 0.5) * 10; // x
  positions[i * 4 + 1] = (Math.random() - 0.5) * 10; // y
  positions[i * 4 + 2] = (Math.random() - 0.5) * 10; // z
  positions[i * 4 + 3] = 1.0; // w (not used, but required for texture format)
}

// create a data texture from particle data
const positionTexture = new THREE.DataTexture(
  positions,
  textureSize,
  textureSize,
  THREE.RGBAFormat,
  THREE.FloatType
);
positionTexture.needsUpdate = true;

// create a material with custom shaders
const particleMaterial = new THREE.ShaderMaterial({
  uniforms: {
    positionTexture: { value: positionTexture },
  },
  vertexShader: `
    uniform sampler2D positionTexture;

    void main() {
      // compute texture coordinates from vertex ID
      float particleIndex = float(gl_VertexID);
      float textureSize = 1024.0; // assuming a 1024x1024 texture
      float texX = mod(particleIndex, textureSize) / textureSize; // x coordinate in the texture
      float texY = floor(particleIndex / textureSize) / textureSize; // y coordinate in the texture
      vec2 uv = vec2(texX, texY); // calculate UV coordinates

      // fetch particle position from the texture
      vec4 position = texture2D(positionTexture, uv);

      // transform to clip space
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xyz, 1.0);

      // set the size of each point
      gl_PointSize = 3.0;
    }
  `,
  fragmentShader: `
    void main() {
      // simple white color for particles
      gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
    }
  `,
  transparent: true,
});

// create a geometry for particles
const geometry = new THREE.BufferGeometry();
geometry.setAttribute(
  'position',
  new THREE.BufferAttribute(new Float32Array(particleCount * 3), 3)
);

// create the particle system
const particleSystem = new THREE.Points(geometry, particleMaterial);
scene.add(particleSystem);

// animation loop
function animate() {
  requestAnimationFrame(animate);

  // update controls
  controls.update();

  // render the scene
  renderer.render(scene, camera);
}
animate();
