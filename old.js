import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GPU } from 'gpu.js';

// Initialize variables
let particleCount = 100;
let deltaTime = 0.016;
let gravitationalConstant = 1;
let particleSystem, geometry;

const gpu = new GPU();

// Create scene
const scene = new THREE.Scene();

// Create camera with improved settings for large zoom range
const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.001,
    100000
);
camera.position.set(0, 0, 10);

// Create renderer with logarithmic depth buffer
const renderer = new THREE.WebGLRenderer({
    canvas: document.querySelector('#simulation'),
    logarithmicDepthBuffer: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);

// Initialize OrbitControls with improved settings
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableZoom = true;
controls.enableRotate = true;
controls.minDistance = 0.01;
controls.maxDistance = 10000;
controls.zoomSpeed = 1.5;
controls.rotateSpeed = 0.75;
controls.enablePan = true;
controls.panSpeed = 0.5;
controls.screenSpacePanning = true;

// Add window resize handler
window.addEventListener('resize', onWindowResize, false);

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

let simulationMethod = 'direct';
let grid = null;

// Add the Grid class
class SpatialGrid {
    constructor(size, cellSize) {
        this.size = size;          // Total size of simulation space
        this.cellSize = cellSize;  // Size of each grid cell
        this.cells = new Map();    // Map to store particles in cells
    }

    // Get cell index for a position
    getCellIndex(x, y, z) {
        const ix = Math.floor((x + this.size/2) / this.cellSize);
        const iy = Math.floor((y + this.size/2) / this.cellSize);
        const iz = Math.floor((z + this.size/2) / this.cellSize);
        return `${ix},${iy},${iz}`;
    }

    // Clear and rebuild grid
    updateGrid(positions, particleCount) {
        this.cells.clear();
        
        for (let i = 0; i < particleCount; i++) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];
            
            const cellIndex = this.getCellIndex(x, y, z);
            
            if (!this.cells.has(cellIndex)) {
                this.cells.set(cellIndex, []);
            }
            this.cells.get(cellIndex).push(i);
        }
    }

    // Get nearby particles
    getNearbyParticles(x, y, z) {
        const nearbyParticles = [];
        const cellIndex = this.getCellIndex(x, y, z);
        const [ix, iy, iz] = cellIndex.split(',').map(Number);
        
        // Check current cell and neighboring cells
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const neighborIndex = `${ix+dx},${iy+dy},${iz+dz}`;
                    if (this.cells.has(neighborIndex)) {
                        nearbyParticles.push(...this.cells.get(neighborIndex));
                    }
                }
            }
        }
        
        return nearbyParticles;
    }
}

function calculateForcesSpatial(positions, velocities, G) {
    if (!grid) {
        // Initialize grid with appropriate size
        grid = new SpatialGrid(100, 10); // Adjust these values based on your simulation scale
    }
    
    // Update grid with current particle positions
    grid.updateGrid(positions, particleCount);
    
    const forces = new Float32Array(particleCount * 3);
    
    // Calculate forces using spatial partitioning
    for (let i = 0; i < particleCount; i++) {
        const px = positions[i * 3];
        const py = positions[i * 3 + 1];
        const pz = positions[i * 3 + 2];
        
        // Get nearby particles
        const nearbyParticles = grid.getNearbyParticles(px, py, pz);
        
        let fx = 0, fy = 0, fz = 0;
        
        for (const j of nearbyParticles) {
            if (i === j) continue;
            
            const dx = positions[j * 3] - px;
            const dy = positions[j * 3 + 1] - py;
            const dz = positions[j * 3 + 2] - pz;
            
            const distSqr = dx * dx + dy * dy + dz * dz + 0.01;
            const dist = Math.sqrt(distSqr);
            const force = G / distSqr;
            
            fx += force * dx / dist;
            fy += force * dy / dist;
            fz += force * dz / dist;
        }
        
        forces[i * 3] = fx;
        forces[i * 3 + 1] = fy;
        forces[i * 3 + 2] = fz;
    }
    
    return forces;
}

// Function to create force calculation kernel
function createForceKernel(count) {
    return gpu.createKernel(function(positions, G) {
        const i = this.thread.x;
        let fx = 0;
        let fy = 0;
        let fz = 0;
        
        const px = positions[i * 3];
        const py = positions[i * 3 + 1];
        const pz = positions[i * 3 + 2];
        
        for (let j = 0; j < this.constants.particleCount; j++) {
            if (i === j) continue;
            
            const dx = positions[j * 3] - px;
            const dy = positions[j * 3 + 1] - py;
            const dz = positions[j * 3 + 2] - pz;
            
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
            const force = G / (distance * distance);
            
            fx += force * dx / distance;
            fy += force * dy / distance;
            fz += force * dz / distance;
        }
        
        return [fx, fy, fz];
    })
    .setOutput([count])
    .setConstants({ particleCount: count });
}

// Initialize force calculation kernel
let calculateForces = createForceKernel(particleCount);

// Attach Event Listeners
const slider = document.getElementById('particle-slider');
const particleCountLabel = document.getElementById('particle-count');
slider.addEventListener('input', () => {
    const newCount = parseInt(slider.value, 10);
    particleCountLabel.textContent = newCount;
    
    // Create new kernel with updated particle count
    calculateForces.destroy();
    calculateForces = createForceKernel(newCount);
    
    // Update particle count and reinitialize
    particleCount = newCount;
    scene.remove(particleSystem);
    initializeGeometry();
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

document.getElementById('simulation-method').addEventListener('change', (e) => {
    simulationMethod = e.target.value;
    
    // Reset grid when switching methods
    if (simulationMethod === 'spatial') {
        grid = new SpatialGrid(100, 10);
    }
});

// Initialize BufferGeometry
function initializeGeometry() {
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 10;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 10;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 10;

        velocities[i * 3] = (Math.random() - 0.5) * 0.1;
        velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.1;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
    }

    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
}

function initializeParticleSystem() {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            pointSize: { value: 3.0 }
        },
        vertexShader: `
            uniform float pointSize;
            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = pointSize;
            }
        `,
        fragmentShader: `
            void main() {
                gl_FragColor = vec4(1.0);
            }
        `,
        transparent: true,
    });

    particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);
}

// Update Simulation
function simulate(deltaTime) {
    const positions = geometry.attributes.position.array;
    const velocities = geometry.attributes.velocity.array;

    // Calculate forces based on selected method
    const forces = simulationMethod === 'direct' 
        ? calculateForces(positions, gravitationalConstant)
        : calculateForcesSpatial(positions, velocities, gravitationalConstant);

    // Update positions and velocities
    for (let i = 0; i < particleCount; i++) {
        // Handle forces based on simulation method
        const fx = simulationMethod === 'direct' ? forces[i][0] : forces[i * 3];
        const fy = simulationMethod === 'direct' ? forces[i][1] : forces[i * 3 + 1];
        const fz = simulationMethod === 'direct' ? forces[i][2] : forces[i * 3 + 2];

        velocities[i * 3] += fx * deltaTime;
        velocities[i * 3 + 1] += fy * deltaTime;
        velocities[i * 3 + 2] += fz * deltaTime;

        positions[i * 3] += velocities[i * 3] * deltaTime;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * deltaTime;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * deltaTime;
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.velocity.needsUpdate = true;
}

// FPS counter
let frameCount = 0;
let lastTime = performance.now();
const fpsElement = document.getElementById('fps-value');

function updateFPS() {
    frameCount++;
    const currentTime = performance.now();
    
    if (currentTime - lastTime > 500) {
        const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
        fpsElement.textContent = fps;
        frameCount = 0;
        lastTime = currentTime;
    }
}

function animate() {
    requestAnimationFrame(animate);
    
    updateFPS();
    controls.update();
    
    const distance = camera.position.length();
    const cameraDistanceElement = document.getElementById('camera-distance');
    if (cameraDistanceElement) {
        cameraDistanceElement.textContent = distance.toFixed(2);
    }
    
    const material = particleSystem.material;
    material.uniforms.pointSize = { value: Math.max(1, 30 / distance) };
    
    simulate(deltaTime);
    renderer.render(scene, camera);
}

// Initialize and start animation
initializeGeometry();
initializeParticleSystem();
animate();

// Cleanup on window unload
window.addEventListener('unload', () => {
    calculateForces.destroy();
});