import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GPU } from 'gpu.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// Initialize variables
let particleCount = 30000;
let deltaTime = 0.001;
let gravitationalConstant = 0.8;
let particleSystem, geometry;
let interactionRate = 1;

let blackHoleMass = 100; // Mass of the black hole relative to particles
const blackHolePosition = new THREE.Vector3(0, 0, 0); // Center of the galaxy

let composer;
const bloomParams = {
    exposure: 0,
    bloomStrength: 0,
    bloomThreshold: 0,
    bloomRadius: 0,
};

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

// Setup post-processing
const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    bloomParams.bloomStrength,
    bloomParams.bloomRadius,
    bloomParams.bloomThreshold
);

composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// Update renderer and composer on window resize
function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
    composer.setSize(width, height);
}

// Add window resize handler
window.addEventListener('resize', onWindowResize, false);

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
    return gpu.createKernel(function (positions, velocities, G, blackHoleForce, interactionRate) {
        const i = this.thread.x;
        const px = positions[i * 3];
        const py = positions[i * 3 + 1];
        const pz = positions[i * 3 + 2];

        const epsilon = 0.1; // Softening parameter
        let fx = 0, fy = 0, fz = 0;

        // Black hole force calculation
        const dx_bh = 0 - px;
        const dy_bh = 0 - py;
        const dz_bh = 0 - pz;

        const dist_bh = Math.sqrt(dx_bh * dx_bh + dy_bh * dy_bh + dz_bh * dz_bh) + epsilon;
        const force_bh = (G * blackHoleForce) / (dist_bh * dist_bh);

        fx += force_bh * dx_bh / dist_bh;
        fy += force_bh * dy_bh / dist_bh;
        fz += force_bh * dz_bh / dist_bh;

        // Limit interactions based on interactionRate
        const interactionLimit = Math.floor(this.constants.particleCount * interactionRate);

        for (let j = 0; j < interactionLimit; j++) {
            if (i === j) continue;

            const dx = positions[j * 3] - px;
            const dy = positions[j * 3 + 1] - py;
            const dz = positions[j * 3 + 2] - pz;

            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) + epsilon;
            let force = G / (distance * distance);

            force = Math.min(force, 15.0); // Cap maximum force
            fx += force * dx / distance;
            fy += force * dy / distance;
            fz += force * dz / distance;
        }

        return [fx, fy, fz];
    })
        .setOutput([count])
        .setConstants({
            particleCount: count,
            blackHoleMass: blackHoleMass,
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

document.getElementById('preset-selector').addEventListener('change', (e) => {
    currentPreset = e.target.value;
    scene.remove(particleSystem);
    initializeGeometry();
    initializeParticleSystem();
});

const PRESETS = {
    SPIRAL_GALAXY: 'spiral-galaxy',
    DISK_GALAXY: 'disk-galaxy',
    ELLIPTICAL_GALAXY: 'elliptical-galaxy',
    DOUBLE_SPIRAL_GALAXY: 'double-spiral-galaxy',
    UNIVERSE: 'universe',
    GALAXY_COLLISION: 'galaxy-collision',
    // Add more presets as needed
};

let currentPreset = PRESETS.SPIRAL_GALAXY;

// Function to handle different initialization patterns
function initializeParticlesByPreset(preset) {
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const accelerations = new Float32Array(particleCount * 3);

    switch(preset) {
        case PRESETS.SPIRAL_GALAXY:
            particleCount = 30000
            interactionRate = 0.8;

            const radius = 6; // Galaxy radius
            const height = 3; // Galaxy height
            const maxVel = 15; // Initial rotation speed
            const middleVelocity = 2; // Center rotation speed
        
            for (let i = 0; i < particleCount; i++) {
                let x, y, z, vx, vy, vz, rr;
        
                if (i === 0) {
                    // Black hole at the origin
                    x = 0;
                    y = 0;
                    z = 0;
                    vx = 0;
                    vy = 0;
                    vz = 0;
                } else {
                    // Generate random position within a radius
                    do {
                        x = (Math.random() * 2 - 1);
                        z = (Math.random() * 2 - 1);
                        rr = x * x + z * z;
                    } while (rr > 1);
        
                    rr = Math.sqrt(rr);
                    const rExp = radius * Math.pow(rr, middleVelocity * 0.5); // Concentrate near the center
        
                    // Set position
                    x *= rExp;
                    z *= rExp;
                    y = (Math.random() * 2 - 1) * height * (1 - rr); // Larger vertical spread near the center
        
                    // Generate velocity
                    const vel = maxVel * Math.pow(rr, 0.3); // Slower falloff near the center
        
                    vx = vel * z + (Math.random() * 2 - 1) * 0.001; // Tangential velocity
                    vy = (Math.random() * 2 - 1) * 0.01; // Moderate vertical velocity
                    vz = -vel * x + (Math.random() * 2 - 1) * 0.001;
                }
                positions[i * 3] = x;
                positions[i * 3 + 1] = y;
                positions[i * 3 + 2] = z;

                velocities[i * 3] = vx;
                velocities[i * 3 + 1] = vy;
                velocities[i * 3 + 2] = vz;

                accelerations[i * 3] = 0;
                accelerations[i * 3 + 1] = 0;
                accelerations[i * 3 + 2] = 0;
            }
            break;

        case PRESETS.DISK_GALAXY:
            particleCount = 30000
            interactionRate = 0.8;

            // Flat disk galaxy
            const diskRadius = 10;
            const diskHeight = 0.5;
            const diskVel = 12;

            for (let i = 0; i < particleCount; i++) {
                if (i === 0) {
                    // Black hole at center
                    positions[0] = 0; positions[1] = 0; positions[2] = 0;
                    velocities[0] = 0; velocities[1] = 0; velocities[2] = 0;
                } else {
                    // Generate particles in a thin disk
                    const r = Math.sqrt(Math.random()) * diskRadius;
                    const theta = Math.random() * 2 * Math.PI;
                    
                    positions[i * 3] = r * Math.cos(theta);
                    positions[i * 3 + 1] = (Math.random() - 0.5) * diskHeight;
                    positions[i * 3 + 2] = r * Math.sin(theta);

                    // Circular orbits
                    const speed = diskVel * Math.sqrt(1/r);
                    velocities[i * 3] = -speed * Math.sin(theta);
                    velocities[i * 3 + 1] = 0;
                    velocities[i * 3 + 2] = speed * Math.cos(theta);
                }
                
                // Initialize accelerations to zero
                accelerations[i * 3] = 0;
                accelerations[i * 3 + 1] = 0;
                accelerations[i * 3 + 2] = 0;
            }
            break;

        case PRESETS.ELLIPTICAL_GALAXY: 
            particleCount = 30000
            interactionRate = 0.8;

            // Elliptical galaxy
            const ellipRadius = 8;
            const ellipVel = 8;

            for (let i = 0; i < particleCount; i++) {
                if (i === 0) {
                    // Black hole at center
                    positions[0] = 0; positions[1] = 0; positions[2] = 0;
                    velocities[0] = 0; velocities[1] = 0; velocities[2] = 0;
                } else {
                    // Generate particles in an ellipsoid
                    const u = Math.random() * 2 * Math.PI;
                    const v = Math.random() * Math.PI;
                    const r = Math.pow(Math.random(), 1/3) * ellipRadius;

                    positions[i * 3] = r * Math.sin(v) * Math.cos(u);
                    positions[i * 3 + 1] = r * Math.sin(v) * Math.sin(u) * 0.7; // Squashed in y
                    positions[i * 3 + 2] = r * Math.cos(v);

                    // Random velocities with some overall rotation
                    const speed = ellipVel * (1 - Math.sqrt(r/ellipRadius));
                    velocities[i * 3] = (Math.random() - 0.5) * speed;
                    velocities[i * 3 + 1] = (Math.random() - 0.5) * speed;
                    velocities[i * 3 + 2] = (Math.random() - 0.5) * speed;
                }
                
                accelerations[i * 3] = 0;
                accelerations[i * 3 + 1] = 0;
                accelerations[i * 3 + 2] = 0;
            }
            break;
        

        case PRESETS.DOUBLE_SPIRAL_GALAXY: 

            particleCount = 30000
            interactionRate = 0.8;
    
            const radius1 = 8;      // Overall galaxy radius
            const armWidth = 0.8;  // Width of the spiral arms
            const pitch = 15;      // Controls how tightly wound the spiral is
            const numArms = 2;     // Number of spiral arms
            const height1 = 0.3;    // Vertical thickness of the galaxy
            const maxVel1 = 12;     // Maximum rotation velocity

            for (let i = 0; i < particleCount; i++) {
                if (i === 0) {
                    // Central black hole
                    positions[i * 3] = 0;
                    positions[i * 3 + 1] = 0;
                    positions[i * 3 + 2] = 0;
                    velocities[i * 3] = 0;
                    velocities[i * 3 + 1] = 0;
                    velocities[i * 3 + 2] = 0;
                } else {
                    // Generate spiral pattern
                    const r = Math.pow(Math.random(), 0.5) * radius1;  // Radial distance
                    const armAngle = (Math.PI * 2 / numArms);        // Angle between arms
                    const arm = Math.floor(Math.random() * numArms);  // Which arm
                    
                    // Logarithmic spiral formula
                    const baseAngle = (arm * armAngle) + (r / radius1) * pitch;
                    
                    // Add some random spread to create arm width
                    const spread = (Math.random() - 0.5) * armWidth * (1 - Math.pow(r/radius1, 2));
                    const angle = baseAngle + spread;

                    // Calculate positions
                    positions[i * 3] = r * Math.cos(angle);
                    positions[i * 3 + 2] = r * Math.sin(angle);
                    
                    // Height distribution (thinner at edges)
                    const heightScale = Math.pow(1 - r/radius1, 0.5);
                    positions[i * 3 + 1] = (Math.random() - 0.5) * height1 * heightScale;

                    // Calculate velocities (primarily tangential for rotation)
                    const speed = maxVel1 * Math.sqrt(r/radius1);  // Keplerian-ish rotation
                    velocities[i * 3] = -speed * Math.sin(angle);
                    velocities[i * 3 + 2] = speed * Math.cos(angle);
                    
                    // Small random vertical velocity
                    velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.1;

                    // Add some velocity dispersion for more natural motion
                    velocities[i * 3] += (Math.random() - 0.5) * 0.5;
                    velocities[i * 3 + 2] += (Math.random() - 0.5) * 0.5;
                }

                // Initialize accelerations to zero
                accelerations[i * 3] = 0;
                accelerations[i * 3 + 1] = 0;
                accelerations[i * 3 + 2] = 0;
            }
            break;
        
        case PRESETS.UNIVERSE:            
            // Universe parameters
            const universeRadius = 2;  // Smaller radius since we're using different scale
            const pulseScale = 3.18;   // Initial expansion rate            
            blackHoleMass = 0;  // No central black hole in universe simulation
            interactionRate = 0.05
            gravitationalConstant = 1.0;
            deltaTime = 0.004;

            // document.getElementById('particle-slider').value = particleCount;
            // document.getElementById('particle-count').textContent = particleCount;

            document.getElementById('blackhole-mass').value = blackHoleMass;
            document.getElementById('blackhole-mass-value').textContent = blackHoleMass;

            document.getElementById('g-slider').value = gravitationalConstant;
            document.getElementById('g-value').textContent = gravitationalConstant;
            
            for (let i = 0; i < particleCount; i++) {
                // Generate random point within a unit sphere
                let x, y, z;
                do {
                    x = (Math.random() * 2 - 1);
                    y = (Math.random() * 2 - 1);
                    z = (Math.random() * 2 - 1);
                } while (x*x + y*y + z*z > 1);
    
                // Scale points to desired radius
                x *= universeRadius;
                y *= universeRadius;
                z *= universeRadius;
    
                // Calculate velocities (expanding universe)
                const vx = pulseScale * x;
                const vy = pulseScale * y;
                const vz = pulseScale * z;
    
                // Set positions
                positions[i * 3] = x;
                positions[i * 3 + 1] = y;
                positions[i * 3 + 2] = z;
    
                // Set velocities
                velocities[i * 3] = vx;
                velocities[i * 3 + 1] = vy;
                velocities[i * 3 + 2] = vz;
    
                // Initialize accelerations
                accelerations[i * 3] = 0;
                accelerations[i * 3 + 1] = 0;
                accelerations[i * 3 + 2] = 0;
            }  
            break;
            
        case PRESETS.GALAXY_COLLISION:
            
            const radius2 = 3;
            const height2 = 3;
            const maxVel2 = 20;
            const middleVelocity2 = 2;

            const radius3 = 8;
            const height3 = 0.5;
            const maxVel3 = 15;

            // Collision parameters
            const separation = 6;  // Distance between galaxies (reduced from 40)
            const initialVelocity = 8;  // Increased from 2
            
            // Position offsets (now centered around 0)
            const galaxy1X = -separation/2;  // Left galaxy at -7.5
            const galaxy1Y = 0;
            const galaxy2X = separation/2;   // Right galaxy at +7.5
            const galaxy2Y = 5;  // Slight y offset for interesting collision

            const halfCount = Math.floor(particleCount / 2);

            for (let i = 0; i < particleCount; i++) {
                if (i < halfCount) {
                    // First galaxy (Spiral)
                    if (i === 0) {
                        // First black hole
                        positions[i * 3] = galaxy1X;
                        positions[i * 3 + 1] = galaxy1Y;
                        positions[i * 3 + 2] = 0;
                        velocities[i * 3] = initialVelocity;
                        velocities[i * 3 + 1] = 0;
                        velocities[i * 3 + 2] = 0;
                    } else {
                        let x, y, z, vx, vy, vz, rr;
                        
                        do {
                            x = (Math.random() * 2 - 1);
                            z = (Math.random() * 2 - 1);
                            rr = x * x + z * z;
                        } while (rr > 1);

                        rr = Math.sqrt(rr);
                        const rExp = radius2 * Math.pow(rr, middleVelocity2 * 0.5);

                        x = (x * rExp) + galaxy1X;  // Offset from center
                        z *= rExp;
                        y = (Math.random() * 2 - 1) * height2 * (1 - rr) + galaxy1Y;

                        const vel = maxVel2 * Math.pow(rr, 0.3);
                        vx = vel * z + (Math.random() * 2 - 1) * 0.001 + initialVelocity;
                        vy = (Math.random() * 2 - 1) * 0.01;
                        vz = -vel * x + (Math.random() * 2 - 1) * 0.001;

                        positions[i * 3] = x;
                        positions[i * 3 + 1] = y;
                        positions[i * 3 + 2] = z;
                        velocities[i * 3] = vx;
                        velocities[i * 3 + 1] = vy;
                        velocities[i * 3 + 2] = vz;
                    }
                } else {
                    // Second galaxy (Disk)
                    if (i === halfCount) {
                        // Second black hole
                        positions[i * 3] = galaxy2X;
                        positions[i * 3 + 1] = galaxy2Y;
                        positions[i * 3 + 2] = 0;
                        velocities[i * 3] = -initialVelocity;
                        velocities[i * 3 + 1] = -0.5;
                        velocities[i * 3 + 2] = 0;
                    } else {
                        const r = Math.sqrt(Math.random()) * radius3;
                        const theta = Math.random() * 2 * Math.PI;

                        const x = (r * Math.cos(theta)) + galaxy2X;
                        const y = (r * Math.sin(theta)) + galaxy2Y;
                        const z = (Math.random() - 0.5) * height3;

                        const speed = maxVel3 * Math.sqrt(1/r);
                        const vx = -speed * Math.sin(theta) - initialVelocity;
                        const vy = speed * Math.cos(theta) - 0.5;
                        const vz = 0;

                        positions[i * 3] = x;
                        positions[i * 3 + 1] = y;
                        positions[i * 3 + 2] = z;
                        velocities[i * 3] = vx;
                        velocities[i * 3 + 1] = vy;
                        velocities[i * 3 + 2] = vz;
                    }
                }

                accelerations[i * 3] = 0;
                accelerations[i * 3 + 1] = 0;
                accelerations[i * 3 + 2] = 0;
            }
        
        break;
        
        
    }    
               
        

        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('acceleration', new THREE.BufferAttribute(accelerations, 3));
}

    


function initializeGeometry() {
    initializeParticlesByPreset(currentPreset);
}


function initializeParticleSystem() {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            pointSize: { value: 3.0 } // Initial point size (will be dynamically updated)
        },
        vertexShader: `
            uniform float pointSize;
            attribute vec3 acceleration; 
            varying vec3 vAcceleration;  
    
            void main() {
                vAcceleration = acceleration; 
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = pointSize * 2.0; 
            }
        `,
        fragmentShader: `
            varying vec3 vAcceleration; 
    
            vec3 getColorFromAcceleration(float acc) {
                vec3 lowAccelerationColor = vec3(0.012, 0.063, 0.988);   
                vec3 highAccelerationColor = vec3(1.0, 0.376, 0.188);    
    
                float normalizedAcc = clamp(acc / 1.0, 0.0, 1.0); 
                return mix(lowAccelerationColor, highAccelerationColor, normalizedAcc);
            }
    
            void main() {
                float r = length(gl_PointCoord - vec2(0.5)); 
                if (r > 0.5) discard; 
    
                float intensity = 1.0 - (r * r * 4.0);
                intensity = clamp(intensity, 0.4, 1.0);
    
                float acc = length(vAcceleration); 
                vec3 color = getColorFromAcceleration(acc); 
    
                gl_FragColor = vec4(color, intensity); 
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending, // Additive blending for glow
        depthWrite: false // Disable depth writing for transparency
    });
    

    particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);
}

function simulate(deltaTime) {
    const positions = geometry.attributes.position.array;
    const velocities = geometry.attributes.velocity.array;
    const accelerations = geometry.attributes.acceleration.array;

    if (simulationMethod === 'direct') {
        // Calculate forces using GPU
        const forces = calculateForces(positions, velocities, gravitationalConstant, blackHoleMass, interactionRate);
        
        // Update velocities and positions on CPU
        for (let i = 0; i < particleCount; i++) {
            accelerations[i * 3] = forces[i][0];
            accelerations[i * 3 + 1] = forces[i][1];
            accelerations[i * 3 + 2] = forces[i][2];

            velocities[i * 3] += forces[i][0] * deltaTime;
            velocities[i * 3 + 1] += forces[i][1] * deltaTime;
            velocities[i * 3 + 2] += forces[i][2] * deltaTime;

            positions[i * 3] += velocities[i * 3] * deltaTime;
            positions[i * 3 + 1] += velocities[i * 3 + 1] * deltaTime;
            positions[i * 3 + 2] += velocities[i * 3 + 2] * deltaTime;
        }
    } else {
        // Spatial partitioning method remains the same
        const forces = calculateForcesSpatial(positions, velocities, gravitationalConstant);
        
        for (let i = 0; i < particleCount; i++) {
            accelerations[i * 3] = forces[i][0];
            accelerations[i * 3 + 1] = forces[i][1];
            accelerations[i * 3 + 2] = forces[i][2];

            velocities[i * 3] += forces[i * 3] * deltaTime;
            velocities[i * 3 + 1] += forces[i * 3 + 1] * deltaTime;
            velocities[i * 3 + 2] += forces[i * 3 + 2] * deltaTime;

            positions[i * 3] += velocities[i * 3] * deltaTime;
            positions[i * 3 + 1] += velocities[i * 3 + 1] * deltaTime;
            positions[i * 3 + 2] += velocities[i * 3 + 2] * deltaTime;
        }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.velocity.needsUpdate = true;
    geometry.attributes.acceleration.needsUpdate = true;

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

    console.log(blackHoleMass);
    console.log(particleCount);
    console.log(deltaTime)
    
    const distance = camera.position.length();
    const material = particleSystem.material;
    material.uniforms.pointSize.value = Math.min(Math.max(1, 30 / distance), 1);

    
    simulate(deltaTime);
    composer.render(scene, camera);
}


// Initialize and start animation
initializeGeometry();
initializeParticleSystem();
animate();

// Cleanup on window unload
window.addEventListener('unload', () => {
    calculateForces.destroy();
});