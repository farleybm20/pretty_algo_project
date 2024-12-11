import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GPU } from 'gpu.js';

// Initialize variables
let particleCount = 100;
let deltaTime = 0.016;
let gravitationalConstant = 1;
let particleSystem, geometry;

let blackHoleMass = 1000; // Mass of the black hole relative to particles
const blackHolePosition = new THREE.Vector3(0, 0, 0); // Center of the galaxy

const gpu = new GPU();

// Create scene
const scene = new THREE.Scene();

// Create camera with improved settings for large zoom range
const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.01,
    1000000
);
camera.position.set(0, 0, 100);

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
controls.maxDistance = 1000000;
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

function createForceKernel(count) {
    return gpu.createKernel(function(positions, G) {
        const i = this.thread.x;
        const px = positions[i * 3];
        const py = positions[i * 3 + 1];
        const pz = positions[i * 3 + 2];
        
        // Black hole force calculation
        const dx_bh = 0 - px; // Black hole at origin
        const dy_bh = 0 - py;
        const dz_bh = 0 - pz;
        
        const dist_bh = Math.sqrt(dx_bh * dx_bh + dy_bh * dy_bh + dz_bh * dz_bh + 0.1);
        const force_bh = (G * this.constants.blackHoleMass) / (dist_bh * dist_bh);
        
        let fx = force_bh * dx_bh / dist_bh;
        let fy = force_bh * dy_bh / dist_bh;
        let fz = force_bh * dz_bh / dist_bh;
        
        // Forces from other particles
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
    .setConstants({ 
        particleCount: count,
        blackHoleMass: blackHoleMass 
    });
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

document.getElementById('blackhole-mass').addEventListener('input', (e) => {
    blackHoleMass = parseFloat(e.target.value);
    document.getElementById('blackhole-mass-value').textContent = blackHoleMass;
    
    // Update kernel with new black hole mass
    calculateForces.destroy();
    calculateForces = createForceKernel(particleCount);
});

// Modify initializeGeometry function to account for black hole
function initializeGeometry() {
    // Create a buffer geometry
    geometry = new THREE.BufferGeometry();

    // Create arrays using the global numberOfStars constant
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const uvs = new Float32Array(particleCount * 2);

    // Calculate matrix size for UV coordinates
    const matrixSize = Math.sqrt(particleCount);

    // Galaxy parameters from global constants
    const galaxyRadius = 100;  // Using the constant value
    const galaxyHeight = 5;    // Using the constant value
    const numArms = 2;
    const randomness = 0.2;
    
    // Generate particles
    for (let i = 0; i < particleCount; i++) {
        let x, y, z, vx, vy, vz;

        // Handle central black hole
        if (i === 0) {
            x = y = z = 0;
            vx = vy = vz = 0;
        } else {
            // Generate random angle and radius
            const angle = (i % numArms) * (2 * Math.PI / numArms) + 
                         (Math.random() * 2 - 1) * randomness;
            const r = Math.pow(Math.random(), 0.5) * galaxyRadius;
            
            // Add spiral arm effect
            const spiralAngle = angle + (r / galaxyRadius) * 2; // Using middleVelocity value of 2
            
            // Calculate positions
            x = r * Math.cos(spiralAngle);
            z = r * Math.sin(spiralAngle);
            y = (Math.random() * 2 - 1) * galaxyHeight * (r / galaxyRadius);

            // Calculate orbital velocities
            const orbitalSpeed = 15 * Math.sqrt(galaxyRadius / (r + 1)); // Using velocity value of 15
            vx = -orbitalSpeed * z / (r + 0.1);
            vz = orbitalSpeed * x / (r + 0.1);
            vy = 0;

            // Add small random velocity perturbations
            vx += (Math.random() - 0.5) * 0.3;
            vy += (Math.random() - 0.5) * 0.3;
            vz += (Math.random() - 0.5) * 0.3;
        }

        // Set positions
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        // Set velocities
        velocities[i * 3] = vx;
        velocities[i * 3 + 1] = vy;
        velocities[i * 3 + 2] = vz;

        // UV coordinates for pixel lookups in shaders
        uvs[i * 2] = (i % matrixSize) / (matrixSize - 1);
        uvs[i * 2 + 1] = Math.floor(i / matrixSize) / (matrixSize - 1);
    }

    // Set geometry attributes
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
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