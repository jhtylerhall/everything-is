# Expo / EAS Deploy Guide

## One-time setup

1. Log in to Expo:

```bash
npm run eas:login
```

2. Confirm you are logged into the correct Expo account (`jhtylerhall`):

```bash
npx eas-cli whoami
```

3. Link this project to Expo (creates project ID in app config under `expo.extra.eas.projectId`):

```bash
npm run eas:init
```

4. Commit the changes from `eas init` (it may update app.json/app.config).

## Build binaries (cloud build)

- iOS:

```bash
npm run eas:build:ios
```

- Android:

```bash
npm run eas:build:android
```

- Both:

```bash
npm run eas:build:all
```

## OTA updates (no store resubmission for JS/assets changes)

```bash
npm run eas:update
```

## Optional: submit to stores

After a successful production build:

```bash
npx eas-cli submit --platform ios --profile production
npx eas-cli submit --platform android --profile production
```

## Notes

- First iOS/Android build will prompt for credentials/signing.
- Use `preview` profile for internal testing builds.
- Use `production` profile for release builds.
