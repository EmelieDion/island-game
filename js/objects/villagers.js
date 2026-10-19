import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { terrainHeight, VILLAGE } from './island.js';

const COUNT = 10;
const HEIGHT = 0.55;
const WALK_SPEED = 0.55;
const RUN_SPEED = 1.8;
const FLEE_TIME = 2.6;
const DOWN_TIME = 2.6;
const HOUSE_SPACE = 1.05;
const FETCH_SPEED = 1.5;
const CARRY_SPEED = 1.1;
const PICKUP_TIME = 0.35;
const PLACE_TIME = 0.4;
const WAVE_TIME = 2.2;
const JOB_TIME = 25;

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

export const loadVillagers = async (scene, houses, { breakables, isBurning = () => false } = {}) => {
  const loader = new GLTFLoader();
  const models = await Promise.all(['assets/worker.glb', 'assets/farmer.glb'].map((url) => loader.loadAsync(url)));
  const streets = findStreets(houses);
  const depot = [...streets].sort((a, b) => a.distanceTo(VILLAGE) - b.distanceTo(VILLAGE))[0];
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
      run: mixer.clipAction(findClip(model.animations, 'Run')),
      fall: mixer.clipAction(findClip(model.animations, 'Death')),
      interact: mixer.clipAction(findClip(model.animations, 'Interact')),
      wave: mixer.clipAction(findClip(model.animations, 'Wave')),
    };
    actions.fall.setLoop(THREE.LoopOnce, 1);
    actions.fall.clampWhenFinished = true;
    actions.idle.play();

    const start = streets[Math.floor(Math.random() * streets.length)];
    root.position.set(start.x, terrainHeight(start.x, start.y), start.y);
    root.rotation.y = Math.random() * Math.PI * 2;

    villagers.push({ root, mixer, actions, current: 'idle', state: 'wander', target: null, wait: Math.random() * 3, timer: 0, rising: false, job: null });
  }

  const play = (villager, name, fade = 0.25, speed = 1) => {
    if (villager.current === name) {
      villager.actions[name].timeScale = speed;
      return;
    }
    const action = villager.actions[name].reset();
    action.timeScale = speed;
    action.fadeIn(fade).play();
    villager.actions[villager.current].fadeOut(fade);
    villager.current = name;
  };

  const here = (villager) => new THREE.Vector2(villager.root.position.x, villager.root.position.z);

  const stopJob = (villager) => {
    const job = villager.job;
    if (!job) return;
    villager.job = null;
    if (job.piece.claimedBy === villager) {
      if (job.piece.carried) breakables.dropPiece(job.piece);
      job.piece.claimedBy = null;
    }
  };

  const scare = (point, radius) => {
    const danger = new THREE.Vector2(point.x, point.z);
    villagers.forEach((villager) => {
      if (villager.state === 'down') return;
      const position = here(villager);
      if (position.distanceTo(danger) > radius) return;
      const options = streets.filter((spot) => spot.distanceTo(position) < 5 && spot.distanceTo(danger) > radius);
      options.sort((a, b) => b.distanceTo(danger) - a.distanceTo(danger));
      const safe = options.slice(0, 6).find((spot) => isClearPath(position, spot, houses)) || options[0];
      if (!safe) return;
      stopJob(villager);
      villager.state = 'flee';
      villager.target = safe;
      villager.timer = FLEE_TIME;
      play(villager, 'run', 0.15);
    });
  };

  const knockDown = (villager) => {
    stopJob(villager);
    villager.state = 'down';
    villager.target = null;
    villager.timer = DOWN_TIME;
    villager.rising = false;
    play(villager, 'fall', 0.1);
  };

  const checkHits = (items) => {
    items.forEach((item) => {
      if (item.rewind) return;
      const velocity = item.body.linvel();
      if (Math.hypot(velocity.x, velocity.y, velocity.z) < 2) return;
      const position = item.body.translation();
      villagers.forEach((villager) => {
        if (villager.state === 'down') return;
        const body = villager.root.position;
        const distance = Math.hypot(position.x - body.x, position.y - (body.y + 0.3), position.z - body.z);
        if (distance < item.size + 0.3) knockDown(villager);
      });
    });
  };

  const knockDownNear = (point, radius) => {
    villagers.forEach((villager) => {
      if (villager.state !== 'down' && villager.root.position.distanceTo(point) < radius) knockDown(villager);
    });
  };

  const moveTowards = (villager, speed, deltaTime) => {
    const position = villager.root.position;
    const dx = villager.target.x - position.x;
    const dz = villager.target.y - position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.05) return true;
    const step = Math.min(distance, speed * deltaTime);
    position.x += (dx / distance) * step;
    position.z += (dz / distance) * step;
    position.y = terrainHeight(position.x, position.z);
    turnTowards(villager, Math.atan2(dx, dz), deltaTime);
    return false;
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

  const houseCenter = (house) => {
    const center = new THREE.Vector3();
    house.pieces.forEach((piece) => center.add(piece.home.position));
    return center.divideScalar(house.pieces.length);
  };

  const isReachable = (piece) => {
    const { x, y, z } = piece.mesh.position;
    const ground = terrainHeight(x, z);
    return ground > 0.15 && y > ground - 0.5 && Math.hypot(x - VILLAGE.x, z - VILLAGE.y) < 8;
  };

  const isResting = (piece) => {
    const velocity = piece.body.linvel();
    return Math.hypot(velocity.x, velocity.y, velocity.z) < 0.6;
  };

  let jobTimer = 0;
  let clock = 0;

  const assignJobs = () => {
    if (!breakables) return;
    const houses = breakables.housesToRebuild().filter((house) => !isBurning(house));
    houses.forEach((house) => {
      house.pieces.forEach((piece) => {
        if (!piece.broken || piece.carried || piece.returning || piece.claimedBy || isReachable(piece)) return;
        if (!isResting(piece) && piece.mesh.position.y > -3) return;
        const x = depot.x + (Math.random() - 0.5) * 0.5;
        const z = depot.y + (Math.random() - 0.5) * 0.5;
        breakables.movePiece(piece, new THREE.Vector3(x, terrainHeight(x, z) + 0.6 + Math.random() * 0.6, z));
      });
    });

    villagers.forEach((villager) => {
      if (villager.state !== 'wander' || villager.job) return;
      const position = villager.root.position;
      let best = null;
      houses.forEach((house) => {
        house.pieces.forEach((piece) => {
          if (!piece.broken || piece.carried || piece.returning || piece.claimedBy || !isResting(piece)) return;
          const score = piece.home.position.y * 1.5 + piece.mesh.position.distanceTo(position) * 0.6;
          if (!best || score < best.score) best = { piece, house, score };
        });
      });
      if (!best) return;
      best.piece.claimedBy = villager;
      villager.job = { piece: best.piece, house: best.house, phase: 'fetch', timer: 0, start: clock };
      villager.state = 'work';
      play(villager, 'run', 0.2, 0.85);
    });
  };

  const carryPoint = new THREE.Vector3();

  const holdPiece = (villager) => {
    const position = villager.root.position;
    carryPoint.set(position.x, position.y + HEIGHT + 0.12, position.z);
    breakables.carryPiece(villager.job.piece, carryPoint);
  };

  const finishWork = (villager, wait) => {
    villager.job = null;
    villager.state = 'wander';
    villager.target = null;
    villager.wait = wait;
    play(villager, 'idle');
  };

  const work = (villager, deltaTime) => {
    const job = villager.job;
    if (!job) {
      finishWork(villager, 0.5);
      return;
    }
    const { piece, house } = job;
    const lost = piece.claimedBy !== villager || !piece.broken || house.fast || house.repairing || isBurning(house)
      || clock - job.start > JOB_TIME || ((job.phase === 'carry' || job.phase === 'place') && !piece.carried);
    if (lost && job.phase !== 'wave') {
      stopJob(villager);
      finishWork(villager, 0.5);
      return;
    }

    if (job.phase === 'fetch') {
      const position = villager.root.position;
      const target = new THREE.Vector2(piece.mesh.position.x - position.x, piece.mesh.position.z - position.z);
      const distance = target.length();
      if (!isResting(piece)) return;
      if (distance < 0.4) {
        job.phase = 'pickup';
        job.timer = PICKUP_TIME;
        turnTowards(villager, Math.atan2(target.x, target.y), 1);
        play(villager, 'interact', 0.1, 2);
        return;
      }
      villager.target = new THREE.Vector2(piece.mesh.position.x, piece.mesh.position.z).sub(target.normalize().multiplyScalar(0.25));
      moveTowards(villager, FETCH_SPEED, deltaTime);
      return;
    }

    if (job.phase === 'pickup') {
      job.timer -= deltaTime;
      if (job.timer > 0) return;
      breakables.takePiece(piece);
      holdPiece(villager);
      const center = houseCenter(house);
      const position = villager.root.position;
      const away = new THREE.Vector2(position.x - center.x, position.z - center.z);
      if (away.lengthSq() < 0.01) away.set(1, 0);
      away.normalize().rotateAround(new THREE.Vector2(), (Math.random() - 0.5) * 1.2).multiplyScalar(HOUSE_SPACE * 0.85);
      villager.target = new THREE.Vector2(center.x + away.x, center.z + away.y);
      job.center = center;
      job.phase = 'carry';
      play(villager, 'walk', 0.15, 1.8);
      return;
    }

    if (job.phase === 'carry') {
      const arrived = moveTowards(villager, CARRY_SPEED, deltaTime);
      holdPiece(villager);
      if (!arrived) return;
      const position = villager.root.position;
      turnTowards(villager, Math.atan2(job.center.x - position.x, job.center.z - position.z), 1);
      job.phase = 'place';
      job.timer = PLACE_TIME;
      play(villager, 'interact', 0.1, 2);
      return;
    }

    if (job.phase === 'place') {
      holdPiece(villager);
      job.timer -= deltaTime;
      if (job.timer > PLACE_TIME * 0.4) return;
      breakables.sendHome(piece, 0.45);
      piece.claimedBy = null;
      const others = house.pieces.filter((other) => other.broken && other !== piece && !other.returning);
      if (others.length) {
        finishWork(villager, 0.2);
        return;
      }
      job.phase = 'wave';
      job.timer = WAVE_TIME;
      play(villager, 'wave', 0.2);
      return;
    }

    if (job.phase === 'wave') {
      job.timer -= deltaTime;
      if (job.timer <= 0) finishWork(villager, 1);
    }
  };

  const update = (deltaTime, items = []) => {
    checkHits(items);
    clock += deltaTime;
    jobTimer -= deltaTime;
    if (jobTimer <= 0) {
      jobTimer = 0.25;
      assignJobs();
    }

    villagers.forEach((villager) => {
      villager.mixer.update(deltaTime);

      if (villager.state === 'down') {
        villager.timer -= deltaTime;
        if (!villager.rising && villager.timer < 0.9) {
          villager.rising = true;
          villager.actions.fall.paused = false;
          villager.actions.fall.timeScale = -1;
        }
        if (villager.timer <= 0) {
          villager.state = 'wander';
          villager.wait = 0.5;
          play(villager, 'idle', 0.3);
        }
        return;
      }

      if (villager.state === 'work') {
        work(villager, deltaTime);
        return;
      }

      if (villager.state === 'flee') {
        villager.timer -= deltaTime;
        if (moveTowards(villager, RUN_SPEED, deltaTime) || villager.timer <= 0) {
          villager.state = 'wander';
          villager.target = null;
          villager.wait = 1.5 + Math.random() * 2;
          play(villager, 'idle');
        }
        return;
      }

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

      if (moveTowards(villager, WALK_SPEED, deltaTime)) {
        villager.target = null;
        villager.wait = 1.5 + Math.random() * 3;
        play(villager, 'idle');
      }
    });
  };

  return { update, scare, knockDownNear };
};
