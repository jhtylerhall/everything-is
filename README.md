# Cream Cheese Platformer (Expo)

React Native + Expo MVP inspired by the structure style of `nemus-obscurum` (simple root app entry, Expo scripts, simulator-friendly workflow).

## What’s in here

- Main Menu: **Play** + **Settings** (stub)
- 2D platformer MVP in pure React Native views
- Cream-cheese blob player with squash feel
- 3 platforms + ground + bagel goal
- Fall-respawn
- On-screen controls: left / right / jump

## Run

```bash
cd cream-cheese-platformer-expo
npm install
npm run ios
```

Or open dev server only:

```bash
npm start
```

## Notes

- This version is intentionally dependency-light (no paid or heavy game engine libs).
- Great for quick iteration in Expo and sharing over URL/dev tunnel.
- If you want, next pass we can migrate gameplay loop to `react-native-game-engine` or `expo-gl` for richer physics.
