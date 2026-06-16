# Build resources

electron-builder reads custom installer/app assets from this directory
(`directories.buildResources: build`).

Optional — drop branded assets here to override the defaults:

- `icon.ico` — application + installer icon (256×256 multi-size .ico).
- `installerHeader.bmp` — NSIS header bitmap (150×57).
- `installerSidebar.bmp` — NSIS welcome/finish sidebar (164×314).
- `license.txt` — license text shown by the installer.

If `icon.ico` is absent, electron-builder uses the default Electron icon and the
build still succeeds. Add the file and (optionally) reference it under `win.icon`
in `electron-builder.yml` to brand the build.
