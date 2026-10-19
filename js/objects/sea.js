import * as THREE from 'three/webgpu';
import { wgslFn, uniform, uv, attribute, positionLocal, sin, cos, vec3, mix, smoothstep, floor, color, colorSpaceToWorking } from 'three/tsl';

import seaShader from '../shaders/sea/fragment.wgsl?raw';
import { terrainHeight } from './island.js';

const SEA_RADIUS = 30;
const WALL_DEPTH = 2.7;

const DEEP = color(0x1d6f8f);
const MID = color(0x2f9bbd);
const LIGHT = color(0x7fd3e2);
const FOAM = color(0xd9f3f6);
const WALL_TOP = color(0x22789a);
const WALL_BOTTOM = color(0x0c3448);

const createSurfaceGeometry = () => {
  const grid = new THREE.PlaneGeometry(SEA_RADIUS * 2 + 2, SEA_RADIUS * 2 + 2, 48, 48);
  grid.rotateX(-Math.PI / 2);
  const position = grid.attributes.position;
  for (let i = 0; i < position.count; i++) {
    let x = position.getX(i) + Math.sin(i * 12.9898) * 0.35;
    let z = position.getZ(i) + Math.sin(i * 78.233) * 0.35;
    const r = Math.hypot(x, z);
    if (r > SEA_RADIUS) {
      x *= SEA_RADIUS / r;
      z *= SEA_RADIUS / r;
    }
    position.setXYZ(i, x, 0, z);
  }

  const geometry = grid.toNonIndexed();
  const flat = geometry.attributes.position;
  const centers = new Float32Array(flat.count * 3);
  const shore = new Float32Array(flat.count);
  for (let i = 0; i < flat.count; i += 3) {
    const x = (flat.getX(i) + flat.getX(i + 1) + flat.getX(i + 2)) / 3;
    const z = (flat.getZ(i) + flat.getZ(i + 1) + flat.getZ(i + 2)) / 3;
    const depth = terrainHeight(x, z);
    const speckle = Math.abs(Math.sin(x * 37.1 + z * 91.7)) < 0.4;
    const foam = depth > -0.4 || (depth > -0.8 && speckle) ? 1 : 0;
    for (let k = 0; k < 3; k++) {
      centers.set([x, 0, z], (i + k) * 3);
      shore[i + k] = foam;
    }
  }
  geometry.setAttribute('center', new THREE.BufferAttribute(centers, 3));
  geometry.setAttribute('shore', new THREE.BufferAttribute(shore, 1));
  return geometry;
};

export const createSea = () => {
  const uniforms = {
    time: uniform(0),
    waveHeight: uniform(0.25),
    iTime: uniform(0),
    iResolution: uniform(new THREE.Vector2(1, 1)),
    glints: uniform(1),
    night: uniform(0),
  };

  const p = positionLocal;
  const t = uniforms.time;
  const wave = sin(p.x.mul(0.32).add(t.mul(0.8))).mul(cos(p.z.mul(0.28).add(t.mul(0.6))))
    .add(sin(p.x.add(p.z).mul(0.55).add(t.mul(1.2))).mul(0.3))
    .mul(uniforms.waveHeight);

  const center = attribute('center', 'vec3');
  const sea = wgslFn(seaShader);
  const caustic = colorSpaceToWorking(sea({
    fragCoord: center.xz.div(SEA_RADIUS * 2).add(0.5).mul(7.0).fract().mul(uniforms.iResolution),
    iResolution: uniforms.iResolution,
    iTime: uniforms.iTime,
    glints: uniforms.glints,
  }), THREE.SRGBColorSpace);
  const glint = caustic.r;
  const banded = mix(mix(DEEP, MID, smoothstep(0.0, 0.12, glint)), LIGHT, smoothstep(0.15, 0.6, glint));
  const surfaceColor = mix(banded, FOAM, attribute('shore', 'float'));

  const material = new THREE.MeshStandardNodeMaterial({ flatShading: true, roughness: 0.45, metalness: 0 });
  material.positionNode = vec3(p.x, p.y.add(wave), p.z);
  material.colorNode = surfaceColor;
  material.emissiveNode = surfaceColor.mul(uniforms.night.mul(0.12));

  const surface = new THREE.Mesh(createSurfaceGeometry(), material);
  surface.receiveShadow = true;

  const wallGeometry = new THREE.CylinderGeometry(SEA_RADIUS, SEA_RADIUS, WALL_DEPTH, 48, 3, true).toNonIndexed();
  wallGeometry.translate(0, -WALL_DEPTH / 2, 0);
  const wallMaterial = new THREE.MeshStandardNodeMaterial({ flatShading: true, roughness: 0.6, side: THREE.DoubleSide });
  wallMaterial.positionNode = vec3(p.x, p.y.add(wave.mul(p.y.div(WALL_DEPTH).add(1))), p.z);
  const wallColor = mix(WALL_BOTTOM, WALL_TOP, floor(uv().y.mul(3.0).add(0.5)).div(3.0));
  wallMaterial.colorNode = wallColor;
  wallMaterial.emissiveNode = wallColor.mul(uniforms.night.mul(0.12));

  const mesh = new THREE.Group();
  mesh.add(surface);
  mesh.add(new THREE.Mesh(wallGeometry, wallMaterial));

  const update = (deltaTime, mouse, day, wind) => {
    uniforms.time.value += deltaTime * (1 + wind * 1.5);
    uniforms.waveHeight.value = 0.32 + wind * 0.15;
    uniforms.iTime.value += deltaTime * (0.05 + mouse.x * 0.35 + wind * 0.2);
    const glintsTarget = 0.55 + (1 - mouse.y) * 0.45;
    uniforms.glints.value += (glintsTarget - uniforms.glints.value) * Math.min(1, deltaTime * 3);
    uniforms.night.value = 1 - day;
  };

  const getHeight = (x, z) => {
    const time = uniforms.time.value;
    const height = Math.sin(x * 0.32 + time * 0.8) * Math.cos(z * 0.28 + time * 0.6)
      + Math.sin((x + z) * 0.55 + time * 1.2) * 0.3;
    return height * uniforms.waveHeight.value;
  };

  return {
    mesh,
    update,
    getHeight,
  };
};
