import { Audio } from 'expo-av';
import { GLView } from 'expo-gl';
import { StatusBar } from 'expo-status-bar';
import { Renderer } from 'expo-three';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as THREE from 'three';

type Screen = 'menu' | 'game';

type RollAnim = {
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  axis: THREE.Vector3;
  pivot: THREE.Vector3;
  elapsed: number;
  duration: number;
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const BUILD_TAG = 'roll-rect-1';

const FLOOR_Y = 0.01;
const ARENA_HALF = 9.8;
const BLOCK_SIZE = { x: 1.45, y: 0.9, z: 2.25 };
const HALF = {
  x: BLOCK_SIZE.x / 2,
  y: BLOCK_SIZE.y / 2,
  z: BLOCK_SIZE.z / 2,
};

let splooshAudioContext: any = null;
let splooshSound: Audio.Sound | null = null;
let splooshLoadPromise: Promise<void> | null = null;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function playSplooshWebFallback(intensity = 1) {
  try {
    const globalAny = globalThis as any;
    const AudioCtx = globalAny.AudioContext || globalAny.webkitAudioContext;
    if (!AudioCtx) return;

    if (!splooshAudioContext) splooshAudioContext = new AudioCtx();
    const ctx: any = splooshAudioContext;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime as number;
    const len = Math.floor(ctx.sampleRate * 0.09);

    const noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const falloff = 1 - i / len;
      data[i] = (Math.random() * 2 - 1) * falloff;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(980 * intensity, now);
    filter.frequency.exponentialRampToValueAtTime(170, now + 0.14);

    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.exponentialRampToValueAtTime(0.34 * intensity, now + 0.012);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

    noise.connect(filter);
    filter.connect(g1);
    g1.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.16);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(176, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.16);

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, now);
    g2.gain.exponentialRampToValueAtTime(0.11 * intensity, now + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

    osc.connect(g2);
    g2.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  } catch {
    // no-op
  }
}

async function ensureSplooshLoaded() {
  if (splooshSound) return;
  if (!splooshLoadPromise) {
    splooshLoadPromise = (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        });

        const loaded = await Audio.Sound.createAsync(
          require('./assets/sounds/cheese-sploosh.wav'),
          { shouldPlay: false, volume: 0.9 }
        );
        splooshSound = loaded.sound;
      } catch {
        splooshSound = null;
      }
    })();
  }

  await splooshLoadPromise;
}

function playSploosh(intensity = 1) {
  const rate = clamp(0.9 + intensity * 0.16, 0.82, 1.4);
  const volume = clamp(0.26 + intensity * 0.3, 0.18, 1);

  void (async () => {
    try {
      await ensureSplooshLoaded();
      if (splooshSound) {
        await splooshSound.replayAsync({ rate, shouldCorrectPitch: true, volume });
        return;
      }
    } catch {
      // fallback below
    }

    playSplooshWebFallback(intensity);
  })();
}

function supportRadius(q: THREE.Quaternion, dir: THREE.Vector3) {
  const ux = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const uy = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const uz = new THREE.Vector3(0, 0, 1).applyQuaternion(q);

  return (
    Math.abs(dir.dot(ux)) * HALF.x +
    Math.abs(dir.dot(uy)) * HALF.y +
    Math.abs(dir.dot(uz)) * HALF.z
  );
}

function restingCenterY(q: THREE.Quaternion) {
  return FLOOR_Y + supportRadius(q, new THREE.Vector3(0, 1, 0));
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');

  return (
    <SafeAreaView style={styles.safe}>
      {screen === 'menu' && <MainMenu onStart={() => setScreen('game')} />}
      {screen === 'game' && <CubeLab onBack={() => setScreen('menu')} />}
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

function MainMenu({ onStart }: { onStart: () => void }) {
  return (
    <View style={styles.menuWrap}>
      <View style={styles.menuOrbA} />
      <View style={styles.menuOrbB} />

      <Text style={styles.kicker}>ADVANCED 3D PROTOTYPE</Text>
      <Text style={styles.title}>Cream Cheese Block Lab</Text>
      <Text style={styles.copyCenter}>Now true 3D with a rectangular cream-cheese block.</Text>
      <Text style={styles.copyCenter}>Swipe to roll face-to-face like a dice block on a table.</Text>

      <Pressable style={styles.menuButtonPrimary} onPress={onStart}>
        <Text style={styles.menuButtonPrimaryText}>Start Run</Text>
      </Pressable>
    </View>
  );
}

function CubeLab({ onBack }: { onBack: () => void }) {
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const blockRef = useRef<THREE.Mesh | null>(null);
  const shadowRef = useRef<THREE.Mesh | null>(null);
  const rafRef = useRef<number | null>(null);

  const blockStateRef = useRef({
    pos: new THREE.Vector3(0, HALF.y + FLOOR_Y, 0),
    quat: new THREE.Quaternion(),
  });

  const rollRef = useRef<RollAnim | null>(null);
  const cameraTargetRef = useRef({ yaw: 8, pitch: 28 });
  const cameraStateRef = useRef({ yaw: 8, pitch: 28 });
  const cameraFollowRef = useRef({ x: 0, z: 0, y: HALF.y + FLOOR_Y });

  const gestureModeRef = useRef<'move' | 'camera' | null>(null);
  const lastGestureRef = useRef({ dx: 0, dy: 0 });

  const [hud, setHud] = useState({ speed: '0.00', cam: '8°' });
  const lastHudRef = useRef(0);
  const prevPosForSpeedRef = useRef(new THREE.Vector3(0, HALF.y + FLOOR_Y, 0));
  const lastTsRef = useRef(0);

  const tryRoll = useCallback((dirWorld: THREE.Vector3) => {
    if (rollRef.current) return;

    const d = dirWorld.clone().setY(0);
    if (d.lengthSq() < 1e-5) return;
    d.normalize();

    const state = blockStateRef.current;
    const q0 = state.quat.clone();
    const c0 = state.pos.clone();

    const up = new THREE.Vector3(0, 1, 0);
    const axis = new THREE.Vector3().crossVectors(up, d).normalize();
    if (axis.lengthSq() < 1e-5) return;

    const rUp = supportRadius(q0, up);
    const rDir = supportRadius(q0, d);
    const pivot = c0.clone().addScaledVector(d, rDir).addScaledVector(up, -rUp);

    const rot90 = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2);
    const testPos = c0.clone().sub(pivot).applyQuaternion(rot90).add(pivot);

    if (Math.abs(testPos.x) > ARENA_HALF || Math.abs(testPos.z) > ARENA_HALF) {
      playSploosh(0.55);
      return;
    }

    rollRef.current = {
      fromPos: c0,
      fromQuat: q0,
      axis,
      pivot,
      elapsed: 0,
      duration: 0.16,
    };

    playSploosh(0.88);
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
        onPanResponderGrant: (evt) => {
          gestureModeRef.current = evt.nativeEvent.locationX > SCREEN_WIDTH * 0.52 ? 'camera' : 'move';
          lastGestureRef.current = { dx: 0, dy: 0 };
        },
        onPanResponderMove: (_, g) => {
          if (gestureModeRef.current !== 'camera') return;

          const ddx = g.dx - lastGestureRef.current.dx;
          const ddy = g.dy - lastGestureRef.current.dy;
          lastGestureRef.current = { dx: g.dx, dy: g.dy };

          cameraTargetRef.current.yaw = clamp(cameraTargetRef.current.yaw + ddx * 0.42, -155, 155);
          cameraTargetRef.current.pitch = clamp(cameraTargetRef.current.pitch - ddy * 0.27, 18, 38);
        },
        onPanResponderRelease: (_, g) => {
          if (gestureModeRef.current === 'move') {
            const dx = g.dx;
            const dy = g.dy;
            if (Math.hypot(dx, dy) > 16) {
              const yaw = THREE.MathUtils.degToRad(cameraStateRef.current.yaw);
              const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
              const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

              if (Math.abs(dx) > Math.abs(dy)) {
                tryRoll(dx > 0 ? right : right.clone().multiplyScalar(-1));
              } else {
                tryRoll(dy < 0 ? fwd : fwd.clone().multiplyScalar(-1));
              }
            }
          }

          gestureModeRef.current = null;
          lastGestureRef.current = { dx: 0, dy: 0 };
        },
        onPanResponderTerminate: () => {
          gestureModeRef.current = null;
          lastGestureRef.current = { dx: 0, dy: 0 };
        },
      }),
    [tryRoll]
  );

  useEffect(() => {
    void ensureSplooshLoaded();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (
        key === 'a' ||
        key === 'd' ||
        key === 'w' ||
        key === 's' ||
        key === ' ' ||
        key === 'arrowleft' ||
        key === 'arrowright' ||
        key === 'arrowup' ||
        key === 'arrowdown'
      ) {
        event.preventDefault();
      }

      const yaw = THREE.MathUtils.degToRad(cameraStateRef.current.yaw);
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

      if (key === 'a') return void tryRoll(right.clone().multiplyScalar(-1));
      if (key === 'd') return void tryRoll(right);
      if (key === 'w' || key === ' ') return void tryRoll(fwd);
      if (key === 's') return void tryRoll(fwd.clone().multiplyScalar(-1));

      if (key === 'arrowleft') cameraTargetRef.current.yaw = clamp(cameraTargetRef.current.yaw - 5, -155, 155);
      if (key === 'arrowright') cameraTargetRef.current.yaw = clamp(cameraTargetRef.current.yaw + 5, -155, 155);
      if (key === 'arrowup') cameraTargetRef.current.pitch = clamp(cameraTargetRef.current.pitch - 4, 18, 38);
      if (key === 'arrowdown') cameraTargetRef.current.pitch = clamp(cameraTargetRef.current.pitch + 4, 18, 38);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tryRoll]);

  const onContextCreate = async (gl: any) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const renderer = new Renderer({ gl }) as any;
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x08152a, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x08152a, 11, 35);

    const camera = new THREE.PerspectiveCamera(
      64,
      gl.drawingBufferWidth / gl.drawingBufferHeight,
      0.1,
      120
    );

    const hemi = new THREE.HemisphereLight(0xc8deff, 0x0f2042, 0.9);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2db, 1.3);
    key.position.set(7, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.width = 1024;
    key.shadow.mapSize.height = 1024;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    scene.add(key);

    const rim = new THREE.PointLight(0x73a8ff, 0.62, 36);
    rim.position.set(-8, 4, -7);
    scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 36),
      new THREE.MeshStandardMaterial({ color: 0x1b2f53, roughness: 0.94, metalness: 0.03 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(34, 36, 0x7fa6db, 0x35588c);
    grid.position.y = FLOOR_Y;
    const gm = grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.34;
    scene.add(grid);

    const blockMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf6edd8,
      roughness: 0.55,
      metalness: 0.01,
      clearcoat: 0.45,
      clearcoatRoughness: 0.28,
      sheen: 0.25,
      sheenColor: new THREE.Color(0xf9f1df),
      specularIntensity: 0.38,
    });

    const block = new THREE.Mesh(
      new THREE.BoxGeometry(BLOCK_SIZE.x, BLOCK_SIZE.y, BLOCK_SIZE.z),
      blockMaterial
    );
    block.castShadow = true;
    block.receiveShadow = false;
    const state = blockStateRef.current;
    block.position.copy(state.pos);
    block.quaternion.copy(state.quat);
    scene.add(block);

    const contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(HALF.x, HALF.z) * 0.92, 36),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24 })
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(state.pos.x, FLOOR_Y, state.pos.z);
    scene.add(contactShadow);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    blockRef.current = block;
    shadowRef.current = contactShadow;

    const animate = (ts: number) => {
      const r = rendererRef.current;
      const s = sceneRef.current;
      const c = cameraRef.current;
      const cubeMesh = blockRef.current;
      const contact = shadowRef.current;
      if (!r || !s || !c || !cubeMesh || !contact) return;

      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.033, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      const stateNow = blockStateRef.current;
      const roll = rollRef.current;

      if (roll) {
        roll.elapsed += dt;
        const t = clamp(roll.elapsed / roll.duration, 0, 1);
        const eased = easeInOut(t);

        const qDelta = new THREE.Quaternion().setFromAxisAngle(roll.axis, eased * Math.PI * 0.5);

        stateNow.pos.copy(roll.fromPos).sub(roll.pivot).applyQuaternion(qDelta).add(roll.pivot);
        stateNow.quat.copy(qDelta).multiply(roll.fromQuat).normalize();

        if (t >= 1) {
          stateNow.pos.y = restingCenterY(stateNow.quat);
          stateNow.pos.x = clamp(stateNow.pos.x, -ARENA_HALF, ARENA_HALF);
          stateNow.pos.z = clamp(stateNow.pos.z, -ARENA_HALF, ARENA_HALF);
          rollRef.current = null;
        }
      }

      cubeMesh.position.copy(stateNow.pos);
      cubeMesh.quaternion.copy(stateNow.quat);

      contact.position.set(stateNow.pos.x, FLOOR_Y, stateNow.pos.z);
      const shadowScale = rollRef.current ? 1.08 : 1;
      contact.scale.set(shadowScale, shadowScale, 1);
      (contact.material as THREE.MeshBasicMaterial).opacity = rollRef.current ? 0.2 : 0.26;

      const cameraTarget = cameraTargetRef.current;
      const cameraState = cameraStateRef.current;
      const follow = cameraFollowRef.current;

      cameraState.yaw = lerp(cameraState.yaw, cameraTarget.yaw, Math.min(1, dt * 16));
      cameraState.pitch = lerp(cameraState.pitch, cameraTarget.pitch, Math.min(1, dt * 16));

      follow.x = lerp(follow.x, stateNow.pos.x, Math.min(1, dt * 16));
      follow.z = lerp(follow.z, stateNow.pos.z, Math.min(1, dt * 16));
      follow.y = lerp(follow.y, stateNow.pos.y, Math.min(1, dt * 16));

      const yaw = THREE.MathUtils.degToRad(cameraState.yaw);
      const pitch = THREE.MathUtils.degToRad(cameraState.pitch);

      const boundRadius = Math.sqrt(HALF.x * HALF.x + HALF.y * HALF.y + HALF.z * HALF.z);
      const vFov = THREE.MathUtils.degToRad(c.fov);
      const aspect = c.aspect || (gl.drawingBufferWidth / gl.drawingBufferHeight);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

      const fitDistance =
        Math.max(
          boundRadius / Math.tan(vFov / 2),
          boundRadius / Math.tan(Math.max(0.18, hFov / 2))
        ) * 1.72;

      const radius = Math.max(9.8, fitDistance);

      const cx = follow.x + Math.sin(yaw) * Math.cos(pitch) * radius;
      const cy = follow.y + 1.6 + Math.sin(pitch) * radius * 0.74;
      const cz = follow.z + Math.cos(yaw) * Math.cos(pitch) * radius;

      c.position.set(cx, cy, cz);
      c.lookAt(follow.x, follow.y, follow.z);

      const drawW = gl.drawingBufferWidth;
      const drawH = gl.drawingBufferHeight;
      const nextAspect = drawW / drawH;
      if (Math.abs(c.aspect - nextAspect) > 0.0001) {
        c.aspect = nextAspect;
        c.updateProjectionMatrix();
      }
      r.setViewport(0, 0, drawW, drawH);

      r.render(s, c);
      gl.endFrameEXP();

      if (ts - lastHudRef.current > 120) {
        const prev = prevPosForSpeedRef.current;
        const dist = prev.distanceTo(stateNow.pos);
        prev.copy(stateNow.pos);
        const approxSpeed = dist / Math.max(0.001, dt);

        lastHudRef.current = ts;
        setHud({
          speed: approxSpeed.toFixed(2),
          cam: `${Math.round(cameraState.yaw)}°`,
        });
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      blockRef.current = null;
      shadowRef.current = null;
    };
  }, []);

  return (
    <View style={styles.gameWrap}>
      <View style={styles.hudTop}>
        <Pressable onPress={onBack} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>Menu</Text>
        </Pressable>

        <View style={styles.hudRight}>
          <HudChip label="Speed" value={hud.speed} />
          <HudChip label="Cam" value={hud.cam} />
        </View>
      </View>

      <View style={styles.objectiveRow}>
        <Text style={styles.objective}>Rect cream-cheese block. Face-roll movement. ({BUILD_TAG})</Text>
      </View>

      <View style={styles.world}>
        <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />

        <View style={styles.touchOverlay} {...panResponder.panHandlers}>
          <View style={styles.moveZoneHint} />
          <View style={styles.cameraZoneHint} />
        </View>

        <View style={styles.tutorialWrap}>
          <Text style={styles.tutorialText}>Phone: left swipe rolls block • right swipe orbits camera</Text>
          <Text style={styles.tutorialText}>Desktop: W/A/S/D rolls • arrows camera • Space forward roll</Text>
        </View>
      </View>
    </View>
  );
}

function HudChip({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.hudChip}>
      <Text style={styles.hudChipLabel}>{label}</Text>
      <Text style={styles.hudChipValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#060d1b' },

  menuWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a1226',
    padding: 24,
    gap: 14,
    overflow: 'hidden',
  },
  menuOrbA: {
    position: 'absolute',
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: '#1b3560',
    opacity: 0.42,
    left: -120,
    top: -150,
  },
  menuOrbB: {
    position: 'absolute',
    width: 440,
    height: 440,
    borderRadius: 220,
    backgroundColor: '#12335d',
    opacity: 0.32,
    right: -120,
    bottom: -130,
  },
  kicker: {
    color: '#7ec4ff',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  title: {
    color: '#f3f6ff',
    fontSize: 40,
    fontWeight: '900',
    textAlign: 'center',
  },
  copyCenter: {
    color: '#b7c4df',
    textAlign: 'center',
    maxWidth: 560,
    lineHeight: 22,
  },
  menuButtonPrimary: {
    marginTop: 8,
    backgroundColor: '#6ed1ff',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#98e2ff',
  },
  menuButtonPrimaryText: { color: '#061220', fontWeight: '800', fontSize: 18 },

  gameWrap: { flex: 1, backgroundColor: '#060d1b', padding: 10 },
  hudTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 2,
    gap: 8,
  },
  objectiveRow: { marginBottom: 6, paddingHorizontal: 2 },
  objective: { color: '#d5e9ff', fontWeight: '800', letterSpacing: 0.25 },
  smallButton: {
    backgroundColor: '#12213a',
    borderWidth: 1,
    borderColor: '#294063',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  smallButtonText: { color: '#d6e6ff', fontWeight: '700' },
  hudRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hudChip: {
    backgroundColor: '#12213a',
    borderWidth: 1,
    borderColor: '#273f63',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    minWidth: 66,
  },
  hudChipLabel: {
    color: '#8fb1dd',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  hudChipValue: {
    color: '#eaf5ff',
    fontSize: 13,
    fontWeight: '800',
  },

  world: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1f3258',
    backgroundColor: '#0e1c38',
  },
  touchOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  moveZoneHint: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '52%',
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  cameraZoneHint: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '48%',
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  tutorialWrap: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(4,10,20,0.66)',
    borderWidth: 1,
    borderColor: 'rgba(125,164,212,0.35)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  tutorialText: {
    color: '#d6e9ff',
    fontWeight: '700',
    fontSize: 12,
  },
});
