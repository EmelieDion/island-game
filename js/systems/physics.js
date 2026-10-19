import RAPIER from '@dimforge/rapier3d-compat';

const STEP = 1 / 60;
const ARMED_TIME = 0.3;
const REWIND_TIME = 1.2;
const SEA_RADIUS = 30;

export const createPhysics = async (terrain) => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;

  const vertices = new Float32Array(terrain.geometry.attributes.position.array);
  const indices = Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i);
  world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.9));

  const items = [];
  const itemByCollider = new Map();
  const collisionListeners = [];
  const eventQueue = new RAPIER.EventQueue(true);
  let accumulator = 0;
  let clock = 0;

  const add = (mesh, colliderDesc, { position, velocity, spin = { x: 0, y: 0, z: 0 }, size, floatiness, power = 1 }) => {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setAngvel(spin)
        .setCcdEnabled(true),
    );
    const collider = world.createCollider(colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    const item = { mesh, body, collider, size, floatiness, power, spawn: { x: position.x, y: position.y, z: position.z }, rewind: null };
    items.push(item);
    itemByCollider.set(collider.handle, item);
    return item;
  };

  const remove = (item) => {
    itemByCollider.delete(item.collider.handle);
    world.removeRigidBody(item.body);
    item.mesh.removeFromParent();
    items.splice(items.indexOf(item), 1);
  };

  const float = (item, waterHeight) => {
    if (item.rewind) return;
    const position = item.body.translation();
    const inSea = Math.hypot(position.x, position.z) < SEA_RADIUS;
    const depth = waterHeight(position.x, position.z) - (position.y - item.size);
    if (!inSea || depth <= 0) {
      item.inWater = false;
      item.body.setLinearDamping(0.05);
      item.body.setAngularDamping(0.1);
      return;
    }
    if (!item.inWater) {
      item.inWater = true;
      if (item.hitAt === undefined) item.hitAt = clock;
      const velocity = item.body.linvel();
      item.body.setLinvel({ x: velocity.x * 0.35, y: velocity.y * 0.15, z: velocity.z * 0.35 }, true);
      const spin = item.body.angvel();
      item.body.setAngvel({ x: spin.x * 0.3, y: spin.y * 0.3, z: spin.z * 0.3 }, true);
    }
    const submerged = Math.min(depth / (item.size * 2), 1);
    const lift = item.body.mass() * 9.81 * item.floatiness * submerged * STEP;
    item.body.applyImpulse({ x: 0, y: lift, z: 0 }, true);
    item.body.setLinearDamping(3);
    item.body.setAngularDamping(2.5);
  };

  const rewind = () => {
    items.forEach((item) => {
      if (item.rewind) return;
      const position = item.body.translation();
      item.rewind = { from: { x: position.x, y: position.y, z: position.z }, start: clock };
      item.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    });
  };

  const moveBack = (item) => {
    const t = Math.min((clock - item.rewind.start) / REWIND_TIME, 1);
    const eased = t * t * (3 - 2 * t);
    const { from } = item.rewind;
    const to = item.spawn;
    item.body.setNextKinematicTranslation({
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased + Math.sin(t * Math.PI) * 3,
      z: from.z + (to.z - from.z) * eased,
    });
    return t >= 1;
  };

  const update = (deltaTime, waterHeight) => {
    accumulator += Math.min(deltaTime, 0.1);
    clock += Math.min(deltaTime, 0.1);
    [...items].forEach((item) => {
      if (item.rewind && moveBack(item)) remove(item);
    });
    while (accumulator >= STEP) {
      items.forEach((item) => {
        float(item, waterHeight);
        item.velocityBefore = item.body.linvel();
      });
      world.step(eventQueue);
      eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        if (!started) return;
        [handle1, handle2].forEach((handle) => {
          const item = itemByCollider.get(handle);
          if (item && item.hitAt === undefined) item.hitAt = clock;
        });
        collisionListeners.forEach((listener) => listener(handle1, handle2));
      });
      accumulator -= STEP;
    }

    [...items].forEach((item) => {
      const position = item.body.translation();
      if (position.y < -40) {
        remove(item);
        return;
      }
      item.mesh.position.set(position.x, position.y, position.z);
      item.mesh.quaternion.copy(item.body.rotation());
    });
  };

  const blast = (point, radius, getVelocity) => {
    items.forEach((item) => {
      if (item.rewind) return;
      const position = item.body.translation();
      const distance = Math.hypot(position.x - point.x, position.y - point.y, position.z - point.z);
      if (distance > radius) return;
      const push = getVelocity(position);
      const velocity = item.body.linvel();
      item.body.setLinvel({ x: velocity.x + push.x, y: velocity.y + push.y, z: velocity.z + push.z }, true);
    });
  };

  const onCollision = (listener) => collisionListeners.push(listener);

  const isArmed = (item) => item.hitAt === undefined || clock - item.hitAt < ARMED_TIME;

  return { RAPIER, world, items, itemByCollider, add, remove, rewind, blast, update, onCollision, isArmed };
};
