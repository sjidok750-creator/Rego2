// 렌더링: 인스턴스 브릭, 가려진 스터드 제거, PBR 플라스틱, GTAO, 부드러운 그림자, 필요할 때만 그리기.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PIECE_BY_ID, oriented, PLATE_H } from './pieces.js';
import { COLOR_BY_ID, colorOf } from './colors.js';
import { pieceParts, fullParts, studGeometry, studLocal } from './geometry.js';
import { cellKey } from './world.js';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export const QUALITY = {
  high: { dpr: 2, shadow: 4096, ao: true, msaa: 4, stud: 20 },
  medium: { dpr: 1.5, shadow: 2048, ao: true, msaa: 4, stud: 16 },
  low: { dpr: 1, shadow: 1024, ao: false, msaa: 0, stud: 12 },
};

function patchMaterial(mat, { glow = 0 } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = { value: glow };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRough;\nvarying float vRough;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = aRough;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRough;\nuniform float uGlow;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, vRough);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance += vColor.rgb * uGlow;\n#endif');
  };
  mat.customProgramCacheKey = () => 'brick' + glow;
  return mat;
}

function makeMaterials() {
  const solid = patchMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.21,
      metalness: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.16,
      specularIntensity: 0.7,
    }),
  );
  const trans = patchMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      specularIntensity: 1,
      clearcoat: 0.6,
    }),
    { glow: 0.22 },
  );
  const metal = patchMaterial(
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.75, clearcoat: 0.4, clearcoatRoughness: 0.25 }),
  );
  return { solid, trans, metal };
}

class InstGroup {
  constructor(stage, geo, material, capacity = 16) {
    this.stage = stage;
    this.geo = geo;
    this.material = material;
    this.ids = [];
    this.index = new Map();
    this.capacity = 0;
    this.mesh = null;
    this.grow(capacity);
  }
  grow(cap) {
    const old = this.mesh;
    const m = new THREE.InstancedMesh(this.geo, this.material, cap);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    if (old) {
      m.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, this.ids.length * 16));
      m.instanceColor.array.set(old.instanceColor.array.subarray(0, this.ids.length * 3));
      this.stage.bricksRoot.remove(old);
      old.dispose();
    }
    m.count = this.ids.length;
    this.mesh = m;
    this.capacity = cap;
    this.stage.bricksRoot.add(m);
  }
  add(id, matrix, color) {
    if (this.ids.length >= this.capacity) this.grow(this.capacity * 2);
    const i = this.ids.length;
    this.ids.push(id);
    this.index.set(id, i);
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.setColorAt(i, color);
    this.mesh.count = this.ids.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
  remove(id) {
    const i = this.index.get(id);
    if (i === undefined) return;
    const last = this.ids.length - 1;
    if (i !== last) {
      const lid = this.ids[last];
      this.mesh.getMatrixAt(last, tmpM);
      this.mesh.setMatrixAt(i, tmpM);
      this.mesh.getColorAt(last, tmpC);
      this.mesh.setColorAt(i, tmpC);
      this.ids[i] = lid;
      this.index.set(lid, i);
    }
    this.ids.pop();
    this.index.delete(id);
    this.mesh.count = this.ids.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
  setColor(id, color) {
    const i = this.index.get(id);
    if (i === undefined) return;
    this.mesh.setColorAt(i, color);
    this.mesh.instanceColor.needsUpdate = true;
  }
  clear() {
    this.ids = [];
    this.index.clear();
    this.mesh.count = 0;
  }
}

export class Stage {
  constructor(canvas, world, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.world = world;
    this.q = QUALITY[quality];
    this.qualityName = quality;
    this.dirty = true;
    this.animating = 0;
    this.tickers = new Set();

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.q.ao, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.dpr));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.bgTex = this.makeBackground();
    scene.background = this.bgTex;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;
    scene.environmentRotation = new THREE.Euler(0, 0.6, 0);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 800);
    camera.position.set(-38, 34, 44);
    this.camera = camera;

    const hemi = new THREE.HemisphereLight(0xf3f1ff, 0xd9c6ad, 0.48);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1df, 2.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 300;
    scene.add(sun, sun.target);
    this.sun = sun;
    this.sunDir = new THREE.Vector3(-0.62, 1.0, 0.42).normalize();
    const rim = new THREE.DirectionalLight(0xdfe8ff, 0.55);
    rim.position.set(30, 25, -40);
    scene.add(rim);

    // 바닥(그림자 받이)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ color: 0x3a2d1f, opacity: 0.3 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    this.ground = ground;

    this.bricksRoot = new THREE.Group();
    scene.add(this.bricksRoot);
    this.overlay = new THREE.Group();
    scene.add(this.overlay);
    this.fxRoot = new THREE.Group();
    scene.add(this.fxRoot);

    this.materials = makeMaterials();
    this.groups = new Map();
    this.rendered = new Map(); // brick id → {b, keys}
    this.hidden = new Set();
    this.colorOverride = null;
    this.studGeo = studGeometry(this.q.stud);
    this.studGroups = {};
    this.studsDirty = true;

    this.baseplate = { w: world.w, d: world.d, color: 'white', visible: true };
    this.baseGroup = new THREE.Group();
    scene.add(this.baseGroup);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.8;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 6;
    controls.maxDistance = 260;
    controls.screenSpacePanning = true;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.addEventListener('change', () => this.requestRender());
    this.controls = controls;

    this.markers = [];
    this.hints = new Set();
    this._viewOffsetY = 0;
    this.setupComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  makeBackground() {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 512;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#f6f3ee');
    grad.addColorStop(0.55, '#efebe4');
    grad.addColorStop(1, '#e6e0d6');
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  setupComposer() {
    if (this.composer) {
      this.composer.dispose?.();
      this.composer = null;
    }
    if (!this.q.ao) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: this.q.msaa });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.2, scale: 1.15, samples: 16, distanceFallOff: 1 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
    gtao.blendIntensity = 0.95;
    const origRender = gtao.render.bind(gtao);
    gtao.render = (...args) => {
      const ov = this.overlay.visible, fx = this.fxRoot.visible;
      this.overlay.visible = false;
      this.fxRoot.visible = false;
      origRender(...args);
      this.overlay.visible = ov;
      this.fxRoot.visible = fx;
    };
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.gtao = gtao;
  }

  setQuality(name) {
    if (!QUALITY[name] || name === this.qualityName) return;
    this.q = QUALITY[name];
    this.qualityName = name;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.dpr));
    this.sun.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.markers = [];
    this.hints = new Set();
    this._viewOffsetY = 0;
    this.setupComposer();
    this.resize();
  }

  set viewOffsetY(v) {
    if (Math.abs(v - this._viewOffsetY) < 1) return;
    this._viewOffsetY = v;
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 하단 도크에 가려지지 않도록 화면 중심을 위로 올린다
    const k = Math.min(this._viewOffsetY * 0.55, h * 0.25);
    if (k > 0) this.camera.setViewOffset(w, h + k, 0, k, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setSize(w, h);
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
    }
    this.requestRender();
  }

  requestRender() {
    this.dirty = true;
  }

  // 월드 좌표 변환: 격자 원점(0,0)이 바닥판 모서리, 바닥판 중심이 원점
  gridToWorld(x, y, z, out = new THREE.Vector3()) {
    return out.set(x - this.world.w / 2, y * PLATE_H, z - this.world.d / 2);
  }

  brickMatrix(b, out = new THREE.Matrix4(), lift = 0, squash = 1) {
    const piece = PIECE_BY_ID[b.piece];
    const o = oriented(piece, b.rot);
    this.gridToWorld(b.x + o.w / 2, b.y, b.z + o.d / 2, tmpV);
    tmpV.y += lift;
    tmpQ.setFromAxisAngle(UP, (b.rot * Math.PI) / 2);
    const xz = 1 + (1 - squash) * 0.5;
    tmpS.set(xz, squash, xz);
    return out.compose(tmpV, tmpQ, tmpS);
  }

  colorFor(b, partFixed) {
    const cid = partFixed || b.color;
    if (this.colorOverride && !partFixed) {
      const c = this.colorOverride(b);
      if (c) return c;
    }
    return tmpC.set(colorOf(cid).hex);
  }

  groupFor(pieceId, partIdx, cls, geo) {
    const key = `${pieceId}:${partIdx}:${cls}`;
    let g = this.groups.get(key);
    if (!g) {
      g = new InstGroup(this, geo, this.materials[cls], 8);
      this.groups.set(key, g);
    }
    return { g, key };
  }

  addBrick(b) {
    if (this.rendered.has(b.id)) this.removeBrick(b.id);
    const piece = PIECE_BY_ID[b.piece];
    const parts = pieceParts(piece);
    const m = this.brickMatrix(b);
    const keys = [];
    parts.forEach((p, i) => {
      const cid = p.fixed || b.color;
      const cls = colorOf(cid).cls;
      const { g, key } = this.groupFor(b.piece, i, cls, p.geo);
      g.add(b.id, m, this.colorFor(b, p.fixed));
      keys.push(key);
    });
    this.rendered.set(b.id, { b, keys });
    this.studsDirty = true;
    this.requestRender();
  }

  removeBrick(id) {
    const r = this.rendered.get(id);
    if (!r) return;
    for (const k of r.keys) this.groups.get(k)?.remove(id);
    this.rendered.delete(id);
    this.studsDirty = true;
    this.requestRender();
  }

  refreshBrick(b) {
    this.addBrick(b);
  }

  clearBricks() {
    for (const g of this.groups.values()) g.clear();
    this.rendered.clear();
    this.studsDirty = true;
    this.requestRender();
  }

  recolorAll() {
    for (const { b, keys } of this.rendered.values()) {
      const parts = pieceParts(PIECE_BY_ID[b.piece]);
      keys.forEach((k, i) => this.groups.get(k)?.setColor(b.id, this.colorFor(b, parts[i].fixed)));
    }
    this.studsDirty = true;
    this.requestRender();
  }

  setColorOverride(fn) {
    this.colorOverride = fn;
    this.recolorAll();
  }

  // ── 스터드: 위가 막힌 스터드는 그리지 않는다 ──────────
  rebuildStuds() {
    this.studsDirty = false;
    const lists = { solid: [], trans: [], metal: [] };
    const occ = this.world.occ;
    const visibleAt = (x, y, z) => {
      const id = occ.get(cellKey(x, y, z));
      return id === undefined || !this.rendered.has(id);
    };
    for (const { b } of this.rendered.values()) {
      const piece = PIECE_BY_ID[b.piece];
      if (!piece.studs.length) continue;
      const o = oriented(piece, b.rot);
      const top = b.y + o.h;
      const col = this.colorFor(b).clone();
      const cls = colorOf(b.color).cls;
      for (let i = 0; i < o.studs.length; i++) {
        const [sx, sz] = o.studs[i];
        if (!visibleAt(b.x + sx, top, b.z + sz)) continue;
        lists[cls].push(b.x + sx + 0.5, top, b.z + sz + 0.5, col);
      }
    }
    // 바닥판 스터드
    const base = [];
    if (this.baseplate.visible) {
      for (let z = 0; z < this.world.d; z++) for (let x = 0; x < this.world.w; x++) if (visibleAt(x, 0, z)) base.push(x + 0.5, 0, z + 0.5);
    }
    for (const cls of Object.keys(lists)) {
      const arr = lists[cls];
      const n = arr.length / 4;
      let g = this.studGroups[cls];
      if (!g || g.capacity < n) {
        if (g) {
          this.bricksRoot.remove(g.mesh);
          g.mesh.dispose();
        }
        const cap = Math.max(64, Math.ceil(n * 1.5));
        const mesh = new THREE.InstancedMesh(this.studGeo, this.materials[cls], cap);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        this.bricksRoot.add(mesh);
        g = this.studGroups[cls] = { mesh, capacity: cap };
      }
      const mesh = g.mesh;
      for (let i = 0; i < n; i++) {
        this.gridToWorld(arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2], tmpV);
        tmpM.makeTranslation(tmpV.x, tmpV.y, tmpV.z);
        mesh.setMatrixAt(i, tmpM);
        mesh.setColorAt(i, arr[i * 4 + 3]);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
    this.rebuildBaseStuds(base);
  }

  rebuildBaseStuds(list) {
    const n = list.length / 3;
    let g = this.baseStuds;
    if (!g || g.capacity < n) {
      if (g) {
        this.baseGroup.remove(g.mesh);
        g.mesh.dispose();
      }
      const cap = Math.max(64, this.world.w * this.world.d);
      const mesh = new THREE.InstancedMesh(this.studGeo, this.materials.solid, cap);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      this.baseGroup.add(mesh);
      g = this.baseStuds = { mesh, capacity: cap };
    }
    const col = tmpC.set(colorOf(this.baseplate.color).hex);
    for (let i = 0; i < n; i++) {
      this.gridToWorld(list[i * 3], 0, list[i * 3 + 2], tmpV);
      tmpM.makeTranslation(tmpV.x, tmpV.y, tmpV.z);
      g.mesh.setMatrixAt(i, tmpM);
      g.mesh.setColorAt(i, col);
    }
    g.mesh.count = n;
    g.mesh.instanceMatrix.needsUpdate = true;
    g.mesh.instanceColor.needsUpdate = true;
  }

  setBaseplate({ w, d, color, visible }) {
    Object.assign(this.baseplate, { w: w ?? this.baseplate.w, d: d ?? this.baseplate.d });
    if (color) this.baseplate.color = color;
    if (visible !== undefined) this.baseplate.visible = visible;
    if (this.baseBody) {
      this.baseGroup.remove(this.baseBody);
      this.baseBody.geometry.dispose();
    }
    const W = this.world.w, D = this.world.d;
    const geo = new THREE.BoxGeometry(W - 0.02, 0.16, D - 0.02);
    geo.translate(0, -0.08, 0);
    const mat = new THREE.MeshPhysicalMaterial({ color: colorOf(this.baseplate.color).hex, roughness: 0.3, clearcoat: 0.15, sheen: 0.2 });
    this.baseBody = new THREE.Mesh(geo, mat);
    this.baseBody.receiveShadow = true;
    this.baseBody.castShadow = true;
    this.baseGroup.add(this.baseBody);
    this.baseGroup.visible = this.baseplate.visible;
    this.ground.position.y = this.baseplate.visible ? -0.161 : -0.002;
    this.studsDirty = true;
    this.requestRender();
  }

  // ── 떠다니는(애니메이션) 브릭 ─────────────────────────
  makeLoose(b, { opacity = 1, emissive = 0 } = {}) {
    const piece = PIECE_BY_ID[b.piece];
    const group = new THREE.Group();
    const mats = [];
    for (const p of fullParts(piece)) {
      const cid = p.fixed || b.color;
      const c = colorOf(cid);
      const base = this.materials[c.cls];
      const mat = base.clone();
      mat.onBeforeCompile = base.onBeforeCompile;
      mat.customProgramCacheKey = base.customProgramCacheKey;
      mat.color = new THREE.Color(this.colorOverride && !p.fixed ? this.colorFor(b) : c.hex);
      if (opacity < 1) {
        mat.transparent = true;
        mat.opacity = opacity * (c.cls === 'trans' ? 0.6 : 1);
      }
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveIntensity = emissive;
      const mesh = new THREE.Mesh(p.geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      mats.push(mat);
    }
    group.userData.mats = mats;
    group.matrixAutoUpdate = false;
    this.brickMatrix(b, group.matrix);
    this.fxRoot.add(group);
    return group;
  }

  disposeLoose(g) {
    this.fxRoot.remove(g);
    for (const m of g.userData.mats) m.dispose();
  }

  // ── 고스트(놓일 자리 미리보기) ─────────────────────────
  setGhost(pieceId, colorId) {
    if (this.ghost && this.ghost.userData.key === pieceId + colorId) return;
    this.clearGhost();
    const piece = PIECE_BY_ID[pieceId];
    const g = new THREE.Group();
    const mats = [];
    for (const p of fullParts(piece)) {
      const c = colorOf(p.fixed || colorId);
      const mat = new THREE.MeshPhysicalMaterial({
        color: c.hex,
        roughness: 0.3,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        emissive: new THREE.Color(c.hex),
        emissiveIntensity: 0.12,
      });
      const m = new THREE.Mesh(p.geo, mat);
      m.renderOrder = 5;
      g.add(m);
      mats.push(mat);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(p.geo, 30), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
      edges.renderOrder = 6;
      g.add(edges);
      mats.push(edges.material);
    }
    g.userData = { key: pieceId + colorId, mats, pieceId };
    g.matrixAutoUpdate = false;
    g.visible = false;
    this.ghost = g;
    this.overlay.add(g);
  }

  clearGhost() {
    if (!this.ghost) return;
    this.overlay.remove(this.ghost);
    for (const c of this.ghost.children) {
      if (c.isLineSegments) c.geometry.dispose();
    }
    for (const m of this.ghost.userData.mats) m.dispose();
    this.ghost = null;
    this.requestRender();
  }

  showGhost(b, valid, colorId) {
    if (!this.ghost) return;
    const g = this.ghost;
    const target = this.brickMatrix(b, new THREE.Matrix4(), 0);
    g.userData.target = target;
    if (!g.visible || g.userData.rot !== b.rot) {
      g.userData.rot = b.rot;
      g.matrix.copy(target);
      g.visible = true;
    }
    const bad = new THREE.Color(0xe0442e);
    g.userData.mats.forEach((m, i) => {
      if (m.isLineBasicMaterial) {
        m.color.set(valid ? 0xffffff : 0xffb4a8);
      } else {
        const fixed = fullParts(PIECE_BY_ID[g.userData.pieceId])[Math.floor(i / 2)]?.fixed;
        const c = new THREE.Color(colorOf(fixed || colorId).hex);
        m.color.copy(valid ? c : bad);
        m.emissive.copy(valid ? c : bad);
        m.opacity = valid ? 0.62 : 0.5;
      }
    });
    this.requestRender();
  }

  hideGhost() {
    if (this.ghost && this.ghost.visible) {
      this.ghost.visible = false;
      this.requestRender();
    }
  }

  // ── 선택 강조(지우기/칠하기 대상) ─────────────────────
  setHover(b, color = 0xe0442e) {
    if (this.hoverBox) {
      this.overlay.remove(this.hoverBox);
      this.hoverBox.geometry.dispose();
      this.hoverBox.material.dispose();
      this.hoverBox = null;
    }
    if (b) {
      const o = oriented(PIECE_BY_ID[b.piece], b.rot);
      const geo = new THREE.BoxGeometry(o.w + 0.06, o.h * PLATE_H + 0.06, o.d + 0.06);
      const edges = new THREE.EdgesGeometry(geo);
      geo.dispose();
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
      line.renderOrder = 10;
      this.gridToWorld(b.x + o.w / 2, b.y + o.h / 2, b.z + o.d / 2, line.position);
      this.overlay.add(line);
      this.hoverBox = line;
    }
    this.requestRender();
  }

  // ── 효과: 결합 링 ────────────────────────────────────
  snapRing(b) {
    const o = oriented(PIECE_BY_ID[b.piece], b.rot);
    const geo = new THREE.RingGeometry(0.92, 1, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false });
    const ring = new THREE.Mesh(geo, mat);
    this.gridToWorld(b.x + o.w / 2, b.y, b.z + o.d / 2, ring.position);
    ring.position.y += 0.02;
    const base = Math.min(3.2, Math.max(o.w, o.d) * 0.6 + 0.3);
    this.fxRoot.add(ring);
    this.animate(420, (t) => {
      const e = 1 - Math.pow(1 - t, 3);
      ring.scale.setScalar(base * (0.7 + 0.8 * e));
      mat.opacity = 0.75 * (1 - t);
    }, () => {
      this.fxRoot.remove(ring);
      geo.dispose();
      mat.dispose();
    });
  }

  // 간단한 트윈 러너
  animate(duration, fn, done) {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      fn(t);
      if (t >= 1) {
        this.tickers.delete(tick);
        done?.();
      }
    };
    this.tickers.add(tick);
    this.requestRender();
    return () => this.tickers.delete(tick);
  }

  // ── 카메라 ───────────────────────────────────────────
  frameBounds(bounds, { instant = false, azimuth = -0.72, polar = 0.98, pad = 0.94 } = {}) {
    let cx = 0, cy = 2, cz = 0, radius = 14;
    if (bounds) {
      const a = this.gridToWorld(bounds.minX, bounds.minY, bounds.minZ);
      const b = this.gridToWorld(bounds.maxX, bounds.maxY, bounds.maxZ);
      cx = (a.x + b.x) / 2;
      cy = (a.y + b.y) / 2;
      cz = (a.z + b.z) / 2;
      radius = Math.max(4, a.distanceTo(b) / 2);
    }
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.min(1, this.camera.aspect);
    const h = this.canvas.clientHeight || window.innerHeight;
    const k = Math.min(this._viewOffsetY * 0.55, h * 0.25);
    const dist = ((radius * pad) / Math.sin(fov / 2) / Math.max(0.5, aspect)) * (1 + k / h);
    const target = new THREE.Vector3(cx, cy * 0.85, cz);
    const pos = new THREE.Vector3(
      target.x + dist * Math.sin(polar) * Math.sin(azimuth),
      target.y + dist * Math.cos(polar),
      target.z + dist * Math.sin(polar) * Math.cos(azimuth),
    );
    this.fitShadow(target, radius);
    if (instant) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.controls.update();
      this.requestRender();
      return;
    }
    const t0 = this.controls.target.clone(), p0 = this.camera.position.clone();
    this.animate(700, (t) => {
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.controls.target.lerpVectors(t0, target, e);
      this.camera.position.lerpVectors(p0, pos, e);
      this.controls.update();
    });
  }

  fitShadow(target, radius) {
    const r = Math.max(radius * 1.25, 10);
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = r * 4 + 40;
    cam.updateProjectionMatrix();
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, r * 2 + 20);
    this.sun.shadow.needsUpdate = true;
    this.requestRender();
  }

  loop() {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    if (this.tickers.size) {
      for (const t of [...this.tickers]) t(now);
      this.dirty = true;
    }
    if (this.onFrame) this.onFrame(now);
    if (this.markers.length) this.updateMarkers(now);
    if (this.hints.size) {
      const a = 0.3 + 0.16 * Math.sin(now / 260);
      for (const h of this.hints) for (const m of h.userData.mats) m.opacity = m.isLineBasicMaterial ? a + 0.25 : a;
      this.dirty = true;
    }
    const moving = this.controls.update();
    if (moving) this.dirty = true;
    if (this.ghost && this.ghost.visible && this.ghost.userData.target) {
      // 고스트는 살짝 부드럽게 따라온다
      const m = this.ghost.matrix;
      const t = this.ghost.userData.target;
      let diff = 0;
      for (let i = 0; i < 16; i++) {
        const d = t.elements[i] - m.elements[i];
        diff += Math.abs(d);
        m.elements[i] += d * 0.45;
      }
      if (diff > 1e-4) this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    if (this.studsDirty) this.rebuildStuds();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.afterRender?.();
  }

  // ── 썸네일 ───────────────────────────────────────────
  // 같은 조명·재질로 그려야 셰이더를 다시 컴파일하지 않는다: 메인 장면에서 나머지를 숨기고 그린다
  isolatedRender(root, cam, pw, ph) {
    const r = this.renderer;
    const dpr = r.getPixelRatio();
    const hide = [this.bricksRoot, this.overlay, this.fxRoot, this.baseGroup, this.ground];
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    const bg = this.scene.background;
    this.scene.background = null;
    this.scene.add(root);
    const prevVp = new THREE.Vector4();
    r.getViewport(prevVp);
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearAlpha();
    r.setRenderTarget(null);
    r.setViewport(0, 0, pw / dpr, ph / dpr);
    r.setScissor(0, 0, pw / dpr, ph / dpr);
    r.setScissorTest(true);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, cam);
    const H = r.domElement.height;
    const grab = (w, h) => {
      const c2 = document.createElement('canvas');
      c2.width = w;
      c2.height = h;
      c2.getContext('2d').drawImage(r.domElement, 0, H - ph, pw, ph, 0, 0, w, h);
      return c2.toDataURL('image/png');
    };
    const out = { grab };
    this._finishIsolated = () => {
      r.setScissorTest(false);
      r.setViewport(prevVp);
      r.setRenderTarget(prevTarget);
      r.setClearAlpha(prevClear);
      this.scene.remove(root);
      hide.forEach((o, i) => (o.visible = vis[i]));
      this.scene.background = bg;
      this.sun.shadow.needsUpdate = true;
      this.requestRender();
    };
    return out;
  }

  thumbCam() {
    if (!this._thumbCam) this._thumbCam = new THREE.PerspectiveCamera(24, 1, 0.1, 400);
    return this._thumbCam;
  }

  // 부품 아이콘: 캔버스 dataURL
  pieceThumbs(requests, size = 96) {
    const cam = this.thumbCam();
    const px = size * 2;
    const out = [];
    for (const { pieceId, colorId } of requests) {
      const piece = PIECE_BY_ID[pieceId];
      const g = new THREE.Group();
      const mats = [];
      for (const p of fullParts(piece)) {
        const c = colorOf(p.fixed || colorId);
        const base = this.materials[c.cls];
        const mat = base.clone();
        mat.onBeforeCompile = base.onBeforeCompile;
        mat.customProgramCacheKey = base.customProgramCacheKey;
        mat.color = new THREE.Color(c.hex);
        mat.emissive = new THREE.Color(0xffffff);
        mat.emissiveIntensity = 0;
        mats.push(mat);
        g.add(new THREE.Mesh(p.geo, mat));
      }
      const box = new THREE.Box3().setFromObject(g);
      const sph = box.getBoundingSphere(new THREE.Sphere());
      const dist = (sph.radius / Math.sin((cam.fov * Math.PI) / 360)) * 1.02;
      const dir = new THREE.Vector3(-0.8, 0.75, 1).normalize();
      cam.position.copy(sph.center).addScaledVector(dir, dist);
      cam.aspect = 1;
      cam.updateProjectionMatrix();
      cam.lookAt(sph.center);
      const res = this.isolatedRender(g, cam, px, px);
      out.push(res.grab(size, size));
      this._finishIsolated();
      for (const m of mats) m.dispose();
    }
    return out;
  }

  // 모델 썸네일: 브릭 목록을 임시 인스턴스로 그림
  modelThumb(model, w = 320, h = 220) {
    const root = new THREE.Group();
    const byKey = new Map();
    const W = model.w, D = model.d;
    const occ = new Set();
    for (const [pid, x, y, z, rot] of model.bricks) {
      for (const [cx, cy, cz] of oriented(PIECE_BY_ID[pid], rot).cells) occ.add(cellKey(x + cx, y + cy, z + cz));
    }
    const studs = { solid: [], trans: [], metal: [] };
    for (const [pid, x, y, z, rot, color] of model.bricks) {
      const piece = PIECE_BY_ID[pid];
      const o = oriented(piece, rot);
      pieceParts(piece).forEach((p, i) => {
        const cid = p.fixed || color;
        const cls = colorOf(cid).cls;
        const key = pid + ':' + i + ':' + cls;
        if (!byKey.has(key)) byKey.set(key, { geo: p.geo, cls, items: [] });
        byKey.get(key).items.push([x + o.w / 2 - W / 2, y * PLATE_H, z + o.d / 2 - D / 2, rot, cid]);
      });
      const top = y + o.h;
      for (const [sx, sz] of o.studs) {
        if (occ.has(cellKey(x + sx, top, z + sz))) continue;
        studs[colorOf(color).cls].push([x + sx + 0.5 - W / 2, top * PLATE_H, z + sz + 0.5 - D / 2, 0, color]);
      }
    }
    for (const cls of Object.keys(studs)) if (studs[cls].length) byKey.set('stud:' + cls, { geo: this.studGeo, cls, items: studs[cls] });
    const mats = [];
    for (const { geo, cls, items } of byKey.values()) {
      const mesh = new THREE.InstancedMesh(geo, this.materials[cls], items.length);
      items.forEach(([x, y, z, rot, cid], i) => {
        tmpQ.setFromAxisAngle(UP, (rot * Math.PI) / 2);
        tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(1, 1, 1));
        mesh.setMatrixAt(i, tmpM);
        mesh.setColorAt(i, tmpC.set(colorOf(cid).hex));
      });
      root.add(mesh);
      mats.push(mesh);
    }
    const box = new THREE.Box3().setFromObject(root);
    const sph = box.getBoundingSphere(new THREE.Sphere());
    const cam = this.thumbCam();
    cam.aspect = w / h;
    const dist = (sph.radius / Math.sin((cam.fov * Math.PI) / 360)) * 0.92;
    const dir = new THREE.Vector3(-0.66, 0.62, 0.92).normalize();
    cam.position.copy(sph.center).addScaledVector(dir, dist);
    cam.updateProjectionMatrix();
    cam.lookAt(sph.center.x, sph.center.y * 0.9, sph.center.z);
    const res = this.isolatedRender(root, cam, Math.round(w * 2), Math.round(h * 2));
    const url = res.grab(w, h);
    this._finishIsolated();
    for (const m of mats) m.dispose();
    return url;
  }

  // ── 설명서 힌트(끼울 자리) ─────────────────────────────
  makeHint(b) {
    const piece = PIECE_BY_ID[b.piece];
    const g = new THREE.Group();
    const mats = [];
    for (const p of fullParts(piece)) {
      const c = colorOf(p.fixed || b.color);
      const mat = new THREE.MeshPhysicalMaterial({ color: c.hex, emissive: c.hex, emissiveIntensity: 0.25, roughness: 0.4, transparent: true, opacity: 0.35, depthWrite: false });
      const m = new THREE.Mesh(p.geo, mat);
      m.renderOrder = 4;
      g.add(m);
      mats.push(mat);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(p.geo, 30), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
      e.renderOrder = 5;
      g.add(e);
      mats.push(e.material);
    }
    g.matrixAutoUpdate = false;
    this.brickMatrix(b, g.matrix);
    const o = oriented(piece, b.rot);
    g.userData = {
      mats,
      min: this.gridToWorld(b.x, b.y, b.z),
      max: this.gridToWorld(b.x + o.w, b.y + o.h, b.z + o.d),
    };
    this.overlay.add(g);
    this.hints.add(g);
    this.requestRender();
    return g;
  }

  disposeHint(g) {
    this.overlay.remove(g);
    this.hints.delete(g);
    for (const c of g.children) if (c.isLineSegments) c.geometry.dispose();
    for (const m of g.userData.mats) m.dispose();
    this.requestRender();
  }

  // ── 구조 분석 스캔 ────────────────────────────────────
  ringTexture(kind) {
    this._rings = this._rings || {};
    if (this._rings[kind]) return this._rings[kind];
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const fill = kind === 'crit' ? '#d6412c' : kind === 'warn' ? '#ec8a2a' : '#ffffff';
    const stroke = kind === 'normal' ? '#2a2723' : '#ffffff';
    g.beginPath();
    g.arc(64, 64, 50, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = 12;
    g.strokeStyle = stroke;
    g.stroke();
    if (kind !== 'normal') {
      g.fillStyle = '#ffffff';
      g.fillRect(58, 34, 12, 38);
      g.beginPath();
      g.arc(64, 86, 7, 0, Math.PI * 2);
      g.fill();
    } else {
      g.beginPath();
      g.arc(64, 64, 18, 0, Math.PI * 2);
      g.lineWidth = 8;
      g.strokeStyle = '#2a2723';
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this._rings[kind] = t;
    return t;
  }

  clearMarkers() {
    for (const m of this.markers) {
      this.overlay.remove(m);
      m.material.dispose();
    }
    this.markers = [];
    if (this.scanPlane) {
      this.overlay.remove(this.scanPlane);
      this.scanPlane.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      this.scanPlane = null;
    }
    this._cancelScan?.();
    this.requestRender();
  }

  scan(a, { onPing, onDone, duration = 1700 } = {}) {
    this.clearMarkers();
    const bounds = this.world.bounds();
    if (!bounds) {
      onDone?.();
      return;
    }
    const picks = [];
    for (const it of a.issues) picks.push({ at: it.at, kind: it.severity === 'crit' ? 'crit' : 'warn' });
    const js = a.joints.filter((j) => !j.ground);
    const sorted = js.slice().sort((p, q) => q.ratio - p.ratio);
    const chosen = new Set(sorted.slice(0, 18));
    const stride = Math.max(1, Math.floor(js.length / 46));
    for (let i = 0; i < js.length; i += stride) chosen.add(js[i]);
    for (const j of chosen) {
      if (picks.some((p) => Math.abs(p.at[0] - j.at[0]) + Math.abs(p.at[1] - j.at[1]) * 0.4 + Math.abs(p.at[2] - j.at[2]) < 1.2)) continue;
      picks.push({ at: j.at, kind: 'normal' });
    }
    for (const p of picks) {
      const mat = new THREE.SpriteMaterial({ map: this.ringTexture(p.kind), depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false, toneMapped: false });
      const sp = new THREE.Sprite(mat);
      this.gridToWorld(p.at[0], p.at[1], p.at[2], sp.position);
      sp.renderOrder = 30;
      sp.visible = false;
      sp.userData = { y: p.at[1], kind: p.kind, born: 0, base: p.kind === 'normal' ? 0.017 : 0.028 };
      sp.scale.setScalar(0.0001);
      this.overlay.add(sp);
      this.markers.push(sp);
    }
    // 스캔 면
    const a0 = this.gridToWorld(bounds.minX - 1.5, 0, bounds.minZ - 1.5);
    const a1 = this.gridToWorld(bounds.maxX + 1.5, 0, bounds.maxZ + 1.5);
    const geo = new THREE.PlaneGeometry(a1.x - a0.x, a1.z - a0.z);
    geo.rotateX(-Math.PI / 2);
    const plane = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xf0a24a, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xe2862a, transparent: true, opacity: 0.9, toneMapped: false }));
    plane.add(edge);
    plane.position.set((a0.x + a1.x) / 2, 0, (a0.z + a1.z) / 2);
    plane.renderOrder = 3;
    this.scanPlane = plane;
    this.overlay.add(plane);
    const y0 = bounds.minY - 1, y1 = bounds.maxY + 2;
    const cancel = this.animate(
      duration,
      (t) => {
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const yy = y0 + (y1 - y0) * e;
        plane.position.y = yy * PLATE_H;
        plane.material.opacity = 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.05));
        const now = performance.now();
        for (const m of this.markers) {
          if (!m.visible && m.userData.y <= yy) {
            m.visible = true;
            m.userData.born = now;
            onPing?.(m.userData.y, m.userData.kind !== 'normal');
          }
        }
      },
      () => {
        if (this.scanPlane) {
          this.overlay.remove(this.scanPlane);
          this.scanPlane.traverse((o) => {
            o.geometry?.dispose();
            o.material?.dispose();
          });
          this.scanPlane = null;
        }
        const tEnd = performance.now();
        for (const m of this.markers) {
          m.visible = true;
          if (m.userData.kind === 'normal') m.userData.fadeAt = tEnd + 1600;
        }
        onDone?.();
      },
    );
    this._cancelScan = cancel;
  }

  updateMarkers(now) {
    let alive = false;
    for (const m of this.markers) {
      if (!m.visible) {
        if (!m.userData.fadeAt) alive = true;
        continue;
      }
      const u = m.userData;
      const age = now - u.born;
      let s = u.base * (1 + 0.8 * Math.exp(-age / 90)) * Math.min(1, age / 60 + 0.2);
      if (u.kind !== 'normal') s *= 1 + 0.14 * Math.sin(now / 180);
      if (u.fadeAt) {
        const f = Math.max(0, 1 - (now - u.fadeAt) / 500);
        m.material.opacity = f;
        if (f <= 0) m.visible = false;
        else alive = true;
      } else alive = true;
      m.scale.setScalar(s);
    }
    if (alive) this.dirty = true;
  }

  screenshot() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  // 화면 좌표 → 광선
  rayFrom(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return rc.ray;
  }

  project(x, y, z) {
    const v = this.gridToWorld(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, z: v.z };
  }
}

export { COLOR_BY_ID };
