// Packaging for macOS (Apple Silicon and Intel), Windows (installer and
// portable) and Linux (AppImage). `npm run dist:mac` / `dist:win` build on
// their own platform; CI builds both on every tag.
//
// Signing is optional. With a Developer ID certificate (CSC_LINK or CSC_NAME)
// the Mac app is signed, and notarized when Apple credentials are present
// (APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or an API key).
// Without one it is ad-hoc signed so it still launches on Apple Silicon;
// macOS then asks once to confirm opening it (see README).
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
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ],
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
    contents: [
      { x: 150, y: 190 },
      { x: 390, y: 190, type: 'link', path: '/Applications' }
    ],
    window: { width: 540, height: 380 }
  },

  win: {
    target: [
      { target: 'nsis', arch: ['x64', 'arm64'] },
      { target: 'portable', arch: ['x64'] }
    ],
    icon: 'build/icon.ico'
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    buildUniversalInstaller: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Cue',
    artifactName: '${productName}-${version}-windows-setup-${arch}.${ext}'
  },
  portable: {
    artifactName: '${productName}-${version}-windows-portable.${ext}'
  },

  linux: {
    target: ['AppImage'],
    category: 'Office',
    icon: 'build/icon.png',
    synopsis: 'Church presentation app'
  },

  publish: null
}
