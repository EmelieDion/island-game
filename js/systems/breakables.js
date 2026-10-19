import * as THREE from 'three/webgpu';

const BREAK_FORCE = 4;
const REPAIR_DELAY = 6;
const CARRY_SIZE = 0.5;
const PIECE_REPAIR_TIME = 1.2;
const PIECE_REPAIR_GAP = 0.15;
const FAST_REPAIR_TIME = 0.7;
const FAST_REPAIR_GAP = 0.04;

const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const size = new THREE.Vector3();
const center = new THREE.Vector3();

export const createBreakables = (physics, scene) => {
  const { RAPIER, world } = physics;
  const houses = [];
  const pieceByCollider = new Map();
  let now = 0;

  const addPiece = (record, object, isRoof) => {
    object.matrixWorld.decompose(position, quaternion, scale);
    scene.attach(object);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(quaternion),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setTranslation(center.x, center.y, center.z)
        .setDensity(0.6)
        .setFriction(0.8)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );

    const piece = {
      mesh: object,
      body,
      collider,
      house: record,
      broken: false,
      isRoof,
      home: { position: position.clone(), quaternion: quaternion.clone() },
      from: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
    };
    record.pieces.push(piece);
    pieceByCollider.set(collider.handle, piece);
  };

  const createRecord = (toughness) => ({ pieces: [], toughness, lastHit: -Infinity, repairing: false, repairStart: 0, fast: false });

  const addHouse = (house) => {
    house.updateMatrixWorld(true);
    const meshes = [];
    house.traverse((child) => {
      if (child.isMesh && (child.name.startsWith('Cube') || child.name.startsWith('Cylinder'))) meshes.push(child);
    });

    const record = createRecord(1);
    record.manual = true;
    meshes.forEach((mesh) => {
      mesh.matrixWorld.decompose(position, quaternion, scale);
      mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox.getSize(size).multiply(scale);
      mesh.geometry.boundingBox.getCenter(center).multiply(scale);
      addPiece(record, mesh, mesh.name.startsWith('Cylinder'));
    });

    record.pieces.sort((a, b) => a.home.position.y - b.home.position.y);
    houses.push(record);
  };

  const addTree = (tree) => {
    tree.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tree);
    box.getSize(size);
    size.x *= 0.5;
    size.z *= 0.5;
    tree.matrixWorld.decompose(position, quaternion, scale);
    box.getCenter(center).sub(position).applyQuaternion(quaternion.clone().invert());
    size.y -= 0.3;
    center.y += 0.15;

    const record = createRecord(2.5);
    addPiece(record, tree, false);
    houses.push(record);
  };

  const addWindmill = (windmill, blades) => {
    windmill.updateMatrixWorld(true);
    const record = createRecord(1.5);

    ['Molen_Toren', 'Molen_Hoedje'].forEach((name) => {
      const mesh = windmill.getObjectByName(name);
      mesh.matrixWorld.decompose(position, quaternion, scale);
      mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox.getSize(size).multiply(scale);
      mesh.geometry.boundingBox.getCenter(center).multiply(scale);
      addPiece(record, mesh, name === 'Molen_Hoedje');
    });

    const box = new THREE.Box3().setFromObject(blades.model);
    box.getSize(size);
    blades.model.matrixWorld.decompose(position, quaternion, scale);
    box.getCenter(center).sub(position).applyQuaternion(quaternion.clone().invert());
    size.applyQuaternion(quaternion.clone().invert());
    size.set(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z));
    addPiece(record, blades.model, true);
    record.pieces[record.pieces.length - 1].follow = blades.target;

    record.pieces.sort((a, b) => a.home.position.y - b.home.position.y);
    houses.push(record);
  };

  const addBoat = (boat, target) => {
    boat.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(boat);
    box.getSize(size);
    boat.matrixWorld.decompose(position, quaternion, scale);
    box.getCenter(center).sub(position).applyQuaternion(quaternion.clone().invert());

    const record = createRecord(2.5);
    addPiece(record, boat, false);
    record.pieces[0].follow = target;
    houses.push(record);
  };

  const followTarget = (piece) => {
    piece.follow.updateWorldMatrix(true, false);
    piece.follow.matrixWorld.decompose(piece.home.position, piece.home.quaternion, scale);
  };

  const addStatic = (object, shrink = 1) => {
    const box = new THREE.Box3().setFromObject(object);
    box.getSize(size);
    box.getCenter(center);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid((size.x / 2) * shrink, size.y / 2, (size.z / 2) * shrink)
        .setTranslation(center.x, center.y, center.z)
        .setFriction(0.8),
    );
  };

  const breakPiece = (piece, velocity, power) => {
    piece.broken = true;
    piece.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    const push = new THREE.Vector3(velocity.x, velocity.y, velocity.z).normalize().multiplyScalar(1.5 + power * 1.5);
    piece.body.setLinvel({ x: push.x, y: Math.max(push.y, 0) + 1.5 + power, z: push.z }, true);
    piece.body.setAngvel({
      x: (Math.random() - 0.5) * 3 * power,
      y: (Math.random() - 0.5) * 3 * power,
      z: (Math.random() - 0.5) * 3 * power,
    }, true);
  };

  const breakAround = (house, hitPiece, velocity, power) => {
    house.pieces.filter((piece) => piece.broken && (house.repairing || piece.carried || piece.returning)).forEach((piece) => {
      piece.carried = false;
      piece.returning = null;
      if (piece.baseScale) piece.mesh.scale.copy(piece.baseScale);
      piece.collider.setEnabled(true);
      piece.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    });
    house.repairing = false;
    house.lastHit = now;

    const toBreak = new Set([hitPiece]);
    house.pieces.forEach((piece) => {
      if (!piece.broken && piece.home.position.distanceTo(hitPiece.home.position) < power * 0.5) toBreak.add(piece);
    });

    let changed = true;
    while (changed) {
      changed = false;
      house.pieces.forEach((piece) => {
        if (piece.broken || toBreak.has(piece)) return;
        const falls = [...toBreak].some((below) => {
          const higher = piece.home.position.y > below.home.position.y + 0.2;
          const above = Math.hypot(
            piece.home.position.x - below.home.position.x,
            piece.home.position.z - below.home.position.z,
          ) < 0.6;
          return piece.isRoof || (higher && above);
        });
        if (falls) {
          toBreak.add(piece);
          changed = true;
        }
      });
    }

    toBreak.forEach((piece) => {
      if (!piece.broken) breakPiece(piece, velocity, power);
    });
  };

  physics.onCollision((handle1, handle2) => {
    const piece = pieceByCollider.get(handle1) || pieceByCollider.get(handle2);
    const item = physics.itemByCollider.get(handle1) || physics.itemByCollider.get(handle2);
    if (!piece || !item || item.rewind) return;
    if (piece.broken) return;
    const velocity = item.velocityBefore || item.body.linvel();
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (speed * item.power < BREAK_FORCE * piece.house.toughness) return;
    breakAround(piece.house, piece, velocity, item.power);
  });

  const repair = (house) => {
    const broken = house.pieces.filter((piece) => piece.broken);
    if (!broken.length) return;

    if (!house.repairing && (house.fast || (!house.manual && now - house.lastHit > REPAIR_DELAY))) {
      house.repairing = true;
      house.repairStart = now;
      broken.forEach((piece) => {
        piece.carried = false;
        piece.returning = null;
        piece.claimedBy = null;
        if (piece.baseScale) piece.mesh.scale.copy(piece.baseScale);
        piece.collider.setEnabled(true);
        piece.from.position.copy(piece.mesh.position);
        piece.from.quaternion.copy(piece.mesh.quaternion);
        piece.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      });
    }

    if (!house.repairing) return;

    const pieceTime = house.fast ? FAST_REPAIR_TIME : PIECE_REPAIR_TIME;
    const gap = house.fast ? FAST_REPAIR_GAP : PIECE_REPAIR_GAP;
    let done = true;
    broken.forEach((piece, index) => {
      if (piece.follow) followTarget(piece);
      const t = THREE.MathUtils.clamp((now - house.repairStart - index * gap) / pieceTime, 0, 1);
      const eased = t * t * (3 - 2 * t);
      position.lerpVectors(piece.from.position, piece.home.position, eased);
      quaternion.slerpQuaternions(piece.from.quaternion, piece.home.quaternion, eased);
      piece.body.setNextKinematicTranslation(position);
      piece.body.setNextKinematicRotation(quaternion);
      if (t < 1) done = false;
    });

    if (done) {
      broken.forEach((piece) => {
        piece.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        piece.body.setTranslation(piece.home.position, true);
        piece.body.setRotation(piece.home.quaternion, true);
        piece.mesh.position.copy(piece.home.position);
        piece.mesh.quaternion.copy(piece.home.quaternion);
        piece.broken = false;
      });
      house.repairing = false;
      house.fast = false;
      if (house.onRepaired) house.onRepaired(house);
    }
  };

  const blast = (point, radius, getVelocity, power, onlyLoose = false) => {
    houses.forEach((house) => {
      let nearest = null;
      let nearestDistance = radius;
      house.pieces.forEach((piece) => {
        if (piece.broken) return;
        if (onlyLoose && !piece.isRoof && house.toughness < 2) return;
        const distance = piece.home.position.distanceTo(point);
        if (distance < nearestDistance) {
          nearest = piece;
          nearestDistance = distance;
        }
      });
      if (nearest) breakAround(house, nearest, getVelocity(nearest.home.position), power);
    });
  };

  const findNearest = (point, radius) => {
    let nearest = null;
    let nearestDistance = radius;
    houses.forEach((house) => {
      house.pieces.forEach((piece) => {
        const distance = piece.mesh.position.distanceTo(point);
        if (distance < nearestDistance) {
          nearest = house;
          nearestDistance = distance;
        }
      });
    });
    return nearest;
  };

  const collapse = (house) => {
    house.lastHit = now;
    house.repairing = false;
    house.pieces.forEach((piece) => {
      piece.carried = false;
      piece.returning = null;
      if (piece.baseScale) piece.mesh.scale.copy(piece.baseScale);
      piece.collider.setEnabled(true);
    });
    const middle = new THREE.Vector3();
    house.pieces.forEach((piece) => middle.add(piece.mesh.position));
    middle.divideScalar(house.pieces.length);
    house.pieces.forEach((piece) => {
      piece.broken = true;
      piece.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      const outward = piece.mesh.position.clone().sub(middle).setY(0).normalize().multiplyScalar(1.5 + Math.random());
      piece.body.setLinvel({ x: outward.x, y: 0.3, z: outward.z }, true);
      piece.body.setAngvel({ x: (Math.random() - 0.5) * 4, y: 0, z: (Math.random() - 0.5) * 4 }, true);
    });
  };

  const setSize = (piece, size) => {
    if (!piece.baseScale) piece.baseScale = piece.mesh.scale.clone();
    piece.mesh.scale.copy(piece.baseScale).multiplyScalar(size);
  };

  const finishPiece = (piece) => {
    setSize(piece, 1);
    piece.collider.setEnabled(true);
    piece.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    piece.body.setTranslation(piece.home.position, true);
    piece.body.setRotation(piece.home.quaternion, true);
    piece.mesh.position.copy(piece.home.position);
    piece.mesh.quaternion.copy(piece.home.quaternion);
    piece.broken = false;
    piece.carried = false;
    piece.returning = null;
    piece.claimedBy = null;
    const house = piece.house;
    if (!house.pieces.some((other) => other.broken) && house.onRepaired) house.onRepaired(house);
  };

  const returnStep = (piece) => {
    const { start, duration } = piece.returning;
    const t = THREE.MathUtils.clamp((now - start) / duration, 0, 1);
    const eased = t * t * (3 - 2 * t);
    position.lerpVectors(piece.from.position, piece.home.position, eased);
    quaternion.slerpQuaternions(piece.from.quaternion, piece.home.quaternion, eased);
    piece.body.setNextKinematicTranslation(position);
    piece.body.setNextKinematicRotation(quaternion);
    setSize(piece, THREE.MathUtils.lerp(piece.returning.size, 1, eased));
    if (t >= 1) finishPiece(piece);
  };

  const sendHome = (piece, duration = 1.2) => {
    piece.carried = false;
    piece.from.position.copy(piece.mesh.position);
    piece.from.quaternion.copy(piece.mesh.quaternion);
    piece.collider.setEnabled(false);
    piece.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    piece.returning = { start: now, duration, size: piece.baseScale ? piece.mesh.scale.x / piece.baseScale.x : 1 };
  };

  const takePiece = (piece) => {
    piece.carried = true;
    setSize(piece, CARRY_SIZE);
    piece.collider.setEnabled(false);
    piece.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  };

  const carryPiece = (piece, target) => {
    piece.body.setNextKinematicTranslation(target);
    piece.body.setNextKinematicRotation(piece.home.quaternion);
  };

  const dropPiece = (piece) => {
    piece.carried = false;
    piece.claimedBy = null;
    setSize(piece, 1);
    piece.collider.setEnabled(true);
    if (piece.broken && !piece.returning) piece.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  };

  const housesToRebuild = () => houses.filter((house) => house.manual && !house.repairing && !house.fast
    && now - house.lastHit > 2 && house.pieces.some((piece) => piece.broken));

  const rewind = () => {
    houses.forEach((house) => {
      if (!house.pieces.some((piece) => piece.broken)) return;
      house.fast = true;
      house.repairing = false;
    });
  };

  const update = (elapsedTime) => {
    now = elapsedTime;
    houses.forEach((house) => {
      repair(house);
      house.pieces.forEach((piece) => {
        if (!piece.broken && piece.follow) {
          followTarget(piece);
          piece.mesh.position.copy(piece.home.position);
          piece.mesh.quaternion.copy(piece.home.quaternion);
          piece.body.setTranslation(piece.home.position, true);
          piece.body.setRotation(piece.home.quaternion, true);
          return;
        }
        if (!piece.broken) return;
        if (piece.returning) returnStep(piece);
        if (!piece.broken) return;
        const translation = piece.body.translation();
        piece.mesh.position.set(translation.x, translation.y, translation.z);
        piece.mesh.quaternion.copy(piece.body.rotation());
      });
    });
  };

  return { records: houses, addHouse, addTree, addWindmill, addBoat, addStatic, blast, findNearest, collapse, rewind, update, housesToRebuild, sendHome, takePiece, carryPiece, dropPiece };
};
