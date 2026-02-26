import { Audio } from 'expo-av';
import { GLView } from 'expo-gl';
import { StatusBar } from 'expo-status-bar';
import { Renderer } from 'expo-three';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  PanResponder,
  PixelRatio,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as THREE from 'three';

type Screen = 'menu' | 'game';

type MotionState = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  hop: number;
  hopVy: number;
  squish: number;
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const ARENA_HALF = 8.6;
const IMPULSE_BASE = 6.8;

let splooshAudioContext: any = null;
let splooshSound: Audio.Sound | null = null;
let splooshLoadPromise: Promise<void> | null = null;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
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
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.16);

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, now);
    g2.gain.exponentialRampToValueAtTime(0.12 * intensity, now + 0.01);
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
  const volume = clamp(0.28 + intensity * 0.28, 0.18, 1);

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
      <Text style={styles.title}>Cream Cheese Cube Lab</Text>
      <Text style={styles.copyCenter}>Now using real 3D rendering with expo-gl + three.</Text>
      <Text style={styles.copyCenter}>Phone: swipe left zone to move, right zone to orbit camera.</Text>
      <Text style={styles.copyCenter}>Desktop: W/A/S/D movement, Space burst, arrows for camera.</Text>

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
  const cubeRef = useRef<THREE.Mesh | null>(null);
  const shadowRef = useRef<THREE.Mesh | null>(null);
  const rafRef = useRef<number | null>(null);

  const motionRef = useRef<MotionState>({
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    rx: 0.12,
    ry: 0.32,
    rz: 0,
    spinX: 0,
    spinY: 0,
    spinZ: 0,
    hop: 0,
    hopVy: 0,
    squish: 1,
  });

  const cameraTargetRef = useRef({ yaw: 18, pitch: 24 });
  const cameraStateRef = useRef({ yaw: 18, pitch: 24 });
  const cameraFollowRef = useRef({ x: 0, z: 0, y: 0.93 });

  const gestureModeRef = useRef<'move' | 'camera' | null>(null);
  const gestureLastRef = useRef({ dx: 0, dy: 0 });
  const swipeAccumRef = useRef({ dx: 0, dy: 0 });
  const burstLockRef = useRef(false);

  const lastTsRef = useRef(0);
  const lastHudRef = useRef(0);

  const [hud, setHud] = useState({ speed: '0.00', cam: '18°' });

  const pushCube = useCallback((lateral: number, forward: number, strength: number) => {
    const motion = motionRef.current;
    const yawRad = (cameraStateRef.current.yaw * Math.PI) / 180;

    const right = { x: Math.cos(yawRad), z: -Math.sin(yawRad) };
    const fwd = { x: Math.sin(yawRad), z: Math.cos(yawRad) };

    let wx = right.x * lateral + fwd.x * forward;
    let wz = right.z * lateral + fwd.z * forward;

    const l = Math.hypot(wx, wz) || 1;
    wx /= l;
    wz /= l;

    const impulse = IMPULSE_BASE * strength;

    motion.vx += wx * impulse;
    motion.vz += wz * impulse;

    motion.spinX += wz * strength * 7.2;
    motion.spinZ += -wx * strength * 7.2;
    motion.spinY += wx * strength * 1.8;

    motion.squish = 0.86;

    playSploosh(0.62 + strength * 0.36);
  }, []);

  const burstForward = useCallback((strength = 1.1) => {
    const motion = motionRef.current;
    pushCube(0, 1, strength);
    motion.hopVy = Math.max(motion.hopVy, 2.7 * strength);
    motion.squish = 1.16;
  }, [pushCube]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
        onPanResponderGrant: (evt) => {
          gestureModeRef.current = evt.nativeEvent.locationX > SCREEN_WIDTH * 0.52 ? 'camera' : 'move';
          gestureLastRef.current = { dx: 0, dy: 0 };
          swipeAccumRef.current = { dx: 0, dy: 0 };
          burstLockRef.current = false;
        },
        onPanResponderMove: (_, g) => {
          const ddx = g.dx - gestureLastRef.current.dx;
          const ddy = g.dy - gestureLastRef.current.dy;
          gestureLastRef.current = { dx: g.dx, dy: g.dy };

          if (gestureModeRef.current === 'camera') {
            cameraTargetRef.current.yaw = clamp(cameraTargetRef.current.yaw + ddx * 0.43, -150, 150);
            cameraTargetRef.current.pitch = clamp(cameraTargetRef.current.pitch - ddy * 0.28, 14, 42);
            return;
          }

          swipeAccumRef.current.dx += ddx;
          swipeAccumRef.current.dy += ddy;

          const a = swipeAccumRef.current;
          if (Math.abs(a.dx) > 18 && Math.abs(a.dx) > Math.abs(a.dy) * 0.72) {
            pushCube(a.dx > 0 ? 1 : -1, 0, clamp(0.56 + Math.abs(a.dx) / 120, 0.56, 1.2));
            a.dx = 0;
            a.dy *= 0.3;
          }

          if (a.dy < -24 && Math.abs(a.dy) > Math.abs(a.dx) * 1.06 && !burstLockRef.current) {
            burstForward(1.0);
            burstLockRef.current = true;
            a.dy = 0;
          }

          if (a.dy > -8) burstLockRef.current = false;
        },
        onPanResponderRelease: () => {
          gestureModeRef.current = null;
          gestureLastRef.current = { dx: 0, dy: 0 };
          swipeAccumRef.current = { dx: 0, dy: 0 };
          burstLockRef.current = false;
        },
        onPanResponderTerminate: () => {
          gestureModeRef.current = null;
          gestureLastRef.current = { dx: 0, dy: 0 };
          swipeAccumRef.current = { dx: 0, dy: 0 };
          burstLockRef.current = false;
        },
      }),
    [burstForward, pushCube]
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

      if (key === 'a') return void pushCube(-1, 0, 0.8);
      if (key === 'd') return void pushCube(1, 0, 0.8);
      if (key === 'w') return void pushCube(0, 1, 0.86);
      if (key === 's') return void pushCube(0, -1, 0.72);
      if (key === ' ') return void burstForward(1.22);

      if (key === 'arrowleft') cameraTargetRef.current.yaw = clamp(cameraTargetRef.current.yaw - 5, -150, 150);
      if (key === 'arrowright') cameraTargetRef.current.yaw = clamp(cameraTargetRef.current.yaw + 5, -150, 150);
      if (key === 'arrowup') cameraTargetRef.current.pitch = clamp(cameraTargetRef.current.pitch - 4, 14, 42);
      if (key === 'arrowdown') cameraTargetRef.current.pitch = clamp(cameraTargetRef.current.pitch + 4, 14, 42);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [burstForward, pushCube]);

  const onContextCreate = async (gl: any) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const renderer = new Renderer({ gl }) as any;
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    renderer.setPixelRatio(Math.min(2, PixelRatio.get()));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x08152a, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x08152a, 10, 30);

    const camera = new THREE.PerspectiveCamera(
      58,
      gl.drawingBufferWidth / gl.drawingBufferHeight,
      0.1,
      100
    );

    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x10203f, 0.85);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff4de, 1.25);
    key.position.set(6, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.width = 1024;
    key.shadow.mapSize.height = 1024;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 24;
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    scene.add(key);

    const rim = new THREE.PointLight(0x78aeff, 0.64, 30);
    rim.position.set(-7, 4, -6);
    scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 34),
      new THREE.MeshStandardMaterial({ color: 0x1b2f53, roughness: 0.95, metalness: 0.04 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(32, 36, 0x7fa6db, 0x35588c);
    grid.position.y = 0.02;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.32;
    scene.add(grid);

    const cubeMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf6edd8,
      roughness: 0.56,
      metalness: 0.01,
      clearcoat: 0.42,
      clearcoatRoughness: 0.3,
      sheen: 0.24,
      sheenColor: new THREE.Color(0xf9f1df),
      specularIntensity: 0.35,
    });

    const cube = new THREE.Mesh(new THREE.BoxGeometry(1.65, 1.65, 1.65), cubeMaterial);
    cube.castShadow = true;
    cube.receiveShadow = false;
    cube.position.set(0, 0.93, 0);
    scene.add(cube);

    const contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.96, 34),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26 })
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(0, 0.01, 0);
    scene.add(contactShadow);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    cubeRef.current = cube;
    shadowRef.current = contactShadow;

    const animate = (ts: number) => {
      const r = rendererRef.current;
      const s = sceneRef.current;
      const c = cameraRef.current;
      const cubeMesh = cubeRef.current;
      const contact = shadowRef.current;
      if (!r || !s || !c || !cubeMesh || !contact) return;

      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.033, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      const m = motionRef.current;

      m.x += m.vx * dt;
      m.z += m.vz * dt;

      m.vx *= Math.exp(-dt * 3.7);
      m.vz *= Math.exp(-dt * 3.7);

      if (m.x > ARENA_HALF) {
        m.x = ARENA_HALF;
        m.vx *= -0.35;
        m.spinZ += 2.5;
        playSploosh(0.7);
      }
      if (m.x < -ARENA_HALF) {
        m.x = -ARENA_HALF;
        m.vx *= -0.35;
        m.spinZ -= 2.5;
        playSploosh(0.7);
      }
      if (m.z > ARENA_HALF) {
        m.z = ARENA_HALF;
        m.vz *= -0.35;
        m.spinX += 2.5;
        playSploosh(0.7);
      }
      if (m.z < -ARENA_HALF) {
        m.z = -ARENA_HALF;
        m.vz *= -0.35;
        m.spinX -= 2.5;
        playSploosh(0.7);
      }

      m.spinX += m.vz * dt * 2.9;
      m.spinZ += -m.vx * dt * 2.9;

      m.spinX *= Math.exp(-dt * 2.2);
      m.spinY *= Math.exp(-dt * 2.5);
      m.spinZ *= Math.exp(-dt * 2.2);

      m.rx += m.spinX * dt;
      m.ry += m.spinY * dt;
      m.rz += m.spinZ * dt;

      m.hopVy -= 13.5 * dt;
      m.hop += m.hopVy * dt;
      if (m.hop < 0) {
        if (m.hopVy < -2.8) playSploosh(0.82);
        m.hop = 0;
        m.hopVy = 0;
      }

      m.squish = lerp(m.squish, 1, Math.min(1, dt * 8));

      const speed = Math.hypot(m.vx, m.vz);

      const cubeScaleY = m.squish;
      const dynamicLift = (Math.abs(Math.sin(m.rx)) + Math.abs(Math.sin(m.rz))) * 0.22;
      const cubeCenterY = 0.825 * cubeScaleY + 0.01 + m.hop + dynamicLift;

      cubeMesh.position.set(m.x, cubeCenterY, m.z);
      cubeMesh.rotation.set(m.rx, m.ry, m.rz);
      cubeMesh.scale.set(1 / m.squish, m.squish, 1 / m.squish);

      contact.position.set(m.x, 0.01, m.z);
      const shScale = 1 + speed * 0.06;
      contact.scale.set(shScale, shScale, 1);
      (contact.material as THREE.MeshBasicMaterial).opacity = clamp(
        0.30 - (m.hop + dynamicLift) * 0.2,
        0.06,
        0.30
      );

      const cameraTarget = cameraTargetRef.current;
      const cameraState = cameraStateRef.current;
      const cameraFollow = cameraFollowRef.current;

      cameraState.yaw = lerp(cameraState.yaw, cameraTarget.yaw, Math.min(1, dt * 14));
      cameraState.pitch = lerp(cameraState.pitch, cameraTarget.pitch, Math.min(1, dt * 14));

      cameraFollow.x = lerp(cameraFollow.x, m.x, Math.min(1, dt * 14));
      cameraFollow.z = lerp(cameraFollow.z, m.z, Math.min(1, dt * 14));
      cameraFollow.y = lerp(cameraFollow.y, cubeCenterY, Math.min(1, dt * 14));

      const yaw = THREE.MathUtils.degToRad(cameraState.yaw);
      const pitch = THREE.MathUtils.degToRad(cameraState.pitch);
      const radius = 8.4 + speed * 0.12;

      const cx = cameraFollow.x + Math.sin(yaw) * Math.cos(pitch) * radius;
      const cy = Math.max(2.35, cameraFollow.y + 1.45 + Math.sin(pitch) * radius * 0.78);
      const cz = cameraFollow.z + Math.cos(yaw) * Math.cos(pitch) * radius;

      c.position.set(cx, cy, cz);
      c.lookAt(m.x, cubeCenterY + 0.2, m.z);

      r.render(s, c);
      gl.endFrameEXP();

      if (ts - lastHudRef.current > 120) {
        lastHudRef.current = ts;
        setHud({
          speed: speed.toFixed(2),
          cam: `${Math.round(cameraStateRef.current.yaw)}°`,
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
      cubeRef.current = null;
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
        <Text style={styles.objective}>Real 3D cube. Swipe to move, rotate, and burst.</Text>
      </View>

      <View style={styles.world}>
        <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />

        <View style={styles.touchOverlay} {...panResponder.panHandlers}>
          <View style={styles.moveZoneHint} />
          <View style={styles.cameraZoneHint} />
        </View>

        <View style={styles.tutorialWrap}>
          <Text style={styles.tutorialText}>Phone: left swipe = move • right swipe = camera orbit</Text>
          <Text style={styles.tutorialText}>Desktop: W/A/S/D move • Space burst • arrows camera</Text>
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
