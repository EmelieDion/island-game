import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { terrainHeight, VILLAGE } from './island.js';

const COUNT = 6;
const HEIGHT = 0.55;
const WALK_SPEED = 0.55;
const HOUSE_SPACE = 1.05;

const findClip = (clips, name) => clips.find((clip) => clip.name.endsWith(`|${name}`));

const findStreets = (houses) => {
  const streets = [];
  for (let x = -5; x <= 5; x += 0.35) {
    for (let z = -5; z <= 5; z += 0.35) {
      const px = VILLAGE.x + x;
      const pz = VILLAGE.y + z;
      if (Math.hypot(x, z) > 4.6) continue;
      if (terrainHeight(px, pz) < 0.5) continue;
      if (houses.some((house) => Math.hypot(house.x - px, house.y - pz) < HOUSE_SPACE)) continue;
      streets.push(new THREE.Vector2(px, pz));
    }
  }
  return streets;
};

const isClearPath = (from, to, houses) => {
  for (let t = 0.2; t < 1; t += 0.2) {
    const x = from.x + (to.x - from.x) * t;
    const z = from.y + (to.y - from.y) * t;
    if (houses.some((house) => Math.hypot(house.x - x, house.y - z) < HOUSE_SPACE * 0.85)) return false;
  }
  return true;
};

export const loadVillagers = async (scene, houses) => {
  const loader = new GLTFLoader();
  const models = await Promise.all(['assets/worker.glb', 'assets/farmer.glb'].map((url) => loader.loadAsync(url)));
  const streets = findStreets(houses);
  const villagers = [];

  for (let i = 0; i < COUNT; i++) {
    const model = models[i % models.length];
    const body = clone(model.scene);
    body.traverse((child) => {
      if (child.isMesh) child.castShadow = true;
    });

    body.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3());
    body.scale.multiplyScalar(HEIGHT / size.y);

    const root = new THREE.Group();
    root.add(body);
    scene.add(root);

    const mixer = new THREE.AnimationMixer(body);
    const actions = {
      idle: mixer.clipAction(findClip(model.animations, 'Idle')),
      walk: mixer.clipAction(findClip(model.animations, 'Walk')),
    };
    actions.idle.play();

    const start = streets[Math.floor(Math.random() * streets.length)];
    root.position.set(start.x, terrainHeight(start.x, start.y), start.y);
    root.rotation.y = Math.random() * Math.PI * 2;

    villagers.push({ root, mixer, actions, current: 'idle', target: null, wait: Math.random() * 3 });
  }

  const play = (villager, name) => {
    if (villager.current === name) return;
    villager.actions[name].reset().fadeIn(0.25).play();
    villager.actions[villager.current].fadeOut(0.25);
    villager.current = name;
  };

  const chooseTarget = (villager) => {
    const here = new THREE.Vector2(villager.root.position.x, villager.root.position.z);
    const options = streets.filter((spot) => {
      const distance = spot.distanceTo(here);
      return distance > 0.8 && distance < 2.6 && isClearPath(here, spot, houses);
    });
    return options.length ? options[Math.floor(Math.random() * options.length)] : null;
  };

  const turnTowards = (villager, angle, deltaTime) => {
    let difference = angle - villager.root.rotation.y;
    difference = Math.atan2(Math.sin(difference), Math.cos(difference));
    villager.root.rotation.y += difference * Math.min(1, deltaTime * 8);
  };

  const update = (deltaTime) => {
    villagers.forEach((villager) => {
      villager.mixer.update(deltaTime);

      if (!villager.target) {
        villager.wait -= deltaTime;
        if (villager.wait > 0) return;
        villager.target = chooseTarget(villager);
        if (!villager.target) {
          villager.wait = 1;
          return;
        }
        play(villager, 'walk');
      }

      const position = villager.root.position;
      const dx = villager.target.x - position.x;
      const dz = villager.target.y - position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.05) {
        villager.target = null;
        villager.wait = 1.5 + Math.random() * 3;
        play(villager, 'idle');
        return;
      }

      const step = Math.min(distance, WALK_SPEED * deltaTime);
      position.x += (dx / distance) * step;
      position.z += (dz / distance) * step;
      position.y = terrainHeight(position.x, position.z);
      turnTowards(villager, Math.atan2(dx, dz), deltaTime);
    });
  };

  return { update };
};
