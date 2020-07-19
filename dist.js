/* eslint-disable no-console */
const builder = require('electron-builder');
const { notarize } = require('electron-notarize');
const semver = require('semver');
const { exec } = require('child_process');

const packageJson = require('./package.json');

const { Arch, Platform } = builder;

// sometimes, notarization works but *.app does not have a ticket stapled to it
// this ensure the *.app has the notarization ticket
const verifyNotarizationAsync = filePath =>
  new Promise((resolve, reject) => {
    // eslint-disable-next-line no-console
    console.log(`xcrun stapler validate ${filePath.replace(/ /g, '\\ ')}`);

    exec(`xcrun stapler validate ${filePath.replace(/ /g, '\\ ')}`, (e, stdout, stderr) => {
      if (e instanceof Error) {
        reject(e);
        return;
      }

      if (stderr) {
        reject(new Error(stderr));
        return;
      }

      if (stdout.includes('The validate action worked!')) {
        resolve(stdout);
      } else {
        reject(new Error(stdout));
      }
    });
  });

console.log(`Machine: ${process.platform}`);

let targets;
switch (process.platform) {
  case 'darwin': {
    targets = Platform.MAC.createTarget();
    break;
  }
  case 'win32': {
    targets = Platform.WINDOWS.createTarget(['nsis'], Arch.x64);
    break;
  }
  default:
  case 'linux': {
    targets = Platform.LINUX.createTarget(['AppImage', 'snap'], Arch.x64);
    break;
  }
}

const options = {
  targets,
  config: {
    appId: 'com.tiddlygit.app',
    productName: 'TiddlyGit',
    asar: true,
    files: ['!tests/**/*', '!docs/**/*', '!template/**/*'],
    extraFiles: [
      {
        from: 'template/wiki',
        to: 'wiki',
        filter: ['**/*'],
      },
    ],
    asarUnpack: ['**/node_modules/tiddlywiki/**/*', '**/node_modules/chokidar/**/*', '**/node_modules/lodash/**/*'],
    extraResources: [
      {
        from: 'public/libs/wiki/wiki-worker.js',
        to: 'app.asar.unpacked/wiki-worker.js',
      },
      {
        from: 'public/libs/wiki/watch-wiki-worker.js',
        to: 'app.asar.unpacked/watch-wiki-worker.js',
      },
      {
        from: 'public/libs/git.js',
        to: 'app.asar.unpacked/git.js',
      },
    ],
    protocols: [
      {
        name: 'HTTPS Protocol',
        schemes: ['https'],
      },
      {
        name: 'HTTP Protocol',
        schemes: ['http'],
      },
      {
        name: 'Mailto Protocol',
        schemes: ['mailto'],
      },
    ],
    directories: {
      buildResources: 'build-resources',
    },
    mac: {
      category: 'public.app-category.productivity',
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: 'build-resources/entitlements.mac.plist',
      entitlementsInherit: 'build-resources/entitlements.mac.plist',
      darkModeSupport: true,
    },
    linux: {
      category: 'Utility',
      packageCategory: 'utils',
    },
    snap: {
      publish: [
        {
          provider: 'snapStore',
          channels: [semver.prerelease(packageJson.version) ? 'edge' : 'stable'],
        },
        'github',
      ],
    },
    afterSign: context => {
      return null;
      const shouldNotarize =
        process.platform === 'darwin' && context.electronPlatformName === 'darwin' && process.env.CI_BUILD_TAG;
      if (!shouldNotarize) return null;

      console.log('Notarizing app...');
      // https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/
      const { appOutDir } = context;

      const appName = context.packager.appInfo.productFilename;
      const appPath = `${appOutDir}/${appName}.app`;

      return notarize({
        appBundleId: 'com.tiddlygit.app',
        appPath,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_ID_PASSWORD,
      })
        .then(() => verifyNotarizationAsync(appPath))
        .then(notarizedInfo => {
          // eslint-disable-next-line no-console
          console.log(notarizedInfo);
        });
    },
  },
};

builder
  .build(options)
  .then(() => {
    console.log('build successful');
  })
  .catch(error => {
    console.log(error);
    process.exit(1);
  });
