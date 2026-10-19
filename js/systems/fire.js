import * as THREE from 'three/webgpu';
import { wgslFn, uniform, positionLocal, positionWorld, sin, vec3, colorSpaceToWorking } from 'three/tsl';

import fireShader from '../shaders/fire/fragment.wgsl?raw';

const BURN_TIME = 7;
const AFTER_COLLAPSE = 2.5;
const FLAME_COUNT = 9;
const FLAME_HEIGHT = 0.9;
const SMOKE_COUNT = 9;

const flameGeometry = new THREE.ConeGeometry(0.24, FLAME_HEIGHT, 6, 4);
flameGeometry.translate(0, FLAME_HEIGHT / 2, 0);
const smokeGeometry = new THREE.IcosahedronGeometry(0.22, 0);

const fireTime = uniform(0);
const height = positionLocal.y.div(FLAME_HEIGHT);
const wobble = sin(fireTime.mul(11.0).add(positionWorld.x.mul(7.0)).add(positionWorld.z.mul(5.0))).mul(height).mul(0.06);
const stretch = sin(fireTime.mul(8.0).add(positionWorld.x.mul(13.0))).mul(0.18).add(1.0);
const flameMaterial = new THREE.MeshBasicNodeMaterial();
flameMaterial.positionNode = vec3(positionLocal.x.add(wobble), positionLocal.y.mul(stretch), positionLocal.z.add(wobble));
flameMaterial.colorNode = colorSpaceToWorking(wgslFn(fireShader)({ height, worldPos: positionWorld, time: fireTime }), THREE.SRGBColorSpace);

const box = new THREE.Box3();
const top = new THREE.Vector3();
const size = new THREE.Vector3();

export const createFire = (scene, breakables) => {
  const fires = [];

  const ignite = (record, now) => {
    if (fires.some((fire) => fire.record === record)) return;

    const group = new THREE.Group();
    const flames = [];
    for (let i = 0; i < FLAME_COUNT; i++) {
      const flame = new THREE.Mesh(flameGeometry, flameMaterial);
      flame.userData.offset = new THREE.Vector3((Math.random() - 0.5) * 1.1, Math.random() * 0.2 - 0.15, (Math.random() - 0.5) * 1.1);
      flame.userData.size = 0.7 + Math.random() * 0.6;
      flame.userData.phase = Math.random() * Math.PI * 2;
      group.add(flame);
      flames.push(flame);
    }

    const smokeMaterial = new THREE.MeshBasicMaterial({ color: 0x3a3a3f, transparent: true, opacity: 0.6, depthWrite: false });
    const smoke = [];
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const puff = new THREE.Mesh(smokeGeometry, smokeMaterial);
      puff.userData.age = (i / SMOKE_COUNT) * 2.5;
      puff.userData.drift = new THREE.Vector2((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4);
      group.add(puff);
      smoke.push(puff);
    }

    scene.add(group);
    fires.push({ record, group, flames, smoke, smokeMaterial, start: now, collapsedAt: null, strength: 0 });
  };

  const findTop = (record) => {
    box.makeEmpty();
    record.pieces.forEach((piece) => box.expandByObject(piece.mesh));
    box.getSize(size);
    box.getCenter(top);
    top.y = box.max.y - size.y * 0.15;
    return Math.max(0.6, Math.min(size.x, size.z));
  };

  const setChar = (record, amount) => {
    record.pieces.forEach((piece) => {
      if (piece.mesh.material && piece.mesh.material.userData.tint) piece.mesh.material.userData.char = amount;
    });
  };

  const remove = (fire) => {
    fire.group.removeFromParent();
    fire.smokeMaterial.dispose();
    fires.splice(fires.indexOf(fire), 1);
  };

  const update = (deltaTime, now) => {
    fireTime.value = now;
    [...fires].forEach((fire) => {
      const age = now - fire.start;
      const ending = fire.collapsedAt !== null ? 1 - (now - fire.collapsedAt) / AFTER_COLLAPSE : 1;
      fire.strength = Math.min(1, age * 2) * Math.max(0, ending);

      setChar(fire.record, Math.min(1, age / BURN_TIME));

      if (fire.collapsedAt === null && age > BURN_TIME) {
        breakables.collapse(fire.record);
        fire.collapsedAt = now;
      }

      const width = findTop(fire.record);
      fire.group.position.copy(top);

      fire.flames.forEach((flame) => {
        const flicker = 0.85 + Math.sin(now * 13 + flame.userData.phase) * 0.15;
        const scale = fire.strength * flame.userData.size;
        flame.position.copy(flame.userData.offset).multiplyScalar(width * 0.8);
        flame.scale.set(scale, scale * flicker, scale);
        flame.rotation.y = now * 2 + flame.userData.phase;
      });

      fire.smoke.forEach((puff) => {
        puff.userData.age = (puff.userData.age + deltaTime) % 2.5;
        const t = puff.userData.age / 2.5;
        puff.position.set(puff.userData.drift.x * t * 4, 0.4 + t * 3, puff.userData.drift.y * t * 4);
        puff.scale.setScalar((0.6 + t * 1.6) * Math.max(fire.strength, 0.001));
      });
      fire.smokeMaterial.opacity = 0.55 * fire.strength;

      if (ending <= 0) remove(fire);
    });
  };

  const isBurning = (record) => fires.some((fire) => fire.record === record);

  const extinguishAll = () => {
    [...fires].forEach((fire) => {
      setChar(fire.record, 0);
      remove(fire);
    });
  };

  return { ignite, update, isBurning, extinguishAll, setChar };
};
