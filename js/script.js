import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { createSea } from './objects/sea.js';
import { createIsland, terrainHeight, VILLAGE, WINDMILL } from './objects/island.js';
import { loadModels } from './objects/models.js';
import { createSky } from './objects/sky.js';
import { createDayCycle } from './systems/dayCycle.js';
import { createRain } from './objects/rain.js';
import { createSnow } from './objects/snow.js';
import { snowCover } from './systems/snowCover.js';
import { createPhysics } from './systems/physics.js';
import { createBeachBall, BEACH_BALL_RADIUS } from './objects/beachBall.js';
import { createBreakables } from './systems/breakables.js';
import { createBarrel, BARREL_RADIUS, BARREL_HEIGHT } from './objects/barrel.js';
import { createRock, ROCK_SIZE } from './objects/rock.js';
import { loadScenery } from './objects/scenery.js';
import { createEffects } from './objects/effects.js';
import { createAudio } from './systems/audio.js';
import { createFire } from './systems/fire.js';

const $canvas = document.getElementById('webgl');
let renderer, camera, scene, controls;
let seaMesh, seaUpdate, sky;
let sun, moon, hemisphereLight, setHouseBrightness, updateWindmill;
let rain, snow;
const weather = { rainTarget: 0, rain: 0, snowTarget: 0, snow: 0, snowCover: 0, windTarget: 0.15, wind: 0.15 };
const wind = new THREE.Vector2();
const dayCycle = createDayCycle(13);
const sunColor = new THREE.Color();
const timer = new THREE.Timer();
const mouse = new THREE.Vector2(0.3, 0.5);
let physics, waterHeight, breakables, scenery, effects, fire;
const audio = createAudio();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerStart = null;
const MAX_PROJECTILES = 40;
let selectedTool = 'ball';

const init = async () => {
  renderer = new THREE.WebGPURenderer({ canvas: $canvas, alpha: false, antialias: true });
  renderer.shadowMap.enabled = true;
  await renderer.init();

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(19, 12.5, 22);

  scene = new THREE.Scene();

  sky = createSky();
  scene.add(sky.mesh);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 1, 0);
  controls.maxDistance = 85;
  controls.minDistance = 5;

  const { mesh, update, getHeight } = createSea();
  seaMesh = mesh;
  seaUpdate = update;
  waterHeight = getHeight;
  scene.add(seaMesh);

  const { mesh: islandMesh, terrain } = createIsland();
  scene.add(islandMesh);

  physics = await createPhysics(terrain);
  breakables = createBreakables(physics, scene);
  effects = createEffects(scene);
  fire = createFire(scene, breakables);

  rain = createRain();
  scene.add(rain.mesh);

  snow = createSnow();
  scene.add(snow.mesh);

  sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  moon = new THREE.DirectionalLight(0x9fb4ff, 0);
  scene.add(moon);

  hemisphereLight = new THREE.HemisphereLight(0xcfe6ff, 0x4a3b2a, 0.9);
  scene.add(hemisphereLight);

  const { createHouse, setBrightness, windmill, blades, updateWindmill: windmillUpdate } = await loadModels();
  setHouseBrightness = setBrightness;
  updateWindmill = windmillUpdate;

  const houses = [
    { x: -1.9, z: -1.7, rotation: 0.2, tint: 0xffffff },
    { x: 0.9, z: -2.1, rotation: -0.5, tint: 0xffe2d6 },
    { x: 2.8, z: 0.1, rotation: -1.3, tint: 0xdfefff },
    { x: -2.9, z: 0.9, rotation: 0.9, tint: 0xfff1c9 },
    { x: 0.1, z: 1.3, rotation: 1.6, tint: 0xe4f5dc },
    { x: 2.2, z: 2.8, rotation: -0.8, tint: 0xf6dcef },
  ];
  houses.forEach(({ x, z, rotation, tint }) => {
    const house = createHouse(tint);
    const px = VILLAGE.x + x;
    const pz = VILLAGE.y + z;
    house.position.set(px, terrainHeight(px, pz) - 0.05, pz);
    house.rotation.y = rotation;
    scene.add(house);
    breakables.addHouse(house);
  });

  let windmillBase = Infinity;
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
    windmillBase = Math.min(windmillBase, terrainHeight(WINDMILL.x + Math.cos(angle) * 0.7, WINDMILL.y + Math.sin(angle) * 0.7));
  }
  windmill.position.set(WINDMILL.x, windmillBase - 0.05, WINDMILL.y);
  windmill.rotation.y = -0.6;
  scene.add(windmill);
  breakables.addWindmill(windmill, blades);

  scenery = await loadScenery(scene, breakables);

  physics.onCollision((handle1, handle2) => {
    const item = physics.itemByCollider.get(handle1) || physics.itemByCollider.get(handle2);
    if (!item || item.rewind || !item.velocityBefore) return;
    const { x, y, z } = item.velocityBefore;
    const speed = Math.hypot(x, y, z);
    if (speed > 3) audio.thud(speed * item.power);
  });

  const $time = document.getElementById('time');
  const $timeOutput = document.getElementById('timeOutput');
  $time.addEventListener('input', () => {
    dayCycle.state.target = parseFloat($time.value);
    const hours = Math.floor(dayCycle.state.target) % 24;
    const minutes = Math.floor((dayCycle.state.target % 1) * 60);
    $timeOutput.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  });

  const $rain = document.getElementById('rain');
  const $rainOutput = document.getElementById('rainOutput');
  $rain.addEventListener('input', () => {
    weather.rainTarget = parseFloat($rain.value);
    $rainOutput.textContent = `${Math.round(weather.rainTarget * 100)}%`;
  });

  const $snow = document.getElementById('snow');
  const $snowOutput = document.getElementById('snowOutput');
  $snow.addEventListener('input', () => {
    weather.snowTarget = parseFloat($snow.value);
    $snowOutput.textContent = `${Math.round(weather.snowTarget * 100)}%`;
  });

  const $wind = document.getElementById('wind');
  const $windOutput = document.getElementById('windOutput');
  $wind.addEventListener('input', () => {
    weather.windTarget = parseFloat($wind.value);
    $windOutput.textContent = `${Math.round(weather.windTarget * 100)}%`;
  });

  renderer.domElement.addEventListener('pointerdown', (e) => {
    pointerStart = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!pointerStart) return;
    const moved = Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y);
    pointerStart = null;
    if (moved < 6) useTool(e);
  });

  document.querySelectorAll('.tool').forEach(($button) => {
    $button.addEventListener('click', () => selectTool($button.dataset.tool));
  });
  window.addEventListener('keydown', (e) => {
    const tool = { 1: 'ball', 2: 'barrel', 3: 'rock', 4: 'lightning', 5: 'gust' }[e.key];
    if (tool) selectTool(tool);
    if (e.key === 'r' || e.key === 'R') pullLever();
    if (e.key === 'Escape') document.getElementById('help').hidden = true;
  });
  document.getElementById('lever').addEventListener('click', pullLever);

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX / window.innerWidth;
    mouse.y = e.clientY / window.innerHeight;
  });

  window.addEventListener('resize', resize);
  resize();

  await renderer.compileAsync(scene, camera);
  await sky.compile(renderer, camera);

  renderer.setAnimationLoop(draw);
  const $loader = document.getElementById('loader');
  const $startButton = document.getElementById('startButton');
  $startButton.disabled = false;
  $startButton.textContent = 'Start playing';
  $startButton.addEventListener('click', () => {
    audio.start();
    $loader.addEventListener('transitionend', () => $loader.remove());
    $loader.classList.add('is-done');
  });

  const $help = document.getElementById('help');
  document.getElementById('helpButton').addEventListener('click', () => {
    $help.hidden = false;
  });
  document.getElementById('helpClose').addEventListener('click', () => {
    $help.hidden = true;
  });

  $help.addEventListener('click', (e) => {
    if (e.target === $help) $help.hidden = true;
  });

  document.querySelectorAll('.control input').forEach(($input) => {
    const fill = () => {
      const percent = ((parseFloat($input.value) - parseFloat($input.min)) / (parseFloat($input.max) - parseFloat($input.min))) * 100;
      $input.style.setProperty('--fill', `${percent}%`);
    };
    fill();
    $input.addEventListener('input', fill);
  });

  const $soundButton = document.getElementById('soundButton');
  $soundButton.addEventListener('click', () => {
    audio.start();
    const muted = audio.toggleMute();
    $soundButton.classList.toggle('is-muted', muted);
    $soundButton.setAttribute('aria-label', muted ? 'Sound on' : 'Sound off');
  });
};

const projectiles = {
  ball: {
    create: createBeachBall,
    collider: () => physics.RAPIER.ColliderDesc.ball(BEACH_BALL_RADIUS).setDensity(0.15).setRestitution(0.75).setFriction(0.6),
    size: BEACH_BALL_RADIUS,
    floatiness: 4,
    power: 0,
    speed: 16,
  },
  barrel: {
    create: createBarrel,
    collider: () => physics.RAPIER.ColliderDesc.cylinder(BARREL_HEIGHT / 2, BARREL_RADIUS * 1.1).setDensity(0.8).setRestitution(0.2).setFriction(0.7),
    size: BARREL_HEIGHT / 2,
    floatiness: 1.8,
    power: 1.6,
    speed: 15,
  },
  rock: {
    create: createRock,
    collider: (mesh) => physics.RAPIER.ColliderDesc.convexHull(mesh.geometry.attributes.position.array).setDensity(2.5).setRestitution(0.1).setFriction(0.9),
    size: ROCK_SIZE,
    floatiness: 0.3,
    power: 3,
    speed: 14,
  },
};

const throwProjectile = (e) => {
  const type = projectiles[selectedTool];
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const direction = raycaster.ray.direction;
  const position = camera.position.clone().addScaledVector(direction, 1.5);
  const velocity = direction.clone().multiplyScalar(type.speed).add(new THREE.Vector3(0, 2, 0));
  const spin = { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 };

  audio.whoosh(0.3);
  const mesh = type.create();
  scene.add(mesh);
  physics.add(mesh, type.collider(mesh), { position, velocity, spin, size: type.size, floatiness: type.floatiness, power: type.power });

  if (physics.items.length > MAX_PROJECTILES) physics.remove(physics.items[0]);
};

const pullLever = () => {
  const $lever = document.getElementById('lever');
  if ($lever.classList.contains('is-pulled')) return;
  physics.rewind();
  fire.extinguishAll();
  breakables.rewind();
  audio.rewind();
  $lever.classList.add('is-pulled');
  setTimeout(() => $lever.classList.remove('is-pulled'), 1400);
};

const findTarget = () => {
  const hits = raycaster.intersectObjects(scene.children, true);
  const hit = hits.find((candidate) => candidate.object !== sky.mesh && !candidate.object.isSprite && candidate.object.visible);
  return hit ? hit.point : null;
};

const strikeLightning = (point) => {
  effects.strike(point);
  audio.thunder();
  const away = (position) => new THREE.Vector3(position.x - point.x, 0, position.z - point.z).normalize().multiplyScalar(4).add(new THREE.Vector3(0, 5, 0));
  const target = breakables.findNearest(point, 2.5);
  if (target) {
    target.onRepaired = () => fire.setChar(target, 0);
    fire.ignite(target, timer.getElapsed());
  }
  physics.blast(point, 3, away);
};

const blowGust = (point) => {
  const direction = new THREE.Vector3(point.x - camera.position.x, 0, point.z - camera.position.z).normalize();
  effects.blow(point, direction);
  audio.whoosh(1);
  const along = () => direction.clone().multiplyScalar(10).add(new THREE.Vector3(0, 3, 0));
  breakables.blast(point, 3, along, 0.8, true);
  physics.blast(point, 4, along);
};

const useTool = (e) => {
  if (projectiles[selectedTool]) {
    throwProjectile(e);
    return;
  }
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const point = findTarget();
  if (!point) return;
  if (selectedTool === 'lightning') strikeLightning(point);
  if (selectedTool === 'gust') blowGust(point);
};

const selectTool = (tool) => {
  selectedTool = tool;
  document.querySelectorAll('.tool').forEach(($button) => {
    $button.classList.toggle('is-active', $button.dataset.tool === tool);
  });
};

const updateLights = () => {
  const { sunDir, day } = dayCycle.state;

  sun.position.copy(sunDir).multiplyScalar(45);
  const sunUp = THREE.MathUtils.smoothstep(sunDir.y, -0.05, 0.15);
  const low = 1 - THREE.MathUtils.smoothstep(sunDir.y, 0.05, 0.4);
  sunColor.setRGB(1, 1 - low * 0.35, 1 - low * 0.6);
  sun.color.copy(sunColor);
  const clouds = Math.max(weather.rain, weather.snow * 0.7);
  sun.intensity = sunUp * 2.4 * (1 - clouds * 0.6);

  moon.position.copy(sunDir).multiplyScalar(-45);
  moon.intensity = (1 - day) * 0.45;

  hemisphereLight.intensity = (0.18 + day * 0.8) * (1 - clouds * 0.3) + effects.getFlash() * 2.5;
  setHouseBrightness(0.25 + day * 0.75);

  sky.uniforms.sunDir.value.copy(sunDir);
  sky.uniforms.day.value = day;
  const night = THREE.MathUtils.smoothstep(1 - day, 0.6, 1);
  const cold = THREE.MathUtils.smoothstep(weather.snow, 0.2, 0.7);
  sky.uniforms.aurora.value = night * cold * 1.4;
};

const draw = () => {
  timer.update();
  const deltaTime = timer.getDelta();
  dayCycle.update(deltaTime);
  weather.rain += (weather.rainTarget - weather.rain) * Math.min(1, deltaTime * 1.5);
  weather.snow += (weather.snowTarget - weather.snow) * Math.min(1, deltaTime * 1.5);
  weather.wind += (weather.windTarget - weather.wind) * Math.min(1, deltaTime * 1.5);
  if (weather.snow > 0.05) {
    weather.snowCover = Math.min(1, weather.snowCover + weather.snow * deltaTime * 0.1);
  } else {
    const melt = 0.02 + dayCycle.state.day * 0.04 + weather.rain * 0.1;
    weather.snowCover = Math.max(0, weather.snowCover - melt * deltaTime);
  }
  snowCover.value = weather.snowCover;
  const windAngle = 0.3 + Math.sin(timer.getElapsed() * 0.05) * 0.6;
  wind.set(Math.cos(windAngle), Math.sin(windAngle)).multiplyScalar(weather.wind * 9);
  updateLights();

  seaUpdate(deltaTime, mouse, dayCycle.state.day, weather.wind);
  sky.update(timer.getElapsed(), renderer, camera);
  const particleBrightness = 0.35 + dayCycle.state.day * 0.65;
  rain.update(renderer, weather.rain, wind, deltaTime, particleBrightness);
  snow.update(renderer, weather.snow, wind, deltaTime, timer.getElapsed(), particleBrightness);

  physics.update(deltaTime, waterHeight);
  breakables.update(timer.getElapsed());
  scenery.update(timer.getElapsed(), waterHeight);
  updateWindmill(deltaTime, weather.wind);
  effects.update(deltaTime);
  fire.update(deltaTime, timer.getElapsed());
  audio.update(weather.rain, weather.wind, timer.getElapsed());

  controls.update();
  renderer.render(scene, camera);
};

const resize = () => {
  const pixelRatio = Math.min(window.devicePixelRatio, 1.5);
  renderer.setSize(window.innerWidth * pixelRatio, window.innerHeight * pixelRatio, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
};

init();
