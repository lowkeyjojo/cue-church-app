// Packaging: one download per platform, so nobody can pick the wrong one.
//   macOS    Cue-<version>-mac.dmg            universal (Apple Silicon and Intel)
//   Windows  Cue-<version>-windows-setup.exe  installs for the current user and opens Cue
// `npm run dist:mac` / `dist:win` build on their own platform; the Release
// workflow builds both, installs each and checks that Cue opens.
//
// Signing is optional. With a Developer ID certificate (CSC_LINK or CSC_NAME)
// the Mac app is signed, and notarized when Apple credentials are present
// (APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or an API key).
// Without one it is ad-hoc signed so it still launches on Apple Silicon;
// macOS then asks once to confirm opening it (see README). Windows signs with
// WIN_CSC_LINK when it is set; without it SmartScreen asks once.

// CI passes secrets that aren't set as empty strings, and electron-builder
// reads an empty CSC_LINK as a certificate path. Unset means unset.
for (const name of [
  'CSC_LINK',
  'CSC_NAME',
  'CSC_KEY_PASSWORD',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_API_KEY'
]) {
  if (process.env[name] === '') delete process.env[name]
}

const macIdentity = Boolean(process.env.CSC_LINK || process.env.CSC_NAME)
const notarize = macIdentity && Boolean(process.env.APPLE_TEAM_ID || process.env.APPLE_API_KEY)

/** @type {import('electron-builder').Configuration} */
export default {
  appId: 'io.github.lowkeyjojo.cue',
  productName: 'Cue',
  copyright: `Copyright © ${new Date().getFullYear()} Cue`,
  directories: { output: 'release/${version}', buildResources: 'build' },
  // Everything the app needs is bundled into out/ by electron-vite.
  files: ['out/**/*', 'package.json', '!**/*.map'],
  extraResources: [{ from: 'resources', to: 'resources' }],
  asar: true,
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  fileAssociations: [
    {
      ext: 'cueplan',
      name: 'Cue Service Plan',
      description: 'Cue service plan with its media',
      role: 'Editor',
      mimeType: 'application/x-cueplan'
    }
  ],

  mac: {
    category: 'public.app-category.productivity',
    target: [{ target: 'dmg', arch: ['universal'] }],
    artifactName: '${productName}-${version}-mac.${ext}',
    icon: 'build/icon.icns',
    identity: macIdentity ? undefined : '-',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize,
    darkModeSupport: true
  },
  dmg: {
    title: 'Cue ${version}',
    // Drawn by scripts/make-installer-art.mjs (with an @2x copy for Retina screens).
    background: 'build/dmg-background.png',
    iconSize: 96,
    contents: [
      { x: 170, y: 208 },
      { x: 470, y: 208, type: 'link', path: '/Applications' }
    ],
    window: { width: 640, height: 400 }
  },

  win: {
    // x64 also runs on Windows 11 on ARM, so one installer covers every PC.
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico'
  },
  // One click: no questions, installs for the current user (no administrator
  // prompt), adds the shortcuts and opens Cue, whose welcome screen takes over.
  nsis: {
    oneClick: true,
    perMachine: false,
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Cue',
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    uninstallDisplayName: 'Cue',
    artifactName: '${productName}-${version}-windows-setup.${ext}'
  },

  linux: {
    target: ['AppImage'],
    category: 'Office',
    icon: 'build/icon.png',
    synopsis: 'Church presentation app'
  },

  publish: null
}
