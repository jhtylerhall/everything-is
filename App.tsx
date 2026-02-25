import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Screen = 'menu' | 'settings' | 'game';
type Lane = -1 | 0 | 1;
type ObstacleType = 'crate' | 'rail';

type Obstacle = {
  id: number;
  z: number;
  lane: Lane;
  type: ObstacleType;
};

const PLAYER_BASE_Y = 0;
const JUMP_VELOCITY = 6.8;
const GRAVITY = 18;
const BASE_SPEED = 7.8;
const LANE_STEP = 118;
const PLAYER_Z_ANCHOR = 8;
const FINISH_Z = 205;

const OBSTACLES: Obstacle[] = [
  { id: 1, z: 22, lane: -1, type: 'crate' },
  { id: 2, z: 28, lane: 0, type: 'rail' },
  { id: 3, z: 37, lane: 1, type: 'crate' },
  { id: 4, z: 48, lane: 0, type: 'crate' },
  { id: 5, z: 56, lane: -1, type: 'rail' },
  { id: 6, z: 68, lane: 1, type: 'crate' },
  { id: 7, z: 77, lane: 0, type: 'crate' },
  { id: 8, z: 91, lane: -1, type: 'crate' },
  { id: 9, z: 101, lane: 1, type: 'rail' },
  { id: 10, z: 117, lane: 0, type: 'crate' },
  { id: 11, z: 128, lane: -1, type: 'crate' },
  { id: 12, z: 143, lane: 1, type: 'crate' },
  { id: 13, z: 159, lane: 0, type: 'rail' },
  { id: 14, z: 175, lane: -1, type: 'crate' },
  { id: 15, z: 188, lane: 1, type: 'crate' },
];

function clampLane(n: number): Lane {
  if (n <= -1) return -1;
  if (n >= 1) return 1;
  return 0;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');

  return (
    <SafeAreaView style={styles.safe}>
      {screen === 'menu' && <MainMenu onPlay={() => setScreen('game')} onSettings={() => setScreen('settings')} />}
      {screen === 'settings' && <Settings onBack={() => setScreen('menu')} />}
      {screen === 'game' && <Game onMenu={() => setScreen('menu')} />}
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

function MainMenu({ onPlay, onSettings }: { onPlay: () => void; onSettings: () => void }) {
  return (
    <View style={styles.menuWrap}>
      <Text style={styles.kicker}>PROJECT ASCENSION</Text>
      <Text style={styles.title}>Cream Cheese → Phone</Text>
      <Text style={styles.copyCenter}>Swipe left/right to switch lanes. Swipe up to jump.</Text>
      <Pressable style={styles.menuButtonPrimary} onPress={onPlay}>
        <Text style={styles.menuButtonPrimaryText}>Start Run</Text>
      </Pressable>
      <Pressable style={styles.menuButton} onPress={onSettings}>
        <Text style={styles.menuButtonText}>Settings</Text>
      </Pressable>
    </View>
  );
}

function Settings({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.menuWrap}>
      <Text style={styles.subtitle}>Settings</Text>
      <Text style={styles.copyCenter}>Prototype tuned for lane-swipe + jump gameplay.</Text>
      <Text style={styles.copyCenter}>Next steps: materials, VFX particles, and haptics.</Text>
      <Pressable style={styles.menuButton} onPress={onBack}>
        <Text style={styles.menuButtonText}>Back</Text>
      </Pressable>
    </View>
  );
}

function Game({ onMenu }: { onMenu: () => void }) {
  const [won, setWon] = useState(false);
  const [crashed, setCrashed] = useState(false);

  const laneTargetRef = useRef<Lane>(0);
  const laneRenderRef = useRef(0);

  const zRef = useRef(0);
  const speedRef = useRef(BASE_SPEED);

  const yRef = useRef(PLAYER_BASE_Y);
  const vyRef = useRef(0);
  const groundedRef = useRef(true);

  const lastTsRef = useRef(0);
  const [, forceRender] = useState(0);

  const resetRun = () => {
    laneTargetRef.current = 0;
    laneRenderRef.current = 0;
    zRef.current = 0;
    speedRef.current = BASE_SPEED;
    yRef.current = PLAYER_BASE_Y;
    vyRef.current = 0;
    groundedRef.current = true;
    setWon(false);
    setCrashed(false);
  };

  const jump = () => {
    if (!groundedRef.current || won || crashed) return;
    groundedRef.current = false;
    vyRef.current = JUMP_VELOCITY;
  };

  const moveLane = (dir: -1 | 1) => {
    if (won || crashed) return;
    laneTargetRef.current = clampLane(laneTargetRef.current + dir);
  };

  const onSwipe = (dx: number, dy: number) => {
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 28) {
      moveLane(dx > 0 ? 1 : -1);
      return;
    }
    if (dy < -28) jump();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
        onPanResponderRelease: (_, g) => onSwipe(g.dx, g.dy),
      }),
    [won, crashed]
  );

  useEffect(() => {
    let raf = 0;

    const tick = (ts: number) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.033, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      if (!won && !crashed) {
        // Forward motion
        speedRef.current = Math.min(11.3, speedRef.current + dt * 0.045);
        zRef.current += speedRef.current * dt;

        // Lane smoothing
        laneRenderRef.current += (laneTargetRef.current - laneRenderRef.current) * Math.min(1, dt * 14);

        // Jump physics
        vyRef.current -= GRAVITY * dt;
        yRef.current += vyRef.current * dt;

        if (yRef.current <= PLAYER_BASE_Y) {
          yRef.current = PLAYER_BASE_Y;
          vyRef.current = 0;
          groundedRef.current = true;
        }

        // Collision checks near player anchor Z
        for (const ob of OBSTACLES) {
          const dz = ob.z - zRef.current;
          if (Math.abs(dz - PLAYER_Z_ANCHOR) > 1.2) continue;

          const laneHit = Math.abs(ob.lane - laneRenderRef.current) < 0.42;
          if (!laneHit) continue;

          const highEnoughToClear = yRef.current > 1.65;
          if (!highEnoughToClear) {
            setCrashed(true);
            speedRef.current = 0;
            break;
          }
        }

        if (zRef.current >= FINISH_Z) {
          setWon(true);
          speedRef.current = 0;
        }
      }

      forceRender((n) => (n + 1) % 1000000);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [won, crashed]);

  const progress = Math.min(1, zRef.current / FINISH_Z);
  const laneX = laneRenderRef.current * LANE_STEP;

  const project = (worldZ: number, lane: number, height = 0) => {
    const distance = worldZ - zRef.current;
    const screenZ = distance;
    const depth = 1 / (1 + Math.max(0, screenZ) * 0.055);
    const x = lane * 205 * depth;
    const y = 430 - screenZ * 7.8 - height * 92;
    return { x, y, depth, distance };
  };

  const phoneProjection = project(FINISH_Z + 6, 0, 0.45);

  return (
    <View style={styles.gameWrap}>
      <View style={styles.hudTop}>
        <Pressable onPress={onMenu} style={styles.smallButton}><Text style={styles.smallButtonText}>Menu</Text></Pressable>
        <Text style={styles.objective}>Become the Phone 📱</Text>
      </View>

      <View style={styles.world} {...panResponder.panHandlers}>
        <View style={styles.skyGlow} />

        {/* Road grid */}
        {Array.from({ length: 22 }).map((_, idx) => {
          const z = zRef.current + idx * 7 + 4;
          const p = project(z, 0, 0);
          return (
            <View
              key={`grid-${idx}`}
              style={[
                styles.gridLine,
                {
                  top: p.y,
                  width: 850 * p.depth,
                  opacity: 0.11 + p.depth * 0.16,
                },
              ]}
            />
          );
        })}

        {/* Lane markers */}
        {[-1, 0, 1].map((lane) =>
          Array.from({ length: 15 }).map((_, idx) => {
            const z = zRef.current + idx * 10 + 8;
            const p = project(z, lane, 0);
            return (
              <View
                key={`lane-${lane}-${idx}`}
                style={[
                  styles.lanePip,
                  {
                    left: 640 / 2 + p.x - 2,
                    top: p.y + 58,
                    transform: [{ scale: p.depth }],
                    opacity: 0.18 + p.depth * 0.2,
                  },
                ]}
              />
            );
          })
        )}

        {/* Obstacles */}
        {OBSTACLES.map((ob) => {
          const p = project(ob.z, ob.lane, 0.4);
          if (p.distance < 0 || p.distance > 60) return null;

          const size = 90 * p.depth;
          return (
            <View
              key={ob.id}
              style={[
                styles.obstacle,
                ob.type === 'rail' ? styles.obstacleRail : styles.obstacleCrate,
                {
                  left: 640 / 2 + p.x - size / 2,
                  top: p.y - size * 0.5,
                  width: size,
                  height: size * (ob.type === 'rail' ? 0.42 : 0.62),
                  borderRadius: ob.type === 'rail' ? 7 : 12,
                },
              ]}
            />
          );
        })}

        {/* Finish phone monument */}
        {phoneProjection.distance > 0 && (
          <View
            style={[
              styles.phoneMonument,
              {
                left: 640 / 2 + phoneProjection.x - (88 * phoneProjection.depth) / 2,
                top: phoneProjection.y - 48 * phoneProjection.depth,
                width: 88 * phoneProjection.depth,
                height: 170 * phoneProjection.depth,
                borderRadius: 18 * phoneProjection.depth,
                opacity: Math.min(1, phoneProjection.depth * 4.4),
              },
            ]}
          >
            <View style={[styles.phoneNotch, { width: 34 * phoneProjection.depth, height: 6 * phoneProjection.depth, borderRadius: 6 * phoneProjection.depth }]} />
          </View>
        )}

        {/* Player shadow */}
        <View
          style={[
            styles.playerShadow,
            {
              left: 640 / 2 + laneX - 44,
              top: 520,
              transform: [{ scaleX: 1.1 - yRef.current * 0.08 }, { scaleY: 1 - yRef.current * 0.12 }],
              opacity: 0.34 - yRef.current * 0.06,
            },
          ]}
        />

        {/* Player (3D-ish cream cheese block) */}
        <View
          style={[
            styles.playerBody,
            {
              left: 640 / 2 + laneX - 42,
              top: 455 - yRef.current * 86,
              transform: [{ skewX: '-7deg' }],
            },
          ]}
        >
          <View style={styles.playerTopGloss} />
          <View style={styles.playerFace} />
        </View>

        <View style={styles.progressWrap}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      </View>

      <View style={styles.controlsRow}>
        <Pressable onPress={() => moveLane(-1)} style={styles.controlBtn}><Text style={styles.controlText}>←</Text></Pressable>
        <Pressable onPress={() => moveLane(1)} style={styles.controlBtn}><Text style={styles.controlText}>→</Text></Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={jump} style={[styles.controlBtn, styles.jumpBtn]}><Text style={styles.controlText}>Jump</Text></Pressable>
      </View>

      {(won || crashed) && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>{won ? 'Ascension complete.' : 'Impact detected.'}</Text>
          <Text style={styles.overlayCopy}>{won ? 'The cream cheese has become a phone.' : 'Swipe cleaner lanes and jump earlier.'}</Text>
          <Pressable style={styles.menuButtonPrimary} onPress={resetRun}>
            <Text style={styles.menuButtonPrimaryText}>Run Again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#090f1e' },

  menuWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a1124',
    padding: 24,
    gap: 14,
  },
  kicker: {
    color: '#7ec4ff',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  title: {
    color: '#f3f6ff',
    fontSize: 42,
    fontWeight: '900',
    textAlign: 'center',
  },
  subtitle: {
    color: '#f3f6ff',
    fontSize: 26,
    fontWeight: '800',
  },
  copyCenter: {
    color: '#b7c4df',
    textAlign: 'center',
    maxWidth: 460,
    lineHeight: 21,
  },
  menuButtonPrimary: {
    marginTop: 8,
    backgroundColor: '#6ed1ff',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 13,
  },
  menuButtonPrimaryText: { color: '#061220', fontWeight: '800', fontSize: 18 },
  menuButton: {
    backgroundColor: '#1a2741',
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d3b57',
  },
  menuButtonText: { color: '#d9e6ff', fontWeight: '700', fontSize: 16 },

  gameWrap: { flex: 1, backgroundColor: '#060d1b', padding: 10 },
  hudTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  objective: { color: '#cae4ff', fontWeight: '700', fontSize: 16 },
  smallButton: {
    backgroundColor: '#12213a',
    borderWidth: 1,
    borderColor: '#294063',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  smallButtonText: { color: '#d6e6ff', fontWeight: '700' },

  world: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#0f1e3a',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1f3258',
  },
  skyGlow: {
    position: 'absolute',
    left: -120,
    top: -140,
    width: 800,
    height: 400,
    borderRadius: 380,
    backgroundColor: '#16305a',
    opacity: 0.48,
  },

  gridLine: {
    position: 'absolute',
    left: '50%',
    marginLeft: -425,
    height: 2,
    backgroundColor: '#9cc3ff',
    borderRadius: 2,
  },
  lanePip: {
    position: 'absolute',
    width: 4,
    height: 10,
    borderRadius: 2,
    backgroundColor: '#d6ebff',
  },

  obstacle: {
    position: 'absolute',
    borderWidth: 1,
  },
  obstacleCrate: {
    backgroundColor: '#3b5074',
    borderColor: '#5876a3',
  },
  obstacleRail: {
    backgroundColor: '#5b6f8f',
    borderColor: '#8fa7d0',
  },

  phoneMonument: {
    position: 'absolute',
    backgroundColor: '#0f1728',
    borderWidth: 2,
    borderColor: '#6fa8ff',
    alignItems: 'center',
    paddingTop: 8,
  },
  phoneNotch: {
    backgroundColor: '#1a2943',
  },

  playerShadow: {
    position: 'absolute',
    width: 88,
    height: 24,
    borderRadius: 99,
    backgroundColor: '#040812',
  },
  playerBody: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 14,
    backgroundColor: '#f5efe0',
    borderWidth: 2,
    borderColor: '#d6c6aa',
    overflow: 'hidden',
  },
  playerTopGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 24,
    backgroundColor: '#fff7ea',
    opacity: 0.86,
  },
  playerFace: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 12,
    backgroundColor: '#e3d4bb',
  },

  progressWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    height: 8,
    borderRadius: 6,
    backgroundColor: '#11213f',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#79d4ff',
  },

  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
  },
  controlBtn: {
    width: 62,
    height: 62,
    borderRadius: 18,
    backgroundColor: '#14243f',
    borderWidth: 1,
    borderColor: '#2a456d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpBtn: {
    width: 108,
    borderRadius: 18,
  },
  controlText: {
    color: '#ecf5ff',
    fontSize: 18,
    fontWeight: '800',
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3,8,16,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 20,
  },
  overlayTitle: {
    color: '#f3f8ff',
    fontSize: 30,
    fontWeight: '900',
  },
  overlayCopy: {
    color: '#b9cce8',
    fontSize: 16,
    marginBottom: 10,
  },
});
