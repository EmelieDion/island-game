import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addSnow } from '../systems/snowCover.js';

const WALL_BRIGHTNESS = 3.5;

export const fitToSize = (group, size, axis = 'width') => {
  const box = new THREE.Box3().setFromObject(group);
  const dimensions = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  group.children.forEach((child) => {
    child.position.x -= center.x;
    child.position.z -= center.z;
    child.position.y -= box.min.y;
  });
  const wrapper = new THREE.Group();
  wrapper.add(group);
  const current = axis === 'height' ? dimensions.y : Math.max(dimensions.x, dimensions.z);
  wrapper.scale.setScalar(size / current);
  return wrapper;
};

const prepare = (group) => {
  group.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
};

export const loadModels = async () => {
  const gltf = await new GLTFLoader().loadAsync('assets/island-game-assets-animation.glb');

  const bakedTexture = await new THREE.TextureLoader().loadAsync('assets/island-game-assets.jpg');
  bakedTexture.flipY = false;
  bakedTexture.colorSpace = THREE.SRGBColorSpace;
  const bakedMaterial = new THREE.MeshBasicMaterial({ map: bakedTexture, name: 'Baked' });
  bakedMaterial.color.setScalar(WALL_BRIGHTNESS);

  const house = new THREE.Group();
  const windmill = new THREE.Group();
  [...gltf.scene.children].forEach((child) => {
    if (child.name.startsWith('Molen')) windmill.add(child);
    else house.add(child);
  });

  house.traverse((child) => {
    if (!child.isMesh) return;
    if (child.material.name === 'Creme') child.material = bakedMaterial;
    else if (child.material.name === 'Donkerrood') child.material = addSnow(child.material);
  });

  windmill.traverse((child) => {
    if (child.isMesh) child.material = addSnow(child.material);
  });

  prepare(house);
  prepare(windmill);

  const houseTemplate = fitToSize(house, 1.6);
  const houseMaterials = [];

  const createHouse = (tint) => {
    const copy = houseTemplate.clone();
    const material = bakedMaterial.clone();
    material.userData.tint = new THREE.Color(tint);
    houseMaterials.push(material);
    copy.traverse((child) => {
      if (child.isMesh && child.material.name === 'Baked') child.material = material;
    });
    return copy;
  };

  const setBrightness = (brightness) => {
    houseMaterials.forEach((material) => {
      material.color.copy(material.userData.tint).multiplyScalar(WALL_BRIGHTNESS * brightness * (1 - (material.userData.char || 0) * 0.8));
    });
  };

  const windmillModel = fitToSize(windmill, 3.4, 'height');
  const bladesModel = windmillModel.getObjectByName('Molen_As');
  const bladesTarget = new THREE.Object3D();
  bladesTarget.position.copy(bladesModel.position);
  bladesTarget.quaternion.copy(bladesModel.quaternion);
  bladesTarget.scale.copy(bladesModel.scale);
  bladesModel.parent.add(bladesTarget);
  bladesModel.name = 'Molen_Wieken';
  bladesTarget.name = 'Molen_As';
  const mixer = new THREE.AnimationMixer(windmillModel);
  const bladesClip = gltf.animations.find((clip) => clip.name.startsWith('Molen')) || gltf.animations[0];
  const blades = bladesClip ? mixer.clipAction(bladesClip).play() : null;

  const updateWindmill = (deltaTime, wind) => {
    if (!blades) return;
    blades.timeScale = 0.15 + wind * 2.2;
    mixer.update(deltaTime);
  };

  return {
    createHouse,
    setBrightness,
    windmill: windmillModel,
    blades: { model: bladesModel, target: bladesTarget },
    updateWindmill,
  };
};
