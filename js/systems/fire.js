import * as THREE from 'three/webgpu';
import { wgslFn, uniform, positionLocal, positionWorld, sin, vec3, colorSpaceToWorking } from 'three/tsl';

import fireShader from '../shaders/fire/fragment.wgsl?raw';

const BURN_TIME = 7;
const AFTER_COLLAPSE = 2.5;
const DOUSE_TIME = 2.5;
const SPREAD_DISTANCE = 4;
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

export const createFire = (scene, breakables, { onDouse = () => {} } = {}) => {
  const fires = [];
  const scars = [];

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
    fires.push({ record, group, flames, smoke, smokeMaterial, start: now, collapsedAt: null, dousedAt: null, water: 0, nextSpread: 4, strength: 0, char: 0 });
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

  const centerOf = (record) => {
    const center = new THREE.Vector3();
    record.pieces.forEach((piece) => center.add(piece.home.position));
    return center.divideScalar(record.pieces.length);
  };

  const neighbourInDirection = (record, direction) => {
    const from = centerOf(record);
    let best = null;
    let bestDistance = SPREAD_DISTANCE;
    breakables.records.forEach((other) => {
      if (other === record || isBurning(other)) return;
      const offset = centerOf(other).sub(from).setY(0);
      const distance = offset.length();
      if (distance > bestDistance || distance < 0.1) return;
      if (direction && offset.normalize().dot(direction) < 0.3) return;
      best = other;
      bestDistance = distance;
    });
    return best;
  };

  const spread = (point, direction, now) => {
    fires.forEach((fire) => {
      if (fire.dousedAt !== null || fire.collapsedAt !== null) return;
      if (centerOf(fire.record).distanceTo(point) > 4) return;
      const target = neighbourInDirection(fire.record, direction);
      if (target) ignite(target, now);
    });
  };

  const update = (deltaTime, now, rain, wind) => {
    fireTime.value = now;

    [...scars].forEach((scar) => {
      scar.amount = Math.max(0, scar.amount - deltaTime * 0.4);
      setChar(scar.record, scar.amount);
      if (scar.amount <= 0) scars.splice(scars.indexOf(scar), 1);
    });

    [...fires].forEach((fire) => {
      const age = now - fire.start;
      if (fire.dousedAt === null && fire.collapsedAt === null && rain > 0.25) {
        fire.water += deltaTime * rain;
        if (fire.water > DOUSE_TIME * 0.6) {
          fire.dousedAt = now;
          onDouse();
        }
      }

      let ending = 1;
      if (fire.collapsedAt !== null) ending = 1 - (now - fire.collapsedAt) / AFTER_COLLAPSE;
      if (fire.dousedAt !== null) ending = 1 - (now - fire.dousedAt) / DOUSE_TIME;
      fire.strength = Math.min(1, age * 2) * Math.max(0, ending);

      if (fire.dousedAt === null) fire.char = Math.min(1, age / BURN_TIME);
      setChar(fire.record, fire.char);

      if (wind.length() > 4.5 && fire.dousedAt === null && fire.collapsedAt === null) {
        fire.nextSpread -= deltaTime;
        if (fire.nextSpread <= 0) {
          fire.nextSpread = 4;
          const target = neighbourInDirection(fire.record, new THREE.Vector3(wind.x, 0, wind.y).normalize());
          if (target) ignite(target, now);
        }
      }

      if (fire.dousedAt === null && fire.collapsedAt === null && age > BURN_TIME) {
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

      if (ending <= 0) {
        if (fire.dousedAt !== null) scars.push({ record: fire.record, amount: fire.char });
        remove(fire);
      }
    });
  };

  const isBurning = (record) => fires.some((fire) => fire.record === record);

  const extinguishAll = () => {
    [...fires].forEach((fire) => {
      setChar(fire.record, 0);
      remove(fire);
    });
    scars.forEach((scar) => setChar(scar.record, 0));
    scars.length = 0;
  };

  const getLevel = () => Math.min(1.5, fires.reduce((sum, fire) => sum + fire.strength, 0));

  return { ignite, spread, update, isBurning, extinguishAll, setChar, getLevel };
};
